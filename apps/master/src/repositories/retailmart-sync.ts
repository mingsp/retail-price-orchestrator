import type {
  RetailMartSnapshotPreviewRow,
  RetailMartSyncCommitResult,
  RetailMartSyncDryRunResult
} from "@retail-orchestrator/shared";
import mysql from "mysql2/promise";
import type { Pool } from "pg";
import { getDelivery, updateDeliveryStatus } from "./deliveries.js";
import { buildProductDataQualityGateFromDb } from "./products.js";
import { getRunProgress } from "./run-progress.js";

const spuTargetTable = "fact_store_spu_price_snapshot" as const;
const skuTargetTable = "fact_store_sku_price_snapshot" as const;
const targetTables = [spuTargetTable, skuTargetTable] as const;
const requiredFields = ["storeId", "categoryName", "spuId", "productName", "sourceTs"] as const;

export interface RetailMartDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: string;
  timezone: string;
}

export interface RetailMartFactInput {
  runId: string;
  storeId: string;
  storeName: string;
  storeType?: string;
  categoryName?: string;
  categoryOrder?: number;
  spuId: string;
  skuId?: string;
  productName: string;
  sourceTs?: string;
  productFrontDisplayPriceText?: string;
  productFrontDisplayPriceAmount?: number;
  productUserPriceAmount?: number;
  productOriginalPriceAmount?: number;
  brandName?: string;
  priceSemantics?: string;
  userFinalPriceSourcePath?: string;
  productRaw?: Record<string, unknown>;
  skuCount?: number;
  skuRaw?: Record<string, unknown>;
  skuSpecName?: string;
  skuFrontDisplayPriceText?: string;
  skuFrontDisplayPriceAmount?: number;
  skuEffectivePriceAmount?: number;
  skuOriginalPriceAmount?: number;
  skuUpc?: string;
  skuMinPurchaseQuantity?: number;
  skuLimitPurchaseQuantity?: number;
  skuStockQuantity?: number;
  skuStatus?: number;
  skuPromotionInfo?: string;
  skuPriceSemantics?: string;
  skuUserFinalPriceSourcePath?: string;
  promotionInfo?: string;
}

export interface RetailMartSpuFactRow {
  batch_id: string;
  snapshot_hour: string | null;
  channel_code: string;
  store_code: string;
  store_name: string;
  store_role: string;
  category_name: string | null;
  category_order: number | null;
  source_spu_id: string;
  standard_spu_id: string | null;
  product_name: string;
  front_display_price_amount: number | null;
  user_final_price_amount: number | null;
  original_price_amount: number | null;
  promotion_text: string | null;
  match_status: string;
}

export interface RetailMartSkuFactRow {
  batch_id: string;
  snapshot_hour: string | null;
  channel_code: string;
  store_code: string;
  store_name: string;
  store_role: string;
  category_name: string | null;
  category_order: number | null;
  source_spu_id: string;
  source_sku_id: string;
  standard_spu_id: string | null;
  standard_sku_id: string | null;
  product_name: string;
  spec_name: string | null;
  upc: string | null;
  front_display_price_amount: number | null;
  user_final_price_amount: number | null;
  original_price_amount: number | null;
  promotion_text: string | null;
  min_purchase_quantity: number | null;
  limit_purchase_quantity: number | null;
  stock_quantity: number | null;
  sale_status: string;
  match_status: string;
}

interface RetailMartFactRows {
  spuRows: RetailMartSpuFactRow[];
  skuRows: RetailMartSkuFactRow[];
}

export async function buildRetailMartSyncDryRun(
  db: Pool,
  input: { runId: string; minUserFinalPriceCoverage?: number }
): Promise<RetailMartSyncDryRunResult> {
  const minCoverage = input.minUserFinalPriceCoverage ?? 0;
  const [qualityGate, progress, facts] = await Promise.all([
    buildProductDataQualityGateFromDb(db, { runId: input.runId }, { minUserFinalPriceCoverage: minCoverage }),
    getRunProgress(db, input.runId),
    loadRetailMartFactRows(db, input.runId)
  ]);
  const rows = facts.skuRows.map(toPreviewRow);
  const missingFieldStats = buildMissingFieldStats(rows);
  const duplicateSpuKeys = duplicateCount(facts.spuRows, (row) => [row.batch_id, row.store_code, row.source_spu_id]);
  const duplicateSkuKeys = duplicateCount(facts.skuRows, (row) => [row.batch_id, row.store_code, row.source_spu_id, row.source_sku_id]);
  const errors = buildDryRunErrors(rows, missingFieldStats, qualityGate.businessExportAllowed);
  if (!facts.spuRows.length) errors.push("没有可同步到 SPU 价格快照表的候选行。");
  if (!progress?.isDeliverable) errors.push("门店批次尚未通过全部类目和数据完整性校验。");
  if (duplicateSpuKeys > 0) errors.push(`SPU 表存在 ${duplicateSpuKeys} 条重复业务键。`);
  if (duplicateSkuKeys > 0) errors.push(`SKU 表存在 ${duplicateSkuKeys} 条重复业务键。`);
  return {
    runId: input.runId,
    dryRun: true,
    targetTable: skuTargetTable,
    targetTables: [...targetTables],
    status: errors.length ? "blocked" : "ready",
    sourceRows: facts.skuRows.length,
    sourceSpuRows: facts.spuRows.length,
    sourceSkuRows: facts.skuRows.length,
    missingFieldStats,
    qualityGate,
    sampleRows: rows.slice(0, 20),
    errors
  };
}

export async function syncRetailMart(
  db: Pool,
  config: RetailMartDbConfig,
  input: { runId: string; minUserFinalPriceCoverage?: number }
): Promise<RetailMartSyncCommitResult> {
  const dryRun = await buildRetailMartSyncDryRun(db, input);
  if (dryRun.status !== "ready") throw new Error(`retailmart_sync_blocked:${dryRun.errors.join("|")}`);
  const delivery = await getDelivery(db, input.runId);
  if (!delivery || !["frozen", "ready", "synced"].includes(delivery.status)) {
    throw new Error("retailmart_sync_blocked:delivery_not_frozen");
  }
  const facts = await loadRetailMartFactRows(db, input.runId);
  await updateDeliveryStatus(db, input.runId, "syncing");
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset,
    timezone: config.timezone
  });
  try {
    await connection.beginTransaction();
    await upsertRows(connection, spuTargetTable, facts.spuRows);
    await upsertRows(connection, skuTargetTable, facts.skuRows);
    await connection.commit();
    await updateDeliveryStatus(db, input.runId, "synced");
    return {
      runId: input.runId,
      dryRun: false,
      targetTable: skuTargetTable,
      targetTables: [...targetTables],
      status: "synced",
      sourceRows: facts.skuRows.length,
      sourceSpuRows: facts.spuRows.length,
      sourceSkuRows: facts.skuRows.length,
      upsertedRows: facts.skuRows.length,
      upsertedSpuRows: facts.spuRows.length,
      upsertedSkuRows: facts.skuRows.length,
      syncBatchId: input.runId
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    await updateDeliveryStatus(db, input.runId, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await connection.end();
  }
}

export function buildRetailMartSpuFactRow(input: RetailMartFactInput): RetailMartSpuFactRow {
  const productRaw = input.productRaw || {};
  const verifiedFinalPrice = verifiedPrice(
    input.productUserPriceAmount,
    input.priceSemantics,
    input.userFinalPriceSourcePath
  );
  const frontDisplayPrice = finiteNumber(input.productFrontDisplayPriceAmount);
  const originalPrice = finiteNumber(input.productOriginalPriceAmount)
    ?? finiteNumber(deepGet(productRaw, "unify_price.underlined_price"));
  return {
    batch_id: input.runId,
    snapshot_hour: truncateToShanghaiHour(input.sourceTs),
    channel_code: "meituan_h5",
    store_code: input.storeId,
    store_name: input.storeName,
    store_role: normalizeStoreRole(input.storeType),
    category_name: input.categoryName || null,
    category_order: finiteInteger(input.categoryOrder),
    source_spu_id: input.spuId,
    standard_spu_id: null,
    product_name: input.productName,
    front_display_price_amount: frontDisplayPrice,
    user_final_price_amount: verifiedFinalPrice,
    original_price_amount: originalPrice,
    promotion_text: input.promotionInfo || stringValue(productRaw.promotion_info),
    match_status: "unmatched"
  };
}

export function buildRetailMartSkuFactRow(input: RetailMartFactInput): RetailMartSkuFactRow {
  if (!input.skuId) throw new Error("source_sku_id_required");
  const skuRaw = input.skuRaw || {};
  const verifiedFinalPrice = verifiedPrice(
    input.skuEffectivePriceAmount,
    input.skuPriceSemantics,
    input.skuUserFinalPriceSourcePath
  );
  const frontDisplayPrice = finiteNumber(input.skuFrontDisplayPriceAmount);
  const originalPrice = finiteNumber(input.skuOriginalPriceAmount) ?? finiteNumber(skuRaw.origin_price);
  const stockQuantity = finiteNumber(input.skuStockQuantity) ?? finiteNumber(skuRaw.stock);
  return {
    batch_id: input.runId,
    snapshot_hour: truncateToShanghaiHour(input.sourceTs),
    channel_code: "meituan_h5",
    store_code: input.storeId,
    store_name: input.storeName,
    store_role: normalizeStoreRole(input.storeType),
    category_name: input.categoryName || null,
    category_order: finiteInteger(input.categoryOrder),
    source_spu_id: input.spuId,
    source_sku_id: input.skuId,
    standard_spu_id: null,
    standard_sku_id: null,
    product_name: input.productName,
    spec_name: input.skuSpecName || stringValue(skuRaw.spec),
    upc: input.skuUpc || stringValue(skuRaw.upccode),
    front_display_price_amount: frontDisplayPrice,
    user_final_price_amount: verifiedFinalPrice,
    original_price_amount: originalPrice,
    promotion_text: input.skuPromotionInfo || stringValue(skuRaw.promotion_info) || input.promotionInfo || null,
    min_purchase_quantity: finiteNumber(input.skuMinPurchaseQuantity) ?? finiteNumber(skuRaw.min_order_count),
    limit_purchase_quantity: finiteNumber(input.skuLimitPurchaseQuantity)
      ?? finiteNumber(deepGet(skuRaw, "unify_price.activity_info.quota_per_order")),
    stock_quantity: stockQuantity,
    sale_status: resolveSaleStatus(input.skuStatus ?? skuRaw.status, stockQuantity),
    match_status: "unmatched"
  };
}

export function buildMissingFieldStats(rows: RetailMartSnapshotPreviewRow[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const field of requiredFields) stats[field] = 0;
  for (const row of rows) {
    for (const field of requiredFields) if (!hasValue(row[field])) stats[field] += 1;
  }
  return stats;
}

export function buildDryRunErrors(
  rows: RetailMartSnapshotPreviewRow[],
  missingFieldStats: Record<string, number>,
  qualityGatePassed: boolean
): string[] {
  const errors: string[] = [];
  if (!rows.length) errors.push("没有可同步到 SKU 价格快照表的候选行。");
  if (!qualityGatePassed) errors.push("价格数据质量门禁未通过，请检查页面展示价完整性和无效到手价。");
  for (const field of requiredFields) {
    if (missingFieldStats[field]) errors.push(`${field} 缺失 ${missingFieldStats[field]} 行。`);
  }
  return errors;
}

export function truncateToShanghaiHour(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00:00`;
}

async function loadRetailMartFactRows(db: Pool, runId: string): Promise<RetailMartFactRows> {
  const baseCtes = `
    WITH ranked_products AS (
      SELECT p.snapshot_id, p.store_run_id, p.store_id, p.source_ts, p.category_name,
        p.category_order, p.spu_id, p.product_name, p.front_display_price_text,
        p.front_display_price_value, p.user_final_price_value, p.price_semantics,
        p.user_final_price_source_path, p.promotion_info, p.updated_at,
        NULLIF(p.raw#>>'{unify_price,underlined_price}', '')::numeric AS product_original_price_amount,
        st.name AS canonical_store_name,
        COALESCE(st.collection_policy->>'role', 'competitor') AS store_type,
        ROW_NUMBER() OVER (
          PARTITION BY p.store_run_id, p.store_id, p.spu_id
          ORDER BY p.category_order ASC NULLS LAST, p.updated_at DESC, p.snapshot_id DESC
        ) AS primary_rank
      FROM product_snapshots p
      JOIN stores st ON st.store_id = p.store_id
      WHERE p.store_run_id = $1
    ), products AS (
      SELECT * FROM ranked_products WHERE primary_rank = 1
    ), skus AS (
      SELECT DISTINCT ON (s.store_run_id, s.store_id, s.spu_id, s.sku_id) s.*
      FROM sku_snapshots s
      WHERE s.store_run_id = $1
      ORDER BY s.store_run_id, s.store_id, s.spu_id, s.sku_id, s.updated_at DESC, s.snapshot_id DESC
    )
  `;
  const spuResult = await db.query(`${baseCtes}
      SELECT p.*
      FROM products p
      ORDER BY p.category_order ASC NULLS LAST, p.product_name, p.spu_id`, [runId]);
  const skuResult = await db.query(`${baseCtes}
      SELECT p.store_id, p.canonical_store_name, p.store_type, p.category_name, p.category_order,
        p.spu_id, p.product_name, p.promotion_info,
        s.sku_id, s.source_ts, s.spec AS sku_spec_name,
        s.front_display_price_text AS sku_front_display_price_text,
        s.front_display_price_value AS sku_front_display_price_value,
        s.user_final_price_value AS sku_effective_price_amount,
        s.price_semantics AS sku_price_semantics,
        s.user_final_price_source_path AS sku_user_final_price_source_path,
        s.origin_price AS sku_original_price_amount,
        s.stock AS sku_stock_quantity, s.status AS sku_status,
        s.promotion_info AS sku_promotion_info, s.raw->>'upccode' AS sku_upc,
        NULLIF(s.raw->>'min_order_count', '')::numeric AS sku_min_purchase_quantity,
        NULLIF(s.raw#>>'{unify_price,activity_info,quota_per_order}', '')::numeric AS sku_limit_purchase_quantity
      FROM products p
      JOIN skus s USING (store_run_id, store_id, spu_id)
      ORDER BY p.category_order ASC NULLS LAST, p.product_name, p.spu_id, s.sku_id`, [runId]);
  return {
    spuRows: spuResult.rows.map((row) => buildRetailMartSpuFactRow({
      runId,
      storeId: row.store_id,
      storeName: row.canonical_store_name,
      storeType: row.store_type,
      categoryName: row.category_name,
      categoryOrder: optionalNumber(row.category_order),
      spuId: row.spu_id,
      productName: row.product_name,
      sourceTs: row.source_ts?.toISOString(),
      productFrontDisplayPriceText: row.front_display_price_text || undefined,
      productFrontDisplayPriceAmount: optionalNumber(row.front_display_price_value),
      productUserPriceAmount: optionalNumber(row.user_final_price_value),
      productOriginalPriceAmount: optionalNumber(row.product_original_price_amount),
      priceSemantics: row.price_semantics,
      userFinalPriceSourcePath: row.user_final_price_source_path || undefined,
      promotionInfo: row.promotion_info || undefined
    })),
    skuRows: skuResult.rows.map((row) => buildRetailMartSkuFactRow({
      runId,
      storeId: row.store_id,
      storeName: row.canonical_store_name,
      storeType: row.store_type,
      categoryName: row.category_name,
      categoryOrder: optionalNumber(row.category_order),
      spuId: row.spu_id,
      skuId: row.sku_id,
      productName: row.product_name,
      sourceTs: row.source_ts?.toISOString(),
      skuSpecName: row.sku_spec_name || undefined,
      skuFrontDisplayPriceText: row.sku_front_display_price_text || undefined,
      skuFrontDisplayPriceAmount: optionalNumber(row.sku_front_display_price_value),
      skuEffectivePriceAmount: optionalNumber(row.sku_effective_price_amount),
      skuOriginalPriceAmount: optionalNumber(row.sku_original_price_amount),
      skuUpc: row.sku_upc || undefined,
      skuMinPurchaseQuantity: optionalNumber(row.sku_min_purchase_quantity),
      skuLimitPurchaseQuantity: optionalNumber(row.sku_limit_purchase_quantity),
      skuStockQuantity: optionalNumber(row.sku_stock_quantity),
      skuStatus: optionalNumber(row.sku_status),
      skuPromotionInfo: row.sku_promotion_info || undefined,
      skuPriceSemantics: row.sku_price_semantics || undefined,
      skuUserFinalPriceSourcePath: row.sku_user_final_price_source_path || undefined,
      promotionInfo: row.promotion_info || undefined
    }))
  };
}

function toPreviewRow(row: RetailMartSkuFactRow): RetailMartSnapshotPreviewRow {
  return {
    storeId: row.store_code,
    storeName: row.store_name,
    categoryName: row.category_name || undefined,
    spuId: row.source_spu_id,
    skuId: row.source_sku_id,
    productName: row.product_name,
    frontDisplayPriceText: row.front_display_price_amount === null ? undefined : String(row.front_display_price_amount),
    userFinalPriceText: row.user_final_price_amount === null ? undefined : String(row.user_final_price_amount),
    promotionInfo: row.promotion_text || undefined,
    sourceTs: row.snapshot_hour || undefined,
    dataQuality: row.user_final_price_amount !== null ? "pass" : "missing_user_final_price"
  };
}

async function upsertRows<T extends object>(
  connection: mysql.Connection,
  table: string,
  rows: T[]
): Promise<void> {
  if (!rows.length) return;
  for (let offset = 0; offset < rows.length; offset += 250) {
    const chunk = rows.slice(offset, offset + 250);
    const columns = Object.keys(chunk[0]) as Array<keyof T>;
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    const values = chunk.flatMap((row) => columns.map((column) => row[column]));
    const updates = buildUpsertUpdateColumns(columns.map(String))
      .map((column) => `\`${String(column)}\`=VALUES(\`${String(column)}\`)`)
      .join(",");
    await connection.query(
      `INSERT INTO ${table} (${columns.map((column) => `\`${String(column)}\``).join(",")}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`,
      values
    );
  }
}

export function buildUpsertUpdateColumns(columns: readonly string[]): string[] {
  const immutableColumns = new Set([
    "batch_id",
    "store_code",
    "source_spu_id",
    "source_sku_id",
    "standard_spu_id",
    "standard_sku_id",
    "match_status"
  ]);
  return columns.filter((column) => !immutableColumns.has(column));
}

function duplicateCount<T>(rows: T[], keyOf: (row: T) => unknown[]): number {
  return rows.length - new Set(rows.map((row) => JSON.stringify(keyOf(row)))).size;
}

function verifiedPrice(value: unknown, semantics?: string, sourcePath?: string): number | null {
  const amount = finiteNumber(value);
  return semantics === "actual_payable" && Boolean(sourcePath) && amount !== null && amount > 0 ? amount : null;
}

function resolveSaleStatus(status: unknown, stock: number | null): string {
  if (stock !== null && stock <= 0) return "out_of_stock";
  if (Number(status) === 1) return "out_of_stock";
  if (Number(status) === 0) return "available";
  return "unknown";
}

function normalizeStoreRole(value?: string): string {
  return value === "own_store" || value === "own" ? "own" : "competitor";
}

function deepGet(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number) ? number : undefined;
}

function finiteNumber(value: unknown): number | null {
  return optionalNumber(value) ?? null;
}

function finiteInteger(value: unknown): number | null {
  const number = optionalNumber(value);
  return number === undefined ? null : Math.trunc(number);
}

function stringValue(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}
