import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";

interface WorkbookSource {
  store: Array<string | number | null>;
  categories: Array<Array<string | number | null>>;
  coupons: Array<Array<string | number | null>>;
  products: Array<Array<string | number | null>>;
  stats: {
    runId: string;
    sourceRows: number;
    productRows: number;
    categoryRows: number;
    couponRows: number;
    firstCollectedAt: string;
    lastCollectedAt: string;
  };
}

async function main(): Promise<void> {
  const outputDir = process.argv[2];
  const runIds = process.argv.slice(3);
  if (!outputDir || !runIds.length) {
    throw new Error("usage: export-template-workbook-source <output-dir> <run-id>...");
  }

  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  await fs.mkdir(outputDir, { recursive: true });

  const connection = await mysql.createConnection(config.retailMart);
  try {
    for (const runId of runIds) {
      const source = await buildSource(connection, runId);
      const outputPath = path.join(outputDir, `${runId}.workbook-source.json`);
      await fs.writeFile(outputPath, JSON.stringify(source), "utf8");
      process.stdout.write(
        `${runId}: 商品 ${source.products.length}，类目 ${source.categories.length}，优惠券 ${source.coupons.length}。\n`
      );
    }
  } finally {
    await connection.end();
  }
}

async function buildSource(connection: mysql.Connection, runId: string): Promise<WorkbookSource> {
  const [summaryRows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT
      store_snapshot_id,
      store_name,
      source_store_id,
      COUNT(*) AS source_rows,
      DATE_FORMAT(MIN(collected_at), '%Y-%m-%d %H:%i:%s') AS first_collected_at,
      DATE_FORMAT(MAX(collected_at), '%Y-%m-%d %H:%i:%s') AS last_collected_at
    FROM fact_store_raw_data_snapshot
    WHERE store_snapshot_id = ?
    GROUP BY store_snapshot_id, store_name, source_store_id
  `, [runId]);
  const summary = summaryRows[0];
  if (!summary) throw new Error(`raw_store_snapshot_not_found:${runId}`);

  const categoryMap = new Map<string, Record<string, any>>();
  const productMap = new Map<string, Array<string | number | null>>();
  const couponMap = new Map<string, Array<string | number | null>>();
  const parentIdByIndex = new Map<number, string>();
  const parentIdByName = new Map<string, string>();
  let rawProductRows = 0;
  let rawCategoryRows = 0;
  let lastId = 0;

  for (;;) {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT id, record_type, raw_data
      FROM fact_store_raw_data_snapshot
      WHERE store_snapshot_id = ? AND id > ?
      ORDER BY id
      LIMIT 250
    `, [runId, lastId]);
    if (!rows.length) break;

    for (const row of rows) {
      lastId = Number(row.id);
      const payload = parseJson(row.raw_data);
      if (row.record_type === "category") {
        rawCategoryRows += 1;
        const category = objectValue(payload.category);
        const index = toNumber(category.i);
        const tag = textOrNull(category.tag);
        if (index !== null && tag?.endsWith("_27")) {
          parentIdByIndex.set(index, tag.slice(0, -3));
        }
        const key = `${index ?? ""}|${toNumber(category.j) ?? ""}|${tag ?? ""}|${textOrNull(category.name) ?? ""}`;
        categoryMap.set(key, category);
        continue;
      }
      if (row.record_type !== "product") continue;
      rawProductRows += 1;

      const product = Object.keys(objectValue(payload.productRaw)).length
        ? objectValue(payload.productRaw)
        : objectValue(payload.product);
      if (!Object.keys(product).length) continue;
      const category = objectValue(payload.category);
      const productIndex = objectValue(payload.productIndex);
      const productIndexSkus = Array.isArray(productIndex.skus) ? productIndex.skus : [];
      const indexSkuById = new Map(
        productIndexSkus.map((sku: any) => [String(sku.skuId ?? sku.id ?? ""), sku])
      );
      const parentId = textOrNull(product.tag);
      const parentName = textOrNull(category.parentName) || textOrNull(category.name);
      const categoryIndex = toNumber(category.i);
      if (parentId && categoryIndex !== null) parentIdByIndex.set(categoryIndex, parentId);
      if (parentId && parentName) parentIdByName.set(parentName, parentId);

      const spuId = idText(product.id, product.spu_id, productIndex.spuId);
      const skus = Array.isArray(product.skus) ? product.skus : [];
      for (const skuValue of skus) {
        const sku = objectValue(skuValue);
        const skuId = idText(sku.id, sku.sku_id);
        if (!spuId || !skuId) continue;
        const normalizedSku = objectValue(indexSkuById.get(skuId));
        const standardCategories = Array.isArray(product.standardCategorys) ? product.standardCategorys : [];
        const categoryByLevel = new Map(
          standardCategories.map((item: any) => [Number(item.level), objectValue(item)])
        );
        const collectedDate = shanghaiDate(payload.ts || summary.first_collected_at);
        const rowKey = `${parentId ?? textOrNull(category.tag) ?? ""}|${spuId}|${skuId}`;
        productMap.set(rowKey, [
          collectedDate,
          String(summary.store_name),
          String(summary.source_store_id || ""),
          parentId || textOrNull(category.tag),
          parentName,
          spuId,
          skuId,
          textOrNull(sku.upccode),
          idText(categoryByLevel.get(1)?.id),
          idText(categoryByLevel.get(2)?.id),
          idText(categoryByLevel.get(3)?.id),
          textOrNull(categoryByLevel.get(1)?.name),
          textOrNull(categoryByLevel.get(2)?.name),
          textOrNull(categoryByLevel.get(3)?.name),
          textOrNull(product.name),
          textOrNull(sku.spec) || textOrNull(sku.cspu_grouping_value),
          numberOrNull(firstDefined(
            normalizedSku.frontDisplayPrice,
            sku.unify_price?.price,
            sku.price
          )),
          numberOrNull(firstDefined(
            normalizedSku.originPrice,
            sku.origin_price,
            sku.unify_price?.underlined_price
          )),
          numberOrNull(firstDefined(sku.real_stock, sku.stock)),
          textOrNull(product.month_saled_content),
          textOrNull(product.want_to_buy_content) || numberOrNull(product.want_to_Buy),
          numberOrNull(firstDefined(product.praise_num_new, product.praise_num)),
          numberOrNull(product.tread_num),
          textOrNull(product.praise_rate) || textOrNull(product.praise_rate_num),
          textOrNull(sku.picture) || textOrNull(product.picture)
        ]);

        const coupon = firstObject(sku.promotion?.coupon, product.promotion?.coupon);
        if (coupon) {
          const couponId = idText(coupon.id, coupon.coupon_id, coupon.couponId);
          const activityId = idText(coupon.activity_id, coupon.activityId);
          const couponName = textOrNull(coupon.name) || textOrNull(coupon.title) || textOrNull(coupon.coupon_name);
          const couponKey = `${couponId ?? ""}|${activityId ?? ""}|${couponName ?? ""}`;
          couponMap.set(couponKey, [
            collectedDate,
            String(summary.store_name),
            String(summary.source_store_id || ""),
            couponName,
            valueOrNull(coupon.status),
            valueOrNull(firstDefined(coupon.type, coupon.coupon_type)),
            textOrNull(coupon.type_name) || textOrNull(coupon.coupon_type_name),
            textOrNull(coupon.activity_category),
            couponId,
            activityId,
            numberOrNull(firstDefined(coupon.min_amount, coupon.threshold, coupon.min_price)),
            numberOrNull(firstDefined(coupon.discount_amount, coupon.amount, coupon.discount)),
            textOrNull(coupon.display_text) || textOrNull(coupon.desc),
            timeText(coupon.created_at),
            timeText(firstDefined(coupon.start_time, coupon.startTime)),
            timeText(firstDefined(coupon.end_time, coupon.endTime))
          ]);
        }
      }
    }
  }

  const firstCollectedAt = String(summary.first_collected_at);
  const storeDate = firstCollectedAt.slice(0, 10);
  const sourceStoreId = String(summary.source_store_id || "");
  const categories = [...categoryMap.values()]
    .sort((left, right) => (toNumber(left.i) ?? 0) - (toNumber(right.i) ?? 0) || (toNumber(left.j) ?? 0) - (toNumber(right.j) ?? 0))
    .map((category) => {
      const index = toNumber(category.i);
      const tag = textOrNull(category.tag);
      const parentName = textOrNull(category.parentName) || textOrNull(category.name);
      const parentId = (index !== null ? parentIdByIndex.get(index) : undefined)
        || (parentName ? parentIdByName.get(parentName) : undefined)
        || (tag?.endsWith("_27") ? tag.slice(0, -3) : null);
      return [
        storeDate,
        String(summary.store_name),
        sourceStoreId,
        parentId,
        parentName,
        index === null ? null : index + 1,
        numberOrNull(firstDefined(category.product_count, category.spus)),
        tag,
        textOrNull(category.name),
        toNumber(category.j) === null ? null : Math.max(1, Number(category.j) + 1)
      ];
    });

  return {
    store: [
      storeDate,
      String(summary.store_name),
      sourceStoreId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      `https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=${encodeURIComponent(sourceStoreId)}`
    ],
    categories,
    coupons: [...couponMap.values()],
    products: [...productMap.values()],
    stats: {
      runId,
      sourceRows: Number(summary.source_rows),
      productRows: rawProductRows,
      categoryRows: rawCategoryRows,
      couponRows: couponMap.size,
      firstCollectedAt,
      lastCollectedAt: String(summary.last_collected_at)
    }
  };
}

function parseJson(value: unknown): Record<string, any> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, any>;
  return objectValue(value);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function firstObject(...values: unknown[]): Record<string, any> | null {
  for (const value of values) {
    const candidate = objectValue(value);
    if (Object.keys(candidate).length) return candidate;
  }
  return null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function idText(...values: unknown[]): string | null {
  return textOrNull(firstDefined(...values));
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberOrNull(value: unknown): number | null {
  return toNumber(value);
}

function valueOrNull(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return textOrNull(value);
}

function timeText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && value > 0) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? shanghaiDateTime(date) : String(value);
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? shanghaiDateTime(date) : String(value);
}

function shanghaiDate(value: unknown): string {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shanghaiDateTime(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
