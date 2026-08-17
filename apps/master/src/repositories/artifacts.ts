import type { ArtifactRecord, RegisterArtifactInput } from "@retail-orchestrator/shared";
import { createHash } from "node:crypto";
import type { Client } from "minio";
import type { Pool } from "pg";

export interface ArtifactStorageEvidence {
  sizeBytes: number;
  etag?: string;
  checksumSha256: string;
  checksumSource: "object-metadata" | "content-sha256";
  versionId?: string;
}

export async function verifyArtifactStorageEvidence(
  s3: Pick<Client, "statObject" | "getObject">,
  artifact: Pick<ArtifactRecord, "artifactId" | "bucket" | "objectKey" | "sizeBytes" | "checksumSha256" | "storageVersionId">
): Promise<ArtifactStorageEvidence> {
  if (!artifact.checksumSha256) throw new Error(`artifact_checksum_missing:${artifact.artifactId}`);
  let stat: Awaited<ReturnType<Client["statObject"]>>;
  try {
    stat = await s3.statObject(
      artifact.bucket,
      artifact.objectKey,
      artifact.storageVersionId ? { versionId: artifact.storageVersionId } : undefined
    );
  } catch {
    throw new Error(`artifact_object_unavailable:${artifact.artifactId}`);
  }
  const sizeBytes = Number(stat.size);
  if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== sizeBytes) {
    throw new Error(`artifact_size_mismatch:${artifact.artifactId}`);
  }
  const registeredChecksum = artifact.checksumSha256.toLowerCase();
  const metadata = stat.metaData || {};
  const storedChecksum = findStoredSha256(metadata);
  if (storedChecksum) {
    if (storedChecksum !== registeredChecksum) throw new Error(`artifact_checksum_mismatch:${artifact.artifactId}`);
    return {
      sizeBytes,
      etag: normalizeEtag(stat.etag),
      checksumSha256: registeredChecksum,
      checksumSource: "object-metadata",
      ...(stat.versionId || artifact.storageVersionId
        ? { versionId: stat.versionId || artifact.storageVersionId || undefined }
        : {})
    };
  }

  let stream: Awaited<ReturnType<Client["getObject"]>>;
  try {
    stream = await s3.getObject(
      artifact.bucket,
      artifact.objectKey,
      artifact.storageVersionId ? { versionId: artifact.storageVersionId } : undefined
    );
  } catch {
    throw new Error(`artifact_object_unavailable:${artifact.artifactId}`);
  }
  const hash = createHash("sha256");
  try {
    for await (const chunk of stream as unknown as AsyncIterable<Buffer | string>) hash.update(chunk);
  } catch {
    throw new Error(`artifact_content_unreadable:${artifact.artifactId}`);
  }
  const contentChecksum = hash.digest("hex");
  if (contentChecksum !== registeredChecksum) throw new Error(`artifact_checksum_mismatch:${artifact.artifactId}`);
  return {
    sizeBytes,
    etag: normalizeEtag(stat.etag),
    checksumSha256: contentChecksum,
    checksumSource: "content-sha256",
    ...(stat.versionId || artifact.storageVersionId
      ? { versionId: stat.versionId || artifact.storageVersionId || undefined }
      : {})
  };
}

function findStoredSha256(metadata: Record<string, string>): string | undefined {
  const entry = Object.entries(metadata).find(([key]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized === "checksumsha256" || normalized === "xamzmetachecksumsha256";
  });
  const value = entry?.[1]?.trim().toLowerCase();
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function normalizeEtag(etag?: string): string | undefined {
  const value = etag?.replace(/^"|"$/g, "");
  return value || undefined;
}

export function assertArtifactReplayCompatible(
  existing: Pick<ArtifactRecord, "checksumSha256" | "storageVersionId">,
  incoming: Pick<ArtifactRecord, "checksumSha256" | "storageVersionId">
): void {
  const sameChecksum = Boolean(existing.checksumSha256)
    && existing.checksumSha256?.toLowerCase() === incoming.checksumSha256?.toLowerCase();
  const sameVersion = Boolean(existing.storageVersionId)
    && existing.storageVersionId === incoming.storageVersionId;
  if (!sameChecksum || !sameVersion) throw new Error("artifact_immutable_conflict");
}

export async function registerArtifact(
  db: Pool,
  input: RegisterArtifactInput & { storageVersionId?: string }
): Promise<ArtifactRecord> {
  const result = await db.query(
    `
    INSERT INTO artifacts (
      task_id, run_id, store_id, worker_id, account_id, profile_id, kind,
      bucket, object_key, content_type, size_bytes, checksum_sha256, storage_version_id, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (bucket, object_key) DO NOTHING
    RETURNING *
    `,
    [
      input.taskId || null,
      input.runId || null,
      input.storeId || null,
      input.workerId || null,
      input.accountId || null,
      input.profileId || null,
      input.kind,
      input.bucket,
      input.objectKey,
      input.contentType || null,
      input.sizeBytes ?? null,
      input.checksumSha256 || null,
      input.storageVersionId || null,
      JSON.stringify(input.metadata || {})
    ]
  );
  if (result.rows[0]) return mapArtifact(result.rows[0]);
  const existingResult = await db.query(
    `SELECT * FROM artifacts WHERE bucket = $1 AND object_key = $2`,
    [input.bucket, input.objectKey]
  );
  const existing = mapArtifact(existingResult.rows[0]);
  assertArtifactReplayCompatible(existing, {
    checksumSha256: input.checksumSha256,
    storageVersionId: input.storageVersionId
  });
  return existing;
}

export async function listArtifacts(
  db: Pool,
  filters: { taskId?: string; runId?: string; storeId?: string }
): Promise<ArtifactRecord[]> {
  const result = await db.query(
    `
    SELECT *
    FROM artifacts
    WHERE ($1::uuid IS NULL OR task_id = $1::uuid)
      AND ($2::uuid IS NULL OR run_id = $2::uuid)
      AND ($3::text IS NULL OR store_id = $3::text)
    ORDER BY created_at DESC
    LIMIT 500
    `,
    [filters.taskId || null, filters.runId || null, filters.storeId || null]
  );
  return result.rows.map(mapArtifact);
}

export async function getArtifact(db: Pool, artifactId: string): Promise<ArtifactRecord | null> {
  const result = await db.query(`SELECT * FROM artifacts WHERE artifact_id = $1::uuid`, [artifactId]);
  return result.rows[0] ? mapArtifact(result.rows[0]) : null;
}

function mapArtifact(row: any): ArtifactRecord {
  return {
    artifactId: row.artifact_id,
    taskId: row.task_id || undefined,
    runId: row.run_id || undefined,
    storeId: row.store_id || undefined,
    workerId: row.worker_id || undefined,
    accountId: row.account_id || undefined,
    profileId: row.profile_id || undefined,
    kind: row.kind,
    bucket: row.bucket,
    objectKey: row.object_key,
    contentType: row.content_type || undefined,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : undefined,
    checksumSha256: row.checksum_sha256 || undefined,
    storageVersionId: row.storage_version_id || undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString()
  };
}
