import type {
  ProductDataQualityGate,
  ProductSnapshotBatchInput,
  ProductSnapshotInput,
  ProductSnapshotSummary,
  SkuSnapshotInput
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { assertActiveTaskWriteLease, type TaskWriteLease } from "./task-write-guard.js";

export function validateProductBatchIdentity(batch: ProductSnapshotBatchInput): Required<Pick<ProductSnapshotInput, "runId" | "taskId" | "storeId" | "workerId">> {
  const rows = [...batch.products, ...batch.skus];
  const first = rows[0];
  if (!first) throw new Error("empty_product_batch");
  const writeWorkerId = batch.writeWorkerId || first.workerId;
  if (!writeWorkerId) throw new Error("product_batch_worker_required");
  for (const row of rows) {
    if (
      row.runId !== first.runId ||
      row.taskId !== first.taskId ||
      row.storeId !== first.storeId ||
      (!batch.writeWorkerId && row.workerId !== first.workerId)
    ) throw new Error("mixed_product_batch_identity");
  }
  return {
    runId: first.runId,
    taskId: first.taskId,
    storeId: first.storeId,
    workerId: writeWorkerId
  };
}

export async function ingestProductSnapshotBatch(
  db: Pool,
  batch: ProductSnapshotBatchInput,
  lease?: Omit<TaskWriteLease, "taskId" | "workerId">
): Promise<{ products: number; skus: number }> {
  const identity = validateProductBatchIdentity(batch);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertActiveTaskWriteLease(client, { ...identity, ...lease });
    for (const product of batch.products) {
      await client.query(productUpsertSql, productParams(product, batch.artifactId));
      await client.query(productCategoryMembershipUpsertSql, productCategoryMembershipParams(product));
    }
    for (const sku of batch.skus) {
      await client.query(skuUpsertSql, skuParams(sku, batch.artifactId));
    }
    await client.query("COMMIT");
    return { products: batch.products.length, skus: batch.skus.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function summarizeProductSnapshots(
  db: Pool,
  filters: { runId?: string; taskId?: string; storeId?: string }
): Promise<ProductSnapshotSummary> {
  const productResult = await db.query(
    `
    SELECT
      COUNT(*)::int AS product_count,
      COALESCE(SUM(CASE
        WHEN jsonb_typeof(p.raw->'skus') = 'array' THEN jsonb_array_length(p.raw->'skus')
        ELSE 0
      END), 0)::int AS raw_embedded_sku_count,
      COUNT(*) FILTER (WHERE front_display_price_text IS NOT NULL OR front_display_price_value IS NOT NULL)::int AS front_display_price_count,
      COUNT(*) FILTER (
        WHERE price_semantics = 'actual_payable'
          AND user_final_price_source_path IS NOT NULL
          AND user_final_price_value > 0
      )::int AS user_final_price_count,
      COUNT(*) FILTER (
        WHERE price_semantics = 'actual_payable'
          AND user_final_price_source_path IS NOT NULL
          AND (user_final_price_value IS NULL OR user_final_price_value <= 0)
      )::int AS invalid_user_final_price_count,
      MAX(updated_at) AS latest_snapshot_at
    FROM product_snapshots p
    WHERE p.store_run_id IS NOT NULL
      AND p.run_id = p.store_run_id::text
      AND ($1::text IS NULL OR p.store_run_id::text = $1)
      AND ($2::text IS NULL OR p.task_uuid::text = $2)
      AND ($3::text IS NULL OR p.store_id = $3)
    `,
    [filters.runId || null, filters.taskId || null, filters.storeId || null]
  );
  const skuResult = await db.query(
    `
    SELECT
      COUNT(*)::int AS sku_count,
      COUNT(*) FILTER (WHERE front_display_price_text IS NOT NULL OR front_display_price_value IS NOT NULL)::int AS front_display_price_count,
      COUNT(*) FILTER (
        WHERE price_semantics = 'actual_payable'
          AND user_final_price_source_path IS NOT NULL
          AND user_final_price_value > 0
      )::int AS user_final_price_count,
      COUNT(*) FILTER (
        WHERE price_semantics = 'actual_payable'
          AND user_final_price_source_path IS NOT NULL
          AND (user_final_price_value IS NULL OR user_final_price_value <= 0)
      )::int AS invalid_user_final_price_count
    FROM sku_snapshots s
    WHERE s.store_run_id IS NOT NULL
      AND s.run_id = s.store_run_id::text
      AND ($1::text IS NULL OR s.store_run_id::text = $1)
      AND ($2::text IS NULL OR s.task_uuid::text = $2)
      AND ($3::text IS NULL OR s.store_id = $3)
    `,
    [filters.runId || null, filters.taskId || null, filters.storeId || null]
  );
  const rawEvidenceResult = await db.query(
    `
    WITH product_raw_skus AS (
      SELECT
        p.store_id,
        p.spu_id,
        COALESCE(
          raw_sku->>'id',
          raw_sku->>'sku_id',
          raw_sku->>'skuId',
          raw_sku->>'wm_food_sku_id'
        ) AS sku_id
      FROM product_snapshots p
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p.raw->'skus') = 'array' THEN p.raw->'skus'
          ELSE '[]'::jsonb
        END
      ) raw_sku
      WHERE p.store_run_id IS NOT NULL
        AND p.run_id = p.store_run_id::text
        AND ($1::text IS NULL OR p.store_run_id::text = $1)
        AND ($2::text IS NULL OR p.task_uuid::text = $2)
        AND ($3::text IS NULL OR p.store_id = $3)
    ),
    sku_raw_rows AS (
      SELECT s.store_id, s.spu_id, s.sku_id
      FROM sku_snapshots s
      WHERE s.store_run_id IS NOT NULL
        AND s.run_id = s.store_run_id::text
        AND ($1::text IS NULL OR s.store_run_id::text = $1)
        AND ($2::text IS NULL OR s.task_uuid::text = $2)
        AND ($3::text IS NULL OR s.store_id = $3)
        AND jsonb_typeof(s.raw) = 'object'
        AND COALESCE(
          s.raw->>'id',
          s.raw->>'sku_id',
          s.raw->>'skuId',
          s.raw->>'wm_food_sku_id'
        ) = s.sku_id
    )
    SELECT COUNT(*)::int AS raw_evidenced_sku_count
    FROM (
      SELECT store_id, spu_id, sku_id
      FROM product_raw_skus
      WHERE sku_id IS NOT NULL AND sku_id <> ''
      UNION
      SELECT store_id, spu_id, sku_id
      FROM sku_raw_rows
    ) raw_evidence
    `,
    [filters.runId || null, filters.taskId || null, filters.storeId || null]
  );
  const row = productResult.rows[0] || {};
  const skuRow = skuResult.rows[0] || {};
  const rawEvidenceRow = rawEvidenceResult.rows[0] || {};
  return {
    ...filters,
    productCount: Number(row.product_count || 0),
    skuCount: Number(skuRow.sku_count || 0),
    rawEmbeddedSkuCount: row.raw_embedded_sku_count === undefined ? undefined : Number(row.raw_embedded_sku_count || 0),
    rawEvidencedSkuCount:
      rawEvidenceRow.raw_evidenced_sku_count === undefined
        ? undefined
        : Number(rawEvidenceRow.raw_evidenced_sku_count || 0),
    frontDisplayPriceCount: Number(row.front_display_price_count || 0) + Number(skuRow.front_display_price_count || 0),
    userFinalPriceCount: Number(row.user_final_price_count || 0) + Number(skuRow.user_final_price_count || 0),
    invalidUserFinalPriceCount:
      Number(row.invalid_user_final_price_count || 0) + Number(skuRow.invalid_user_final_price_count || 0),
    latestSnapshotAt: row.latest_snapshot_at?.toISOString()
  };
}

export async function summarizeCurrentValidProductSnapshots(
  db: Pool,
  filters: { runId?: string; taskId?: string; storeId?: string } = {}
): Promise<ProductSnapshotSummary> {
  const params = [filters.storeId || null, filters.runId || null, filters.taskId || null];
  const productResult = await db.query(`
    SELECT
      COUNT(*)::int AS product_count,
      COALESCE(SUM(CASE
        WHEN jsonb_typeof(p.raw->'skus') = 'array' THEN jsonb_array_length(p.raw->'skus')
        ELSE 0
      END), 0)::int AS raw_embedded_sku_count,
      COUNT(*) FILTER (WHERE p.front_display_price_text IS NOT NULL OR p.front_display_price_value IS NOT NULL)::int
        AS front_display_price_count,
      COUNT(*) FILTER (
        WHERE p.price_semantics = 'actual_payable'
          AND p.user_final_price_source_path IS NOT NULL
          AND p.user_final_price_value > 0
      )::int AS user_final_price_count,
      COUNT(*) FILTER (
        WHERE p.price_semantics = 'actual_payable'
          AND p.user_final_price_source_path IS NOT NULL
          AND (p.user_final_price_value IS NULL OR p.user_final_price_value <= 0)
      )::int AS invalid_user_final_price_count,
      MAX(p.updated_at) AS latest_snapshot_at
    FROM product_snapshots p
    WHERE p.run_id = p.store_run_id::text
      AND p.store_run_id IN (${currentProductionRunsSql})
      AND ($1::text IS NULL OR p.store_id = $1)
      AND ($2::text IS NULL OR p.store_run_id::text = $2)
      AND ($3::text IS NULL OR p.task_uuid::text = $3)
      AND EXISTS (
        SELECT 1
        FROM product_category_memberships m
        JOIN category_tasks t ON t.task_id = m.task_id
        WHERE m.run_id = p.store_run_id
          AND m.store_id = p.store_id
          AND m.spu_id = p.spu_id
          AND t.status = 'completed_valid'
      )
  `, params);
  const skuResult = await db.query(`
    SELECT
      COUNT(*)::int AS sku_count,
      COUNT(*) FILTER (WHERE s.front_display_price_text IS NOT NULL OR s.front_display_price_value IS NOT NULL)::int
        AS front_display_price_count,
      COUNT(*) FILTER (
        WHERE s.price_semantics = 'actual_payable'
          AND s.user_final_price_source_path IS NOT NULL
          AND s.user_final_price_value > 0
      )::int AS user_final_price_count,
      COUNT(*) FILTER (
        WHERE s.price_semantics = 'actual_payable'
          AND s.user_final_price_source_path IS NOT NULL
          AND (s.user_final_price_value IS NULL OR s.user_final_price_value <= 0)
      )::int AS invalid_user_final_price_count
    FROM sku_snapshots s
    WHERE s.run_id = s.store_run_id::text
      AND s.store_run_id IN (${currentProductionRunsSql})
      AND ($1::text IS NULL OR s.store_id = $1)
      AND ($2::text IS NULL OR s.store_run_id::text = $2)
      AND ($3::text IS NULL OR s.task_uuid::text = $3)
      AND EXISTS (
        SELECT 1
        FROM product_category_memberships m
        JOIN category_tasks t ON t.task_id = m.task_id
        WHERE m.run_id = s.store_run_id
          AND m.store_id = s.store_id
          AND m.spu_id = s.spu_id
          AND t.status = 'completed_valid'
      )
  `, params);
  const rawEvidenceResult = await db.query(`
    WITH product_raw_skus AS (
      SELECT
        p.store_id,
        p.spu_id,
        COALESCE(
          raw_sku->>'id',
          raw_sku->>'sku_id',
          raw_sku->>'skuId',
          raw_sku->>'wm_food_sku_id'
        ) AS sku_id
      FROM product_snapshots p
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p.raw->'skus') = 'array' THEN p.raw->'skus'
          ELSE '[]'::jsonb
        END
      ) raw_sku
      WHERE p.run_id = p.store_run_id::text
        AND p.store_run_id IN (${currentProductionRunsSql})
        AND ($1::text IS NULL OR p.store_id = $1)
        AND ($2::text IS NULL OR p.store_run_id::text = $2)
        AND ($3::text IS NULL OR p.task_uuid::text = $3)
        AND EXISTS (
          SELECT 1
          FROM product_category_memberships m
          JOIN category_tasks t ON t.task_id = m.task_id
          WHERE m.run_id = p.store_run_id
            AND m.store_id = p.store_id
            AND m.spu_id = p.spu_id
            AND t.status = 'completed_valid'
        )
    ),
    sku_raw_rows AS (
      SELECT s.store_id, s.spu_id, s.sku_id
      FROM sku_snapshots s
      WHERE s.run_id = s.store_run_id::text
        AND s.store_run_id IN (${currentProductionRunsSql})
        AND ($1::text IS NULL OR s.store_id = $1)
        AND ($2::text IS NULL OR s.store_run_id::text = $2)
        AND ($3::text IS NULL OR s.task_uuid::text = $3)
        AND jsonb_typeof(s.raw) = 'object'
        AND COALESCE(
          s.raw->>'id',
          s.raw->>'sku_id',
          s.raw->>'skuId',
          s.raw->>'wm_food_sku_id'
        ) = s.sku_id
        AND EXISTS (
          SELECT 1
          FROM product_category_memberships m
          JOIN category_tasks t ON t.task_id = m.task_id
          WHERE m.run_id = s.store_run_id
            AND m.store_id = s.store_id
            AND m.spu_id = s.spu_id
            AND t.status = 'completed_valid'
        )
    )
    SELECT COUNT(*)::int AS raw_evidenced_sku_count
    FROM (
      SELECT store_id, spu_id, sku_id
      FROM product_raw_skus
      WHERE sku_id IS NOT NULL AND sku_id <> ''
      UNION
      SELECT store_id, spu_id, sku_id
      FROM sku_raw_rows
    ) raw_evidence
  `, params);
  const row = productResult.rows[0] || {};
  const skuRow = skuResult.rows[0] || {};
  const rawEvidenceRow = rawEvidenceResult.rows[0] || {};
  return {
    runId: filters.runId,
    taskId: filters.taskId,
    storeId: filters.storeId,
    productCount: Number(row.product_count || 0),
    skuCount: Number(skuRow.sku_count || 0),
    rawEmbeddedSkuCount: row.raw_embedded_sku_count === undefined ? undefined : Number(row.raw_embedded_sku_count || 0),
    rawEvidencedSkuCount:
      rawEvidenceRow.raw_evidenced_sku_count === undefined
        ? undefined
        : Number(rawEvidenceRow.raw_evidenced_sku_count || 0),
    frontDisplayPriceCount: Number(row.front_display_price_count || 0) + Number(skuRow.front_display_price_count || 0),
    userFinalPriceCount: Number(row.user_final_price_count || 0) + Number(skuRow.user_final_price_count || 0),
    invalidUserFinalPriceCount:
      Number(row.invalid_user_final_price_count || 0) + Number(skuRow.invalid_user_final_price_count || 0),
    latestSnapshotAt: row.latest_snapshot_at?.toISOString()
  };
}

const currentProductionRunsSql = `
  SELECT selected.run_id
  FROM (
    SELECT DISTINCT ON (r.store_id) r.run_id, r.store_id, r.created_at
    FROM store_runs r
    WHERE r.status IN ('running', 'paused', 'completed')
      AND EXISTS (SELECT 1 FROM category_tasks rt WHERE rt.run_id = r.run_id)
    ORDER BY r.store_id, r.created_at DESC
  ) selected
`;

export async function buildProductDataQualityGateFromDb(
  db: Pool,
  filters: { runId?: string; taskId?: string; storeId?: string },
  options: { minUserFinalPriceCoverage?: number } = {}
): Promise<ProductDataQualityGate> {
  const summary = await summarizeProductSnapshots(db, filters);
  const artifactResult =
    isUuidOrEmpty(filters.runId) && isUuidOrEmpty(filters.taskId)
      ? await db.query(
          `
          SELECT artifact_id, object_key
          FROM artifacts
          WHERE ($1::uuid IS NULL OR run_id = $1::uuid)
            AND ($2::uuid IS NULL OR task_id = $2::uuid)
            AND ($3::text IS NULL OR store_id = $3::text)
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [filters.runId || null, filters.taskId || null, filters.storeId || null]
        )
      : { rows: [] };
  return buildProductDataQualityGate(summary, {
    minUserFinalPriceCoverage: options.minUserFinalPriceCoverage,
    latestArtifactId: artifactResult.rows[0]?.artifact_id,
    latestArtifactObjectKey: artifactResult.rows[0]?.object_key
  });
}

export function buildProductDataQualityGate(
  summary: ProductSnapshotSummary,
  options: {
    minUserFinalPriceCoverage?: number;
    latestArtifactId?: string;
    latestArtifactObjectKey?: string;
  } = {}
): ProductDataQualityGate {
  const totalSnapshotRows = summary.productCount + summary.skuCount;
  // Retained for API compatibility and reporting only. A promotion-derived final
  // price is optional; the page display price is the mandatory business price.
  const minUserFinalPriceCoverage = clampCoverage(options.minUserFinalPriceCoverage ?? 0);
  const frontDisplayPriceCoverage = totalSnapshotRows ? summary.frontDisplayPriceCount / totalSnapshotRows : 0;
  const missingFrontDisplayPriceCount = Math.max(totalSnapshotRows - summary.frontDisplayPriceCount, 0);
  const userFinalPriceCoverage = totalSnapshotRows ? summary.userFinalPriceCount / totalSnapshotRows : 0;
  const missingUserFinalPriceCount = Math.max(totalSnapshotRows - summary.userFinalPriceCount, 0);
  const invalidUserFinalPriceCount = Math.max(summary.invalidUserFinalPriceCount || 0, 0);
  const rawEmbeddedSkuCount = summary.rawEmbeddedSkuCount;
  const rawEvidencedSkuCount = summary.rawEvidencedSkuCount ?? rawEmbeddedSkuCount;
  const skuReconciliationDelta = rawEvidencedSkuCount === undefined
    ? undefined
    : summary.skuCount - rawEvidencedSkuCount;
  const businessExportAllowed = totalSnapshotRows > 0
    && invalidUserFinalPriceCount === 0
    && missingFrontDisplayPriceCount === 0
    && (skuReconciliationDelta === undefined || skuReconciliationDelta === 0);
  return {
    runId: summary.runId,
    taskId: summary.taskId,
    storeId: summary.storeId,
    status: businessExportAllowed ? "pass" : "fail",
    businessExportAllowed,
    minUserFinalPriceCoverage,
    totalSnapshotRows,
    productCount: summary.productCount,
    skuCount: summary.skuCount,
    rawEmbeddedSkuCount,
    rawEvidencedSkuCount,
    skuReconciliationDelta,
    frontDisplayPriceCount: summary.frontDisplayPriceCount,
    frontDisplayPriceCoverage,
    missingFrontDisplayPriceCount,
    userFinalPriceCount: summary.userFinalPriceCount,
    invalidUserFinalPriceCount,
    userFinalPriceCoverage,
    missingUserFinalPriceCount,
    latestSnapshotAt: summary.latestSnapshotAt,
    latestArtifactId: options.latestArtifactId,
    latestArtifactObjectKey: options.latestArtifactObjectKey,
    reason: invalidUserFinalPriceCount > 0
      ? `发现 ${invalidUserFinalPriceCount} 条无效到手价，禁止业务导出。`
      : skuReconciliationDelta !== undefined && skuReconciliationDelta !== 0
        ? `原始记录可核验 ${rawEvidencedSkuCount} 个 SKU，结构化表为 ${summary.skuCount} 个，相差 ${Math.abs(skuReconciliationDelta)} 个，禁止业务导出。`
      : missingFrontDisplayPriceCount > 0
        ? `页面展示价缺失 ${missingFrontDisplayPriceCount} 行，禁止业务导出。`
      : businessExportAllowed
        ? "页面展示价完整且无无效到手价；到手价覆盖率仅作优惠信息参考。"
        : "当前范围内没有结构化商品快照，禁止业务导出。"
  };
}

export function summarizeProductBatch(batch: ProductSnapshotBatchInput): {
  products: number;
  skus: number;
  frontDisplayPriceCount: number;
  userFinalPriceCount: number;
} {
  return {
    products: batch.products.length,
    skus: batch.skus.length,
    frontDisplayPriceCount:
      batch.products.filter((product) => product.frontDisplayPriceText || product.frontDisplayPriceValue !== undefined).length +
      batch.skus.filter((sku) => sku.frontDisplayPriceText || sku.frontDisplayPriceValue !== undefined).length,
    userFinalPriceCount:
      batch.products.filter((product) => product.userFinalPriceText || product.userFinalPriceValue !== undefined).length +
      batch.skus.filter((sku) => sku.userFinalPriceText || sku.userFinalPriceValue !== undefined).length
  };
}

export function buildProductUniqueKey(input: Pick<ProductSnapshotInput, "runId" | "storeId" | "categoryName" | "spuId">): string {
  return `${input.runId}|${input.storeId}|${input.categoryName}|${input.spuId}`;
}

export function buildSkuUniqueKey(input: Pick<SkuSnapshotInput, "runId" | "storeId" | "categoryName" | "spuId" | "skuId">): string {
  return `${input.runId}|${input.storeId}|${input.categoryName}|${input.spuId}|${input.skuId}`;
}

const productUpsertSql = `
  INSERT INTO product_snapshots (
    unique_key, artifact_id, run_id, task_id, store_id, store_name, worker_id, account_id,
    account_label, profile_id, cdp_endpoint_id, cdp_port, source, source_ts, category_name,
    category_display_name, parent_category_name, category_order, category_tag, spu_id,
    product_name, min_price, origin_price_text, unit, picture, month_saled_content,
    promotion_info, front_display_price_text, front_display_price_value, user_final_price_text,
    user_final_price_value, price_source_path, raw, capture_id, store_run_id, task_uuid,
    user_final_price_source_path, price_semantics, updated_at
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::uuid,$36::uuid,$37,$38,now()
  )
  ON CONFLICT (unique_key) DO UPDATE SET
    artifact_id = EXCLUDED.artifact_id,
    store_name = EXCLUDED.store_name,
    worker_id = EXCLUDED.worker_id,
    account_id = EXCLUDED.account_id,
    account_label = EXCLUDED.account_label,
    profile_id = EXCLUDED.profile_id,
    cdp_endpoint_id = EXCLUDED.cdp_endpoint_id,
    cdp_port = EXCLUDED.cdp_port,
    source = EXCLUDED.source,
    source_ts = EXCLUDED.source_ts,
    product_name = EXCLUDED.product_name,
    min_price = EXCLUDED.min_price,
    origin_price_text = EXCLUDED.origin_price_text,
    unit = EXCLUDED.unit,
    picture = EXCLUDED.picture,
    month_saled_content = EXCLUDED.month_saled_content,
    promotion_info = EXCLUDED.promotion_info,
    front_display_price_text = EXCLUDED.front_display_price_text,
    front_display_price_value = EXCLUDED.front_display_price_value,
    user_final_price_text = EXCLUDED.user_final_price_text,
    user_final_price_value = EXCLUDED.user_final_price_value,
    price_source_path = EXCLUDED.price_source_path,
    capture_id = EXCLUDED.capture_id,
    store_run_id = EXCLUDED.store_run_id,
    task_uuid = EXCLUDED.task_uuid,
    user_final_price_source_path = EXCLUDED.user_final_price_source_path,
    price_semantics = EXCLUDED.price_semantics,
    raw = EXCLUDED.raw,
    updated_at = now()
`;

const skuUpsertSql = `
  INSERT INTO sku_snapshots (
    unique_key, artifact_id, run_id, task_id, store_id, worker_id, account_id, profile_id,
    cdp_endpoint_id, source_ts, category_name, spu_id, sku_id, product_name, spec, price,
    origin_price, stock, status, promotion_info, front_display_price_text,
    front_display_price_value, user_final_price_text, user_final_price_value, price_source_path,
    raw, capture_id, store_run_id, task_uuid, user_final_price_source_path, price_semantics, updated_at
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28::uuid,$29::uuid,$30,$31,now()
  )
  ON CONFLICT (unique_key) DO UPDATE SET
    artifact_id = EXCLUDED.artifact_id,
    worker_id = EXCLUDED.worker_id,
    account_id = EXCLUDED.account_id,
    profile_id = EXCLUDED.profile_id,
    cdp_endpoint_id = EXCLUDED.cdp_endpoint_id,
    source_ts = EXCLUDED.source_ts,
    product_name = EXCLUDED.product_name,
    spec = EXCLUDED.spec,
    price = EXCLUDED.price,
    origin_price = EXCLUDED.origin_price,
    stock = EXCLUDED.stock,
    status = EXCLUDED.status,
    promotion_info = EXCLUDED.promotion_info,
    front_display_price_text = EXCLUDED.front_display_price_text,
    front_display_price_value = EXCLUDED.front_display_price_value,
    user_final_price_text = EXCLUDED.user_final_price_text,
    user_final_price_value = EXCLUDED.user_final_price_value,
    price_source_path = EXCLUDED.price_source_path,
    capture_id = EXCLUDED.capture_id,
    store_run_id = EXCLUDED.store_run_id,
    task_uuid = EXCLUDED.task_uuid,
    user_final_price_source_path = EXCLUDED.user_final_price_source_path,
    price_semantics = EXCLUDED.price_semantics,
    raw = EXCLUDED.raw,
    updated_at = now()
`;

function productParams(product: ProductSnapshotInput, artifactId?: string): unknown[] {
  return [
    buildProductUniqueKey(product),
    artifactId || null,
    product.runId,
    product.taskId,
    product.storeId,
    product.storeName || null,
    product.workerId || null,
    product.accountId || null,
    product.accountLabel || null,
    product.profileId || null,
    product.cdpEndpointId || null,
    product.cdpPort ?? null,
    product.source || null,
    product.sourceTs || null,
    product.categoryName,
    product.categoryDisplayName || null,
    product.parentCategoryName || null,
    product.categoryOrder ?? null,
    product.categoryTag || null,
    product.spuId,
    product.productName,
    product.minPrice ?? null,
    product.originPriceText || null,
    product.unit || null,
    product.picture || null,
    product.monthSaledContent || null,
    product.promotionInfo || null,
    product.frontDisplayPriceText || null,
    product.frontDisplayPriceValue ?? null,
    product.userFinalPriceText || null,
    product.userFinalPriceValue ?? null,
    product.priceSourcePath || null,
    JSON.stringify(product.raw || {}),
    product.captureId || null,
    product.runId,
    product.taskId,
    product.userFinalPriceSourcePath || null,
    product.priceSemantics || "front_display_only"
  ];
}

function skuParams(sku: SkuSnapshotInput, artifactId?: string): unknown[] {
  return [
    buildSkuUniqueKey(sku),
    artifactId || null,
    sku.runId,
    sku.taskId,
    sku.storeId,
    sku.workerId || null,
    sku.accountId || null,
    sku.profileId || null,
    sku.cdpEndpointId || null,
    sku.sourceTs || null,
    sku.categoryName,
    sku.spuId,
    sku.skuId,
    sku.productName,
    sku.spec || null,
    sku.price ?? null,
    sku.originPrice ?? null,
    sku.stock ?? null,
    sku.status ?? null,
    sku.promotionInfo || null,
    sku.frontDisplayPriceText || null,
    sku.frontDisplayPriceValue ?? null,
    sku.userFinalPriceText || null,
    sku.userFinalPriceValue ?? null,
    sku.priceSourcePath || null,
    JSON.stringify(sku.raw || {}),
    sku.captureId || null,
    sku.runId,
    sku.taskId,
    sku.userFinalPriceSourcePath || null,
    sku.priceSemantics || "front_display_only"
  ];
}

const productCategoryMembershipUpsertSql = `
  INSERT INTO product_category_memberships (
    run_id, task_id, store_id, spu_id, category_name, category_tag, category_order
  )
  VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7)
  ON CONFLICT (run_id, store_id, spu_id, category_name) DO UPDATE SET
    task_id = EXCLUDED.task_id,
    category_tag = EXCLUDED.category_tag,
    category_order = EXCLUDED.category_order,
    updated_at = now()
`;

function productCategoryMembershipParams(product: ProductSnapshotInput): unknown[] {
  return [
    product.runId,
    product.taskId,
    product.storeId,
    product.spuId,
    product.categoryName,
    product.categoryTag || null,
    product.categoryOrder ?? null
  ];
}

function clampCoverage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isUuidOrEmpty(value?: string): boolean {
  if (!value) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
