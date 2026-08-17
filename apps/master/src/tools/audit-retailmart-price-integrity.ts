import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";
import { createDb } from "../db.js";

const defaultRunIds = [
  "8d188942-1fcc-4ba5-80d7-a81105a2f410",
  "5192ebb5-9c99-4746-a1d4-109d4120735b"
];

type RawObject = Record<string, unknown>;

interface AuditResult {
  table: string;
  expectedRows: number;
  targetRows: number;
  missingRows: number;
  unexpectedRows: number;
  mismatchedRows: number;
  mismatchSamples: string[];
}

function record(value: unknown): RawObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawObject : {};
}

function valueAt(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => record(current)[key], source);
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumeric(source: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const parsed = numeric(valueAt(source, path));
    if (parsed !== null) return parsed;
  }
  return null;
}

function rawPagePrice(raw: unknown): number | null {
  return firstNumeric(raw, [
    ["unify_price", "activity_info", "activity_price"],
    ["unify_price", "price"]
  ]);
}

function rawFinalPrice(raw: unknown): number | null {
  const source = record(raw);
  const unify = record(source.unify_price);
  const actual = Object.keys(record(unify.actual_price_info)).length
    ? record(unify.actual_price_info)
    : record(source.actual_price_info);
  const price = firstNumeric(actual, [
    ["actual_price"],
    ["price"],
    ["actual_price_str"],
    ["price_str"]
  ]);
  return price !== null && price > 0 ? price : null;
}

function shanghaiHour(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00:00`;
}

function sameAmount(left: unknown, right: number | null): boolean {
  const leftNumber = numeric(left);
  return leftNumber === null || right === null
    ? leftNumber === right
    : Math.abs(leftNumber - right) < 0.00001;
}

function sameText(left: unknown, right: unknown): boolean {
  return (left === null || left === undefined ? null : String(left))
    === (right === null || right === undefined ? null : String(right));
}

function auditRows(
  table: string,
  expectedRows: Array<{ key: string; values: Record<string, unknown> }>,
  targetRows: Array<Record<string, unknown>>,
  targetKey: (row: Record<string, unknown>) => string
): AuditResult {
  const targets = new Map(targetRows.map((row) => [targetKey(row), row]));
  const expectedKeys = new Set(expectedRows.map((row) => row.key));
  const mismatchSamples: string[] = [];
  let missingRows = 0;
  let mismatchedRows = 0;
  for (const expected of expectedRows) {
    const target = targets.get(expected.key);
    if (!target) {
      missingRows += 1;
      if (mismatchSamples.length < 10) mismatchSamples.push(`${expected.key}: target row missing`);
      continue;
    }
    const differences = Object.entries(expected.values)
      .filter(([field, value]) => field.endsWith("_amount")
        ? !sameAmount(target[field], value as number | null)
        : !sameText(target[field], value))
      .map(([field]) => field);
    if (differences.length) {
      mismatchedRows += 1;
      if (mismatchSamples.length < 10) mismatchSamples.push(`${expected.key}: ${differences.join(",")}`);
    }
  }
  return {
    table,
    expectedRows: expectedRows.length,
    targetRows: targetRows.length,
    missingRows,
    unexpectedRows: targetRows.filter((row) => !expectedKeys.has(targetKey(row))).length,
    mismatchedRows,
    mismatchSamples
  };
}

async function auditRun(
  runId: string,
  pg: ReturnType<typeof createDb>,
  target: mysql.Connection
): Promise<AuditResult[]> {
  const productResult = await pg.query(`
    WITH ranked AS (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.store_run_id, p.store_id, p.spu_id
        ORDER BY p.category_order ASC NULLS LAST, p.updated_at DESC, p.snapshot_id DESC
      ) AS primary_rank
      FROM product_snapshots p
      WHERE p.store_run_id = $1
    )
    SELECT store_id, category_name, spu_id, product_name, source_ts, raw
    FROM ranked WHERE primary_rank = 1
  `, [runId]);
  const skuResult = await pg.query(`
    WITH ranked_products AS (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.store_run_id, p.store_id, p.spu_id
        ORDER BY p.category_order ASC NULLS LAST, p.updated_at DESC, p.snapshot_id DESC
      ) AS primary_rank
      FROM product_snapshots p
      WHERE p.store_run_id = $1
    ), products AS (
      SELECT * FROM ranked_products WHERE primary_rank = 1
    ), skus AS (
      SELECT DISTINCT ON (s.store_run_id, s.store_id, s.spu_id, s.sku_id) s.*
      FROM sku_snapshots s
      WHERE s.store_run_id = $1
      ORDER BY s.store_run_id, s.store_id, s.spu_id, s.sku_id, s.updated_at DESC, s.snapshot_id DESC
    )
    SELECT p.store_id, p.category_name, p.spu_id, p.product_name,
      s.sku_id, s.source_ts, s.raw
    FROM products p JOIN skus s USING (store_run_id, store_id, spu_id)
  `, [runId]);
  const [spuTarget] = await target.query<mysql.RowDataPacket[]>(
    `SELECT batch_id, store_code, source_spu_id, category_name, product_name, snapshot_hour,
      front_display_price_amount, user_final_price_amount, original_price_amount
     FROM fact_store_spu_price_snapshot WHERE batch_id = ?`, [runId]
  );
  const [skuTarget] = await target.query<mysql.RowDataPacket[]>(
    `SELECT batch_id, store_code, source_spu_id, source_sku_id, category_name, product_name, snapshot_hour,
      front_display_price_amount, user_final_price_amount, original_price_amount
     FROM fact_store_sku_price_snapshot WHERE batch_id = ?`, [runId]
  );

  const expectedSpu = productResult.rows.map((row) => {
    const page = rawPagePrice(row.raw);
    const final = rawFinalPrice(row.raw);
    const original = firstNumeric(row.raw, [["unify_price", "underlined_price"]]);
    return {
      key: `${runId}|${row.store_id}|${row.spu_id}`,
      values: {
        category_name: row.category_name,
        product_name: row.product_name,
        snapshot_hour: shanghaiHour(row.source_ts),
        front_display_price_amount: page,
        user_final_price_amount: final,
        original_price_amount: original
      }
    };
  });
  const expectedSku = skuResult.rows.map((row) => {
    const page = rawPagePrice(row.raw);
    const final = rawFinalPrice(row.raw);
    const original = firstNumeric(row.raw, [["origin_price"]]);
    return {
      key: `${runId}|${row.store_id}|${row.spu_id}|${row.sku_id}`,
      values: {
        category_name: row.category_name,
        product_name: row.product_name,
        snapshot_hour: shanghaiHour(row.source_ts),
        front_display_price_amount: page,
        user_final_price_amount: final,
        original_price_amount: original
      }
    };
  });
  return [
    auditRows("fact_store_spu_price_snapshot", expectedSpu, spuTarget, (row) => `${row.batch_id}|${row.store_code}|${row.source_spu_id}`),
    auditRows("fact_store_sku_price_snapshot", expectedSku, skuTarget, (row) => `${row.batch_id}|${row.store_code}|${row.source_spu_id}|${row.source_sku_id}`)
  ];
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  const runIds = process.argv.slice(2).length ? process.argv.slice(2) : defaultRunIds;
  const pg = createDb(config.databaseUrl);
  const target = await mysql.createConnection({
    ...config.retailMart,
    dateStrings: true
  });
  let failed = false;
  try {
    for (const runId of runIds) {
      const results = await auditRun(runId, pg, target);
      for (const result of results) {
        process.stdout.write(`${runId} ${result.table}: source=${result.expectedRows}, target=${result.targetRows}, missing=${result.missingRows}, unexpected=${result.unexpectedRows}, mismatched=${result.mismatchedRows}\n`);
        for (const sample of result.mismatchSamples) process.stdout.write(`  ${sample}\n`);
        failed ||= result.missingRows > 0 || result.unexpectedRows > 0 || result.mismatchedRows > 0;
      }
    }
  } finally {
    await target.end();
    await pg.end();
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
