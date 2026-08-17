import { createHash } from "node:crypto";
import type { CreateScopeManifestInput, ScopeManifestRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export interface RunScopeReference {
  scopeManifestId: string;
  storeId: string;
  scopeVersion: string;
}

export function assertRunScopeReference(
  input: { storeId: string; scopeVersion?: string },
  manifest: RunScopeReference | undefined
): RunScopeReference {
  if (!manifest) throw new Error("scope_manifest_not_found");
  if (manifest.storeId !== input.storeId) throw new Error("scope_manifest_store_mismatch");
  if (input.scopeVersion && input.scopeVersion !== manifest.scopeVersion) {
    throw new Error("scope_manifest_version_mismatch");
  }
  return manifest;
}

export async function getRunScopeReference(db: Pool, scopeManifestId: string): Promise<RunScopeReference | undefined> {
  const result = await db.query(
    `SELECT scope_manifest_id, store_id, scope_version FROM scope_manifests WHERE scope_manifest_id = $1`,
    [scopeManifestId]
  );
  const row = result.rows[0];
  return row ? {
    scopeManifestId: row.scope_manifest_id,
    storeId: row.store_id,
    scopeVersion: row.scope_version
  } : undefined;
}

export function buildScopeManifest(input: CreateScopeManifestInput): Omit<ScopeManifestRecord, "scopeManifestId" | "frozenAt"> {
  const categories = [...input.categories]
    .map((category) => ({
      canonicalCategoryKey: category.canonicalCategoryKey.normalize("NFC").trim(),
      categoryName: category.categoryName.normalize("NFC").trim(),
      categoryOrder: category.categoryOrder
    }))
    .sort((left, right) => left.canonicalCategoryKey.localeCompare(right.canonicalCategoryKey));
  const manifestHash = createHash("sha256").update(JSON.stringify({
    storeId: input.storeId,
    includeCoupons: input.includeCoupons,
    categories
  }), "utf8").digest("hex");
  return {
    storeId: input.storeId,
    scopeVersion: `scope:${manifestHash.slice(0, 16)}`,
    manifestHash,
    includeCoupons: input.includeCoupons,
    categories,
    sourceArtifactId: input.sourceArtifactId
  };
}

export async function createScopeManifest(db: Pool, input: CreateScopeManifestInput): Promise<ScopeManifestRecord> {
  const manifest = buildScopeManifest(input);
  const result = await db.query(
    `INSERT INTO scope_manifests (
       store_id, scope_version, manifest_hash, include_coupons, categories, source_artifact_id
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (store_id, manifest_hash) DO UPDATE SET manifest_hash = scope_manifests.manifest_hash
     RETURNING *`,
    [
      manifest.storeId,
      manifest.scopeVersion,
      manifest.manifestHash,
      manifest.includeCoupons,
      JSON.stringify(manifest.categories),
      manifest.sourceArtifactId || null
    ]
  );
  return mapScopeManifest(result.rows[0]);
}

export async function listScopeManifests(db: Pool, storeId?: string): Promise<ScopeManifestRecord[]> {
  const result = await db.query(
    `SELECT * FROM scope_manifests WHERE ($1::text IS NULL OR store_id = $1) ORDER BY frozen_at DESC`,
    [storeId || null]
  );
  return result.rows.map(mapScopeManifest);
}

function mapScopeManifest(row: any): ScopeManifestRecord {
  return {
    scopeManifestId: row.scope_manifest_id,
    storeId: row.store_id,
    scopeVersion: row.scope_version,
    manifestHash: row.manifest_hash,
    includeCoupons: row.include_coupons,
    categories: row.categories || [],
    sourceArtifactId: row.source_artifact_id || undefined,
    frozenAt: row.frozen_at.toISOString()
  };
}
