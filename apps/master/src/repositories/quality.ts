import type { PriceQualityRecord, RegisterPriceQualityInput } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { evaluateTaskQuality } from "./quality-evaluator.js";

export async function registerPriceQuality(db: Pool, input: RegisterPriceQualityInput): Promise<PriceQualityRecord> {
  if (!input.taskId || !input.artifactId) throw new Error("quality_task_and_artifact_required");
  const context = await db.query(
    `SELECT t.status, t.expected_items, a.checksum_sha256, a.task_id AS artifact_task_id,
            a.run_id AS artifact_run_id, a.store_id AS artifact_store_id
     FROM category_tasks t
     LEFT JOIN artifacts a ON a.artifact_id = $2
     WHERE t.task_id = $1`,
    [input.taskId, input.artifactId]
  );
  const row = context.rows[0];
  if (!row) throw new Error("quality_task_not_found");
  const categoryComplete = input.metadata?.categoryComplete === true;
  const artifactVerified = Boolean(row.checksum_sha256)
    && row.artifact_task_id === input.taskId
    && (!input.runId || row.artifact_run_id === input.runId)
    && (!input.storeId || row.artifact_store_id === input.storeId);
  const decision = evaluateTaskQuality({
    taskStatus: row.status,
    artifactVerified,
    rawRows: input.rawRows,
    uniqueSpuCount: input.uniqueSpuCount,
    skuRows: input.skuRows,
    frontDisplayPricePresent: input.frontDisplayPricePresent,
    categoryComplete,
    expectedItems: row.expected_items == null ? undefined : Number(row.expected_items)
  });
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
      decision.status,
      JSON.stringify({ ...(input.metadata || {}), masterDecisionReasons: decision.reasons })
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
