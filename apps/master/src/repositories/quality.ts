import type { PriceQualityRecord, RegisterPriceQualityInput } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function registerPriceQuality(db: Pool, input: RegisterPriceQualityInput): Promise<PriceQualityRecord> {
  const result = await db.query(
    `
    INSERT INTO price_quality_checks (
      task_id, run_id, store_id, worker_id, account_id, profile_id, artifact_id,
      raw_rows, unique_spu_count, sku_rows, front_display_price_present,
      sku_front_display_price_present, actual_price_info_present, promotion_info_present,
      dynamic_label_present, duplicate_spu_count, completeness_status, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *
    `,
    [
      input.taskId || null,
      input.runId || null,
      input.storeId || null,
      input.workerId || null,
      input.accountId || null,
      input.profileId || null,
      input.artifactId || null,
      input.rawRows,
      input.uniqueSpuCount,
      input.skuRows,
      input.frontDisplayPricePresent,
      input.skuFrontDisplayPricePresent,
      input.actualPriceInfoPresent || 0,
      input.promotionInfoPresent || 0,
      input.dynamicLabelPresent || 0,
      input.duplicateSpuCount || 0,
      input.completenessStatus,
      JSON.stringify(input.metadata || {})
    ]
  );
  return mapQuality(result.rows[0]);
}

export async function listPriceQuality(
  db: Pool,
  filters: { taskId?: string; runId?: string; storeId?: string }
): Promise<PriceQualityRecord[]> {
  const result = await db.query(
    `
    SELECT *
    FROM price_quality_checks
    WHERE ($1::uuid IS NULL OR task_id = $1::uuid)
      AND ($2::uuid IS NULL OR run_id = $2::uuid)
      AND ($3::text IS NULL OR store_id = $3::text)
    ORDER BY checked_at DESC
    LIMIT 500
    `,
    [filters.taskId || null, filters.runId || null, filters.storeId || null]
  );
  return result.rows.map(mapQuality);
}

function mapQuality(row: any): PriceQualityRecord {
  return {
    qualityId: row.quality_id,
    taskId: row.task_id || undefined,
    runId: row.run_id || undefined,
    storeId: row.store_id || undefined,
    workerId: row.worker_id || undefined,
    accountId: row.account_id || undefined,
    profileId: row.profile_id || undefined,
    artifactId: row.artifact_id || undefined,
    rawRows: row.raw_rows,
    uniqueSpuCount: row.unique_spu_count,
    skuRows: row.sku_rows,
    frontDisplayPricePresent: row.front_display_price_present,
    skuFrontDisplayPricePresent: row.sku_front_display_price_present,
    actualPriceInfoPresent: row.actual_price_info_present,
    promotionInfoPresent: row.promotion_info_present,
    dynamicLabelPresent: row.dynamic_label_present,
    duplicateSpuCount: row.duplicate_spu_count,
    completenessStatus: row.completeness_status,
    metadata: row.metadata || {},
    checkedAt: row.checked_at.toISOString()
  };
}
