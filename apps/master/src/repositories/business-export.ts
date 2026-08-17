import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { Client } from "minio";
import type { Pool } from "pg";
import { registerArtifact } from "./artifacts.js";
import { getDelivery, markDeliveryExportReady, updateDeliveryStatus } from "./deliveries.js";

export const businessProductColumns = [
  "门店", "类目", "商品名称", "用户到手价", "前端展示价", "基础展示价", "划线价", "优惠/活动",
  "前端标签", "限购数量", "月售", "想买/热度", "好评率", "规格数", "图片"
] as const;

export function buildExportObjectKey(runId: string, version: number): string {
  return `business-exports/${runId}/v${version}/store-price-data.xlsx`;
}

export async function exportDeliveryWorkbook(db: Pool, s3: Client, runId: string) {
  const delivery = await getDelivery(db, runId);
  if (!delivery || !["frozen", "ready", "synced"].includes(delivery.status)) {
    throw new Error("delivery_not_frozen");
  }
  await updateDeliveryStatus(db, runId, "exporting");
  try {
    const [productResult, skuResult, runResult] = await Promise.all([
      loadBusinessProducts(db, runId),
      loadBusinessSkus(db, runId),
      db.query(`SELECT r.store_id, r.run_label, s.name AS store_name FROM store_runs r JOIN stores s ON s.store_id = r.store_id WHERE r.run_id = $1`, [runId])
    ]);
    if (!runResult.rows[0]) throw new Error("run_not_found");
    const workbook = buildBusinessWorkbook(productResult.rows, skuResult.rows, {
      storeName: runResult.rows[0].store_name,
      runLabel: runResult.rows[0].run_label,
      coverage: delivery.userFinalPriceCoverage
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const objectKey = buildExportObjectKey(runId, delivery.version);
    const stored = await s3.putObject("exports", objectKey, buffer, buffer.length, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const artifact = await registerArtifact(db, {
      runId,
      storeId: runResult.rows[0].store_id,
      kind: "export",
      bucket: "exports",
      objectKey,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.length,
      checksumSha256: createHash("sha256").update(buffer).digest("hex"),
      storageVersionId: stored.versionId || undefined,
      metadata: {
        deliveryVersion: delivery.version,
        productRows: productResult.rows.length,
        skuRows: skuResult.rows.length,
        userFinalPriceCoverage: delivery.userFinalPriceCoverage
      }
    });
    await markDeliveryExportReady(db, runId, artifact.artifactId);
    return { artifact, productRows: productResult.rows.length, skuRows: skuResult.rows.length };
  } catch (error) {
    await updateDeliveryStatus(db, runId, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export function buildBusinessWorkbook(products: any[], skus: any[], context: { storeName: string; runLabel: string; coverage: number }): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "商圈比价数据采集系统";
  workbook.created = new Date();
  const productSheet = workbook.addWorksheet("商品清单", { views: [{ state: "frozen", ySplit: 1 }] });
  productSheet.columns = businessProductColumns.map((header) => ({ header, key: header, width: columnWidth(header) }));
  for (const row of products) productSheet.addRow(productBusinessRow(row));
  styleSheet(productSheet, new Set(["用户到手价", "基础展示价", "划线价"]));

  const skuHeaders = ["门店", "类目", "商品名称", "规格", "条码", "SKU到手价", "SKU前端展示价", "SKU单件价", "SKU原价", "起购数量", "限购数量", "SKU优惠/活动", "库存", "图片"];
  const skuSheet = workbook.addWorksheet("SKU规格明细", { views: [{ state: "frozen", ySplit: 1 }] });
  skuSheet.columns = skuHeaders.map((header) => ({ header, key: header, width: columnWidth(header) }));
  for (const row of skus) skuSheet.addRow(skuBusinessRow(row));
  styleSheet(skuSheet, new Set(["SKU到手价", "SKU单件价", "SKU原价"]));

  const categorySheet = workbook.addWorksheet("类目汇总", { views: [{ state: "frozen", ySplit: 1 }] });
  categorySheet.columns = ["类目", "去重商品数", "SKU数", "有真实到手价商品数"].map((header) => ({ header, key: header, width: 24 }));
  const categories = new Map<string, { products: Set<string>; skus: number; actual: Set<string> }>();
  for (const row of products) {
    const category = row.category_name || "未分类";
    const entry = categories.get(category) || { products: new Set(), skus: 0, actual: new Set() };
    entry.products.add(row.spu_id);
    if (row.actual_price !== null) entry.actual.add(row.spu_id);
    categories.set(category, entry);
  }
  for (const row of skus) {
    const category = row.category_name || "未分类";
    const entry = categories.get(category) || { products: new Set(), skus: 0, actual: new Set() };
    entry.skus += 1;
    categories.set(category, entry);
  }
  for (const [category, value] of [...categories.entries()].sort((a, b) => b[1].products.size - a[1].products.size)) {
    categorySheet.addRow({ 类目: category, 去重商品数: value.products.size, SKU数: value.skus, 有真实到手价商品数: value.actual.size });
  }
  styleSheet(categorySheet, new Set());

  const noteSheet = workbook.addWorksheet("说明");
  noteSheet.columns = [{ header: "项目", key: "项目", width: 24 }, { header: "内容", key: "内容", width: 88 }];
  noteSheet.addRows([
    { 项目: "门店", 内容: context.storeName },
    { 项目: "批次", 内容: context.runLabel },
    { 项目: "导出时间", 内容: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "medium" }).format(new Date()) },
    { 项目: "商品行数", 内容: products.length },
    { 项目: "SKU行数", 内容: skus.length },
    { 项目: "真实用户到手价覆盖率", 内容: `${(context.coverage * 100).toFixed(2)}%` },
    { 项目: "价格口径", 内容: "前端展示价与有来源证据的用户到手价分开保存；没有真实证据时到手价留空。" },
    { 项目: "字段说明", 内容: "已移除批次 ID、账号、Profile、CDP、接口路径等机器字段；商品名称保持采集原文。" }
  ]);
  styleSheet(noteSheet, new Set());
  return workbook;
}

async function loadBusinessProducts(db: Pool, runId: string) {
  return db.query(`
    SELECT DISTINCT ON (p.store_id, p.category_name, p.spu_id)
      p.store_id, p.store_name, p.category_name, p.spu_id, p.product_name,
      CASE WHEN p.price_semantics = 'actual_payable' AND p.user_final_price_source_path IS NOT NULL AND p.user_final_price_value > 0 THEN p.user_final_price_value END AS actual_price,
      p.front_display_price_text, p.raw, p.promotion_info
    FROM product_snapshots p
    WHERE p.store_run_id = $1
    ORDER BY p.store_id, p.category_name, p.spu_id, p.updated_at DESC
  `, [runId]);
}

async function loadBusinessSkus(db: Pool, runId: string) {
  return db.query(`
    WITH products AS (
      SELECT DISTINCT ON (store_id, category_name, spu_id) store_id, spu_id, store_name, category_name, product_name, picture
      FROM product_snapshots WHERE store_run_id = $1 ORDER BY store_id, category_name, spu_id, updated_at DESC
    )
    SELECT DISTINCT ON (s.store_id, s.category_name, s.spu_id, s.sku_id)
      p.store_name, COALESCE(s.category_name, p.category_name) AS category_name, p.product_name,
      s.sku_id, s.spec, s.raw,
      CASE WHEN s.price_semantics = 'actual_payable' AND s.user_final_price_source_path IS NOT NULL AND s.user_final_price_value > 0 THEN s.user_final_price_value END AS actual_price,
      s.front_display_price_text, s.price, s.origin_price, s.stock, s.promotion_info, p.picture
    FROM sku_snapshots s JOIN products p ON p.store_id = s.store_id AND p.spu_id = s.spu_id AND p.category_name = s.category_name
    WHERE s.store_run_id = $1
    ORDER BY s.store_id, s.category_name, s.spu_id, s.sku_id, s.updated_at DESC
  `, [runId]);
}

function productBusinessRow(row: any): Record<string, unknown> {
  const raw = row.raw || {};
  return {
    门店: row.store_name,
    类目: row.category_name,
    商品名称: row.product_name,
    用户到手价: numberOrBlank(row.actual_price),
    前端展示价: row.front_display_price_text || "",
    基础展示价: numberOrBlank(deep(raw, "unify_price.price")),
    划线价: numberOrBlank(deep(raw, "unify_price.underlined_price")),
    "优惠/活动": row.promotion_info || "",
    前端标签: collectLabels(raw),
    限购数量: numberOrBlank(deep(raw, "unify_price.activity_info.quota_per_order")),
    月售: raw.month_saled_content || "",
    "想买/热度": raw.want_to_buy_content || "",
    好评率: raw.praise_rate || "",
    规格数: Array.isArray(raw.skus) ? raw.skus.length : "",
    图片: raw.picture || ""
  };
}

function skuBusinessRow(row: any): Record<string, unknown> {
  const raw = row.raw || {};
  return {
    门店: row.store_name,
    类目: row.category_name,
    商品名称: row.product_name,
    规格: row.spec || "",
    条码: raw.upccode || "",
    SKU到手价: numberOrBlank(row.actual_price),
    SKU前端展示价: row.front_display_price_text || "",
    SKU单件价: numberOrBlank(row.price),
    SKU原价: numberOrBlank(row.origin_price),
    起购数量: numberOrBlank(raw.min_order_count),
    限购数量: numberOrBlank(deep(raw, "unify_price.activity_info.quota_per_order")),
    "SKU优惠/活动": row.promotion_info || "",
    库存: numberOrBlank(row.stock),
    图片: raw.picture || row.picture || ""
  };
}

function styleSheet(sheet: ExcelJS.Worksheet, moneyHeaders: Set<string>): void {
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  sheet.getRow(1).height = 24;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1677FF" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  for (const column of sheet.columns) {
    const header = String(column.header || "");
    column.alignment = { vertical: "top", wrapText: false };
    if (moneyHeaders.has(header)) column.numFmt = "0.00";
  }
}

function columnWidth(header: string): number {
  if (header === "商品名称") return 46;
  if (["优惠/活动", "前端标签", "图片"].includes(header)) return 30;
  if (["门店", "类目"].includes(header)) return 22;
  return 15;
}
function deep(value: any, path: string): unknown { return path.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value); }
function numberOrBlank(value: unknown): number | "" { const parsed = Number(value); return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : ""; }
function collectLabels(raw: any): string { const values: string[] = []; for (const group of raw.dynamic_act_labels || []) for (const tag of group.sub_tags || []) if (tag.text) values.push(String(tag.text)); return [...new Set(values)].join("；"); }
