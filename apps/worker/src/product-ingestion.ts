import fs from "node:fs";
import readline from "node:readline";
import type { ProductSnapshotBatchInput, ProductSnapshotInput, SkuSnapshotInput } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { registerProductSnapshots } from "./master-api.js";

interface RawProductLine {
  ts?: string;
  runId?: string;
  captureId?: string;
  taskId?: string;
  source?: string;
  worker?: { workerId?: string };
  account?: { accountId?: string; accountLabel?: string; profileId?: string; cdpPort?: number };
  store?: { storeId?: string; storeName?: string };
  category?: {
    i?: number;
    j?: number;
    parentName?: string;
    name?: string;
    displayName?: string;
    tag?: string;
  };
  productIndex?: {
    spuId?: string | number;
    name?: string;
    minPrice?: number;
    originPrice?: string | number;
    unit?: string;
    picture?: string;
    monthSaledContent?: string;
  };
  productRaw?: Record<string, any>;
}

export async function ingestRawProductJsonl(
  config: WorkerConfig,
  filePath: string,
  options: {
    artifactId?: string;
    batchSize?: number;
    maxBatchBytes?: number;
    canonicalIdentity?: CanonicalTaskIdentity;
  } = {}
): Promise<IngestionResult> {
  const batchSize = options.batchSize || 25;
  const maxBatchBytes = options.maxBatchBytes || 700_000;
  let batch: ProductSnapshotBatchInput = { artifactId: options.artifactId, products: [], skus: [] };
  let products = 0;
  let skus = 0;
  let batches = 0;
  let rawRows = 0;
  let frontDisplayPricePresent = 0;
  let skuFrontDisplayPricePresent = 0;
  let actualPriceInfoPresent = 0;
  let promotionInfoPresent = 0;
  const uniqueSpuIds = new Set<string>();
  const uniqueCategorySpuIds = new Set<string>();

  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    rawRows++;
    const parsed = buildProductIngestionRowsFromRawLine(line, options.canonicalIdentity);
    batch.products.push(...parsed.products);
    batch.skus.push(...parsed.skus);
    products += parsed.products.length;
    skus += parsed.skus.length;
    for (const product of parsed.products) {
      uniqueSpuIds.add(`${product.storeId}|${product.spuId}`);
      uniqueCategorySpuIds.add(`${product.storeId}|${product.categoryName}|${product.spuId}`);
      if (product.frontDisplayPriceText || product.frontDisplayPriceValue !== undefined) frontDisplayPricePresent++;
      if (product.userFinalPriceSourcePath) actualPriceInfoPresent++;
      if (product.promotionInfo) promotionInfoPresent++;
    }
    for (const sku of parsed.skus) {
      if (sku.frontDisplayPriceText || sku.frontDisplayPriceValue !== undefined) skuFrontDisplayPricePresent++;
      if (sku.userFinalPriceSourcePath) actualPriceInfoPresent++;
      if (sku.promotionInfo) promotionInfoPresent++;
    }
    if (shouldFlushBatch(batch, batchSize, maxBatchBytes)) {
      await registerProductSnapshots(config, batch);
      batches++;
      batch = { artifactId: options.artifactId, products: [], skus: [] };
    }
  }

  if (batch.products.length || batch.skus.length) {
    await registerProductSnapshots(config, batch);
    batches++;
  }
  return {
    products,
    skus,
    batches,
    rawRows,
    uniqueSpuCount: uniqueSpuIds.size,
    frontDisplayPricePresent,
    skuFrontDisplayPricePresent,
    actualPriceInfoPresent,
    promotionInfoPresent,
    duplicateSpuCount: Math.max(products - uniqueSpuIds.size, 0),
    uniqueCategorySpuCount: uniqueCategorySpuIds.size,
    repeatedCrossCategorySpuCount: Math.max(uniqueCategorySpuIds.size - uniqueSpuIds.size, 0)
  };
}

export interface IngestionResult {
  products: number;
  skus: number;
  batches: number;
  rawRows: number;
  uniqueSpuCount: number;
  frontDisplayPricePresent: number;
  skuFrontDisplayPricePresent: number;
  actualPriceInfoPresent: number;
  promotionInfoPresent: number;
  duplicateSpuCount: number;
  uniqueCategorySpuCount: number;
  repeatedCrossCategorySpuCount: number;
}

function shouldFlushBatch(batch: ProductSnapshotBatchInput, batchSize: number, maxBatchBytes: number): boolean {
  const rowCount = batch.products.length + batch.skus.length;
  if (rowCount >= batchSize) return true;
  if (rowCount === 0) return false;
  return Buffer.byteLength(JSON.stringify(batch), "utf8") >= maxBatchBytes;
}

interface CanonicalTaskIdentity {
  runId: string;
  taskId: string;
  captureId: string;
}

export function buildProductIngestionRowsFromRawLine(
  line: string,
  canonicalIdentity?: CanonicalTaskIdentity
): ProductSnapshotBatchInput {
  const raw = JSON.parse(line) as RawProductLine;
  const runId = canonicalIdentity?.runId || raw.runId;
  const taskId = canonicalIdentity?.taskId || raw.taskId;
  const captureId = canonicalIdentity?.captureId || raw.captureId;
  const productRaw = raw.productRaw || {};
  const productIndex = raw.productIndex || {};
  const categoryName = raw.category?.displayName || raw.category?.name || "";
  const spuId = String(productRaw.id ?? productIndex.spuId ?? "");
  if (!spuId || !runId || !taskId || !raw.store?.storeId || !categoryName) {
    return { products: [], skus: [] };
  }

  const productName = String(productRaw.name ?? productIndex.name ?? "");
  const productPrice = extractDisplayPrice(productRaw, "productRaw.unify_price");
  const product: ProductSnapshotInput = {
    runId,
    captureId,
    taskId,
    storeId: raw.store.storeId,
    storeName: raw.store.storeName,
    workerId: raw.worker?.workerId,
    accountId: raw.account?.accountId,
    accountLabel: raw.account?.accountLabel,
    profileId: raw.account?.profileId,
    cdpPort: raw.account?.cdpPort,
    source: raw.source,
    sourceTs: raw.ts,
    categoryName,
    categoryDisplayName: raw.category?.displayName,
    parentCategoryName: raw.category?.parentName,
    categoryOrder: categoryOrder(raw.category?.i, raw.category?.j),
    categoryTag: raw.category?.tag,
    spuId,
    productName,
    minPrice: numberOrUndefined(productRaw.min_price ?? productIndex.minPrice),
    originPriceText: stringOrUndefined(productIndex.originPrice),
    unit: stringOrUndefined(productRaw.unit ?? productIndex.unit),
    picture: stringOrUndefined(productRaw.picture ?? productIndex.picture),
    monthSaledContent: stringOrUndefined(productRaw.month_saled_content ?? productIndex.monthSaledContent),
    promotionInfo: stringOrUndefined(productRaw.promotion_info),
    frontDisplayPriceText: productPrice.frontDisplayPriceText,
    frontDisplayPriceValue: productPrice.frontDisplayPriceValue,
    userFinalPriceText: productPrice.userFinalPriceText,
    userFinalPriceValue: productPrice.userFinalPriceValue,
    priceSourcePath: productPrice.priceSourcePath,
    userFinalPriceSourcePath: productPrice.userFinalPriceSourcePath,
    priceSemantics: productPrice.priceSemantics,
    raw: productRaw
  };

  const skus = Array.isArray(productRaw.skus)
    ? productRaw.skus.map((sku: Record<string, any>) => {
        const skuPrice = extractDisplayPrice(sku, "sku.unify_price");
        return {
          runId,
          captureId,
          taskId,
          storeId: raw.store!.storeId!,
          workerId: raw.worker?.workerId,
          accountId: raw.account?.accountId,
          profileId: raw.account?.profileId,
          sourceTs: raw.ts,
          categoryName,
          spuId,
          skuId: String(sku.id ?? sku.sku_id ?? ""),
          productName,
          spec: stringOrUndefined(sku.spec ?? sku.cspu_grouping_value),
          price: numberOrUndefined(sku.price),
          originPrice: numberOrUndefined(sku.origin_price),
          stock: numberOrUndefined(sku.stock),
          status: numberOrUndefined(sku.status),
          promotionInfo: stringOrUndefined(sku.promotion_info),
          frontDisplayPriceText: skuPrice.frontDisplayPriceText,
          frontDisplayPriceValue: skuPrice.frontDisplayPriceValue,
          userFinalPriceText: skuPrice.userFinalPriceText,
          userFinalPriceValue: skuPrice.userFinalPriceValue,
          priceSourcePath: skuPrice.priceSourcePath,
          userFinalPriceSourcePath: skuPrice.userFinalPriceSourcePath,
          priceSemantics: skuPrice.priceSemantics,
          raw: sku
        } satisfies SkuSnapshotInput;
      }).filter((sku: SkuSnapshotInput) => sku.skuId)
    : [];

  return { products: [product], skus };
}

export function buildProductSnapshotKey(input: {
  runId: string;
  taskId: string;
  categoryName: string;
  spuId: string;
}): string {
  return `${input.runId}|${input.taskId}|${input.categoryName}|${input.spuId}`;
}

function extractDisplayPrice(raw: Record<string, any>, basePath: string) {
  const unifyPrice = raw.unify_price || {};
  const activityInfo = unifyPrice.activity_info || {};
  const actualPriceInfo = unifyPrice.actual_price_info || raw.actual_price_info;

  const frontDisplayPriceText = joinPriceSuffix(
    stringOrUndefined(activityInfo.activity_price_str) || stringOrUndefined(unifyPrice.price_str),
    stringOrUndefined(activityInfo.activity_price_suffix)
  );
  const frontDisplayPriceValue = numberOrUndefined(activityInfo.activity_price ?? unifyPrice.price);
  const userFinalPriceValue = actualPriceInfo
    ? positiveNumberOrUndefined(
      actualPriceInfo.actual_price
        ?? actualPriceInfo.price
        ?? actualPriceInfo.actual_price_str
        ?? actualPriceInfo.price_str
    )
    : undefined;
  const userFinalPriceText = userFinalPriceValue !== undefined
    ? stringOrUndefined(actualPriceInfo.actual_price_str)
      || stringOrUndefined(actualPriceInfo.price_str)
      || String(userFinalPriceValue)
    : undefined;
  const priceSourcePath = activityInfo.activity_price_str !== undefined
    ? `${basePath}.activity_info.activity_price_str`
    : `${basePath}.price_str`;
  const actualPriceBasePath = unifyPrice.actual_price_info
    ? `${basePath}.actual_price_info`
    : `${basePath.replace(/\.unify_price$/, "")}.actual_price_info`;
  const userFinalPriceSourcePath = userFinalPriceValue !== undefined
    ? actualPriceInfo.actual_price_str !== undefined
      ? `${actualPriceBasePath}.actual_price_str`
      : actualPriceInfo.price_str !== undefined
        ? `${actualPriceBasePath}.price_str`
        : actualPriceInfo.actual_price !== undefined
          ? `${actualPriceBasePath}.actual_price`
          : actualPriceInfo.price !== undefined
            ? `${actualPriceBasePath}.price`
            : undefined
    : undefined;

  return {
    frontDisplayPriceText,
    frontDisplayPriceValue,
    userFinalPriceText,
    userFinalPriceValue,
    priceSourcePath,
    userFinalPriceSourcePath,
    priceSemantics: userFinalPriceSourcePath ? "actual_payable" as const : "front_display_only" as const
  };
}

function joinPriceSuffix(price?: string, suffix?: string): string | undefined {
  if (!price) return undefined;
  return `${price}${suffix || ""}`;
}

function categoryOrder(i?: number, j?: number): number | undefined {
  if (i === undefined && j === undefined) return undefined;
  return (i || 0) * 1000 + (j || 0);
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const number = numberOrUndefined(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text ? text : undefined;
}
