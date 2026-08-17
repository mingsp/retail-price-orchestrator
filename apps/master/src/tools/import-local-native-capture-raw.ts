import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";
import { buildCategoryUnionCoverage } from "../../../../scripts/lib/category-union-evidence.mjs";
import {
  ensureRawStoreDataTable,
  insertRawRows,
  parseRawStoreDataLine,
  type RawStoreDataContext,
  type RawStoreDataRow
} from "../repositories/raw-data-sync.js";

interface Options {
  captureRoot: string;
  capturePrefix: string;
  slotCount: number;
  apply: boolean;
  allowPartial: boolean;
}

interface SourceFile {
  kind: "product" | "category";
  path: string;
  fallbackCollectedAt: string;
}

const options = parseOptions(process.argv.slice(2));
const config = loadConfig();
if (!config.retailMart) throw new Error("retailmart_not_configured");

const sourceFiles: SourceFile[] = [];
const storeIds = new Set<string>();
const storeNames = new Set<string>();
const completedCategories = new Set<string>();
const plannedCategories = new Set<string>();
let productRows = 0;
let categoryRows = 0;
let firstCollectedAt = "";
const categoryEvidenceEvents: any[] = [];
const productEvidenceRows: any[] = [];

for (let slot = 1; slot <= options.slotCount; slot += 1) {
  const suffix = String(slot).padStart(2, "0");
  const captureId = `${options.capturePrefix}-slot${suffix}`;
  const slotDir = path.join(options.captureRoot, `slot${suffix}`);
  const summaryPath = path.join(slotDir, `${captureId}.summary.json`);
  const planPath = path.join(slotDir, `${captureId}.plan.json`);
  const rawPath = path.join(slotDir, `${captureId}.products.raw.jsonl`);
  const categoriesPath = path.join(slotDir, `${captureId}.categories.jsonl`);
  const checkpointPath = path.join(slotDir, `${captureId}.checkpoint.json`);
  for (const requiredPath of [planPath, rawPath, categoriesPath, checkpointPath]) {
    if (!fs.existsSync(requiredPath)) throw new Error(`capture_artifact_missing:${slot}:${requiredPath}`);
  }
  const summary = fs.existsSync(summaryPath) ? readJson(summaryPath) : null;
  if (!options.allowPartial) {
    if (summary?.status !== "completed") throw new Error(`slot_not_completed:${slot}:${summary?.status || "missing"}`);
    assertHash(summary, "raw", rawPath);
    assertHash(summary, "categories", categoriesPath);
    assertHash(summary, "checkpoint", checkpointPath);
  }

  for (const category of readJson(planPath).plan || []) plannedCategories.add(categoryKey(category));
  for (const line of readLines(categoriesPath)) {
    const payload = JSON.parse(line);
    categoryEvidenceEvents.push(payload);
    if (payload.event === "category_done" && payload.final?.completed === true) {
      completedCategories.add(categoryKey(payload.category));
    }
  }

  for (const line of readLines(rawPath)) {
    const payload = JSON.parse(line);
    productEvidenceRows.push(payload);
    if (payload.store?.storeId) storeIds.add(String(payload.store.storeId));
    if (payload.store?.storeName) storeNames.add(String(payload.store.storeName));
    const ts = String(payload.ts || "");
    if (ts && (!firstCollectedAt || ts < firstCollectedAt)) firstCollectedAt = ts;
    productRows += 1;
  }
  categoryRows += readLines(categoriesPath).length;
  const fallbackCollectedAt = summary?.finishedAt || fs.statSync(rawPath).mtime.toISOString();
  sourceFiles.push(
    { kind: "product", path: rawPath, fallbackCollectedAt },
    { kind: "category", path: categoriesPath, fallbackCollectedAt }
  );
}

if (storeIds.size !== 1 || storeNames.size !== 1) {
  throw new Error(`store_identity_mismatch:${[...storeIds].join(",")}:${[...storeNames].join(",")}`);
}
const missingCategories = [...plannedCategories].filter((key) => !completedCategories.has(key));
const categoryUnionCoverage = buildCategoryUnionCoverage(categoryEvidenceEvents, productEvidenceRows);
const evidencedCoverage = categoryUnionCoverage.filter((row) => row.observedSpuIds.length > 0);
const incompleteCategoryUnions = evidencedCoverage.filter((row) => !row.completed);
if (!options.allowPartial && (missingCategories.length || completedCategories.size !== plannedCategories.size)) {
  throw new Error(`category_completion_mismatch:${completedCategories.size}/${plannedCategories.size}:${missingCategories.join(",")}`);
}
if (!options.allowPartial && incompleteCategoryUnions.length) {
  throw new Error(`category_union_incomplete:${incompleteCategoryUnions
    .map((row) => `${row.key}:${row.capturedSpuIds.length}/${row.observedSpuIds.length}`)
    .join(",")}`);
}

const storeId = [...storeIds][0];
const storeName = [...storeNames][0];
const storeSnapshotId = stableUuid(`${storeId}|${options.capturePrefix}|${firstCollectedAt}`);
const contextBase = {
  storeSnapshotId,
  storeCode: storeId,
  storeName,
  sourceStoreId: storeId,
  channelCode: "meituan_h5"
};

const expected = {
  storeSnapshotId,
  storeId,
  storeName,
  productRows,
  categoryRows,
  totalRows: productRows + categoryRows,
  completedCategories: completedCategories.size,
  plannedCategories: plannedCategories.size,
  evidencedCategories: evidencedCoverage.length,
  categoryProductRelations: evidencedCoverage.reduce((total, row) => total + row.observedSpuIds.length, 0),
  missingCategoryProductRelations: incompleteCategoryUnions.reduce((total, row) => total + row.missingSpuIds.length, 0),
  snapshotStatus: missingCategories.length || incompleteCategoryUnions.length ? "partial" : "complete"
};

if (!options.apply) {
  process.stdout.write(`${JSON.stringify({ mode: "dry-run", expected }, null, 2)}\n`);
  process.exit(0);
}

const connection = await mysql.createConnection(config.retailMart);
try {
  await ensureRawStoreDataTable(connection);
  await connection.beginTransaction();
  let insertedRows = 0;
  try {
    for (const source of sourceFiles) {
      const context: RawStoreDataContext = { ...contextBase, fallbackCollectedAt: source.fallbackCollectedAt };
      let chunk: RawStoreDataRow[] = [];
      for (const line of readLines(source.path)) {
        const row = parseRawStoreDataLine(line, context);
        if (row.record_type === "other") continue;
        chunk.push(row);
        if (chunk.length >= 50) {
          insertedRows += await insertRawRows(connection, chunk);
          chunk = [];
        }
      }
      if (chunk.length) insertedRows += await insertRawRows(connection, chunk);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }

  const [rows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT
      COUNT(*) AS total_rows,
      SUM(record_type = 'product') AS product_rows,
      SUM(record_type = 'category') AS category_rows,
      COUNT(DISTINCT CASE WHEN record_type = 'product' THEN source_spu_id END) AS distinct_spu,
      COUNT(DISTINCT record_hash) AS distinct_hashes,
      SUM(
        CASE WHEN record_type = 'product' THEN COALESCE(
          JSON_LENGTH(JSON_EXTRACT(raw_data, '$.productRaw.skus')),
          JSON_LENGTH(JSON_EXTRACT(raw_data, '$.product.skus')),
          0
        ) ELSE 0 END
      ) AS embedded_sku_entries,
      SUM(record_type = 'product' AND source_spu_id IS NULL) AS missing_spu_id,
      SUM(record_type = 'category' AND category_key IS NULL) AS missing_category_key,
      DATE_FORMAT(MIN(collected_at), '%Y-%m-%d %H:%i:%s') AS first_collected_at,
      DATE_FORMAT(MAX(collected_at), '%Y-%m-%d %H:%i:%s') AS last_collected_at
    FROM fact_store_raw_data_snapshot
    WHERE store_snapshot_id = ?
  `, [storeSnapshotId]);
  const audit = rows[0];
  if (Number(audit.total_rows) !== expected.totalRows) {
    throw new Error(`database_row_count_mismatch:${audit.total_rows}/${expected.totalRows}`);
  }
  if (Number(audit.distinct_hashes) !== expected.totalRows) {
    throw new Error(`database_hash_count_mismatch:${audit.distinct_hashes}/${expected.totalRows}`);
  }
  if (Number(audit.missing_spu_id) !== 0 || Number(audit.missing_category_key) !== 0) {
    throw new Error(`database_index_field_missing:${audit.missing_spu_id}:${audit.missing_category_key}`);
  }
  process.stdout.write(`${JSON.stringify({ mode: "apply", insertedRows, expected, audit }, null, 2)}\n`);
} finally {
  await connection.end();
}

function parseOptions(args: string[]): Options {
  const get = (name: string) => args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const captureRoot = get("--capture-root");
  const capturePrefix = get("--capture-prefix");
  const slotCount = Number(get("--slot-count"));
  if (!captureRoot || !capturePrefix || !Number.isInteger(slotCount) || slotCount < 1) {
    throw new Error("usage: import-local-native-capture-raw --capture-root=<path> --capture-prefix=<prefix> --slot-count=<n> [--allow-partial] [--apply]");
  }
  return {
    captureRoot: path.resolve(captureRoot),
    capturePrefix,
    slotCount,
    apply: args.includes("--apply"),
    allowPartial: args.includes("--allow-partial")
  };
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
}

function assertHash(summary: any, kind: string, filePath: string): void {
  const expected = String(summary.artifactChecksums?.[kind] || "");
  const actual = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (!expected || expected !== actual) throw new Error(`artifact_hash_mismatch:${kind}:${filePath}`);
}

function categoryKey(category: any): string {
  const tag = String(category?.tag ?? "").trim();
  if (tag) return `tag:${tag}`;
  return `position:${category?.i ?? ""}|${category?.j ?? ""}`;
}

function stableUuid(input: string): string {
  const bytes = createHash("sha256").update(input).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
