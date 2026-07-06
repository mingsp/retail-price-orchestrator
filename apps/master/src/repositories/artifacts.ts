import type { ArtifactRecord, RegisterArtifactInput } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function registerArtifact(db: Pool, input: RegisterArtifactInput): Promise<ArtifactRecord> {
  const result = await db.query(
    `
    INSERT INTO artifacts (
      task_id, run_id, store_id, worker_id, account_id, profile_id, kind,
      bucket, object_key, content_type, size_bytes, checksum_sha256, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (bucket, object_key) DO UPDATE SET
      task_id = EXCLUDED.task_id,
      run_id = EXCLUDED.run_id,
      store_id = EXCLUDED.store_id,
      worker_id = EXCLUDED.worker_id,
      account_id = EXCLUDED.account_id,
      profile_id = EXCLUDED.profile_id,
      kind = EXCLUDED.kind,
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      metadata = EXCLUDED.metadata
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
      JSON.stringify(input.metadata || {})
    ]
  );
  return mapArtifact(result.rows[0]);
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
    metadata: row.metadata || {},
    createdAt: row.created_at.toISOString()
  };
}
