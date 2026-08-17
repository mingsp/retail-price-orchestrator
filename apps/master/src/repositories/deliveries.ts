import type { ArtifactRecord, DataDeliveryRecord } from "@retail-orchestrator/shared";
import type { Client } from "minio";
import type { Pool } from "pg";
import { verifyArtifactStorageEvidence } from "./artifacts.js";
import { buildProductDataQualityGateFromDb, summarizeProductSnapshots } from "./products.js";
import { getRunProgress } from "./run-progress.js";

export function buildFreezeBlockers(input: {
  runDeliverable: boolean;
  qualityGatePassed: boolean;
  rawArtifactCount: number;
  productCount: number;
}): string[] {
  const blockers: string[] = [];
  if (!input.runDeliverable) blockers.push("门店批次尚未完成全部类目校验。");
  if (!input.qualityGatePassed) blockers.push("价格数据完整性校验未通过。");
  if (input.rawArtifactCount <= 0) blockers.push("缺少已归档的原始 JSONL 数据。");
  if (input.productCount <= 0) blockers.push("没有可交付的结构化商品数据。");
  return blockers;
}

export async function freezeDelivery(
  db: Pool,
  s3: Client,
  runId: string,
  minUserFinalPriceCoverage = 0
): Promise<{ delivery?: DataDeliveryRecord; blockers: string[] }> {
  const [progress, summary, qualityGate, categoryArtifactResult] = await Promise.all([
    getRunProgress(db, runId),
    summarizeProductSnapshots(db, { runId }),
    buildProductDataQualityGateFromDb(db, { runId }, { minUserFinalPriceCoverage }),
    db.query(
      `
      SELECT
        t.task_id,
        t.category_name,
        a.artifact_id,
        a.bucket,
        a.object_key,
        a.size_bytes,
        a.checksum_sha256,
        a.storage_version_id
      FROM category_tasks t
      LEFT JOIN LATERAL (
        SELECT artifact_id, bucket, object_key, size_bytes, checksum_sha256, storage_version_id
        FROM artifacts
        WHERE task_id = t.task_id AND kind = 'raw_jsonl'
        ORDER BY created_at DESC
        LIMIT 1
      ) a ON true
      WHERE t.run_id = $1
        AND NOT (t.status = 'skipped' AND COALESCE((t.cursor->>'exclusionEvidence')::boolean, false))
      ORDER BY t.category_order, t.created_at
      `,
      [runId]
    )
  ]);
  const coverageRows = categoryArtifactResult.rows.map((row) => ({
    taskId: row.task_id,
    categoryName: row.category_name,
    artifactId: row.artifact_id || undefined
  }));
  const rawCoverageBlockers = buildRawArtifactCoverageBlockers(coverageRows);
  const rawArtifactCount = coverageRows.filter((row) => row.artifactId).length;
  const blockers = buildFreezeBlockers({
    runDeliverable: Boolean(progress?.isDeliverable),
    qualityGatePassed: qualityGate.businessExportAllowed,
    rawArtifactCount,
    productCount: summary.productCount
  });
  blockers.push(...rawCoverageBlockers);
  if (!blockers.length) {
    for (const row of categoryArtifactResult.rows) {
      try {
        await verifyArtifactStorageEvidence(s3, {
          artifactId: row.artifact_id,
          bucket: row.bucket,
          objectKey: row.object_key,
          sizeBytes: row.size_bytes === null ? undefined : Number(row.size_bytes),
          checksumSha256: row.checksum_sha256 || undefined,
          storageVersionId: row.storage_version_id || undefined
        } as Pick<ArtifactRecord, "artifactId" | "bucket" | "objectKey" | "sizeBytes" | "checksumSha256" | "storageVersionId">);
        if (!row.storage_version_id) throw new Error(`artifact_version_missing:${row.artifact_id}`);
      } catch (error) {
        blockers.push(`有效类目「${row.category_name}」的原始数据对象校验失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (blockers.length) return { blockers };

  const result = await db.query(
    `
    INSERT INTO data_deliveries (
      run_id, version, status, product_count, sku_count, user_final_price_coverage,
      raw_artifact_count, frozen_at, updated_at
    ) VALUES ($1,1,'frozen',$2,$3,$4,$5,now(),now())
    ON CONFLICT (run_id) DO UPDATE SET
      version = data_deliveries.version + 1,
      status = 'frozen',
      product_count = EXCLUDED.product_count,
      sku_count = EXCLUDED.sku_count,
      user_final_price_coverage = EXCLUDED.user_final_price_coverage,
      raw_artifact_count = EXCLUDED.raw_artifact_count,
      export_artifact_id = NULL,
      last_error = NULL,
      frozen_at = now(),
      updated_at = now()
    RETURNING *
    `,
    [runId, summary.productCount, summary.skuCount, qualityGate.userFinalPriceCoverage, rawArtifactCount]
  );
  return { delivery: mapDelivery(result.rows[0]), blockers: [] };
}

export function buildRawArtifactCoverageBlockers(
  rows: Array<{ taskId: string; categoryName: string; artifactId?: string }>
): string[] {
  return rows
    .filter((row) => !row.artifactId)
    .map((row) => `有效类目「${row.categoryName}」缺少对应的原始 JSONL 产物（${row.taskId}）。`);
}

export async function listDeliveries(db: Pool): Promise<DataDeliveryRecord[]> {
  const result = await db.query(`SELECT * FROM data_deliveries ORDER BY updated_at DESC LIMIT 200`);
  return result.rows.map(mapDelivery);
}

export async function getDelivery(db: Pool, runId: string): Promise<DataDeliveryRecord | null> {
  const result = await db.query(`SELECT * FROM data_deliveries WHERE run_id = $1`, [runId]);
  return result.rows[0] ? mapDelivery(result.rows[0]) : null;
}

export async function updateDeliveryStatus(
  db: Pool,
  runId: string,
  status: DataDeliveryRecord["status"],
  lastError?: string
): Promise<DataDeliveryRecord | null> {
  const result = await db.query(
    `UPDATE data_deliveries SET status = $2, last_error = $3, updated_at = now() WHERE run_id = $1 RETURNING *`,
    [runId, status, lastError || null]
  );
  return result.rows[0] ? mapDelivery(result.rows[0]) : null;
}

export async function markDeliveryExportReady(
  db: Pool,
  runId: string,
  exportArtifactId: string
): Promise<DataDeliveryRecord | null> {
  const result = await db.query(
    `UPDATE data_deliveries SET status = 'ready', export_artifact_id = $2, last_error = NULL, updated_at = now() WHERE run_id = $1 RETURNING *`,
    [runId, exportArtifactId]
  );
  return result.rows[0] ? mapDelivery(result.rows[0]) : null;
}

function mapDelivery(row: any): DataDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    runId: row.run_id,
    version: row.version,
    status: row.status,
    productCount: row.product_count,
    skuCount: row.sku_count,
    userFinalPriceCoverage: Number(row.user_final_price_coverage),
    rawArtifactCount: row.raw_artifact_count,
    exportArtifactId: row.export_artifact_id || undefined,
    lastError: row.last_error || undefined,
    frozenAt: row.frozen_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
