import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) throw new Error("run_id_required");

  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");

  const connection = await mysql.createConnection(config.retailMart);
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT record_type, raw_data
      FROM fact_store_raw_data_snapshot
      WHERE store_snapshot_id = ?
        AND record_type IN ('product', 'category')
      ORDER BY record_type, id
    `, [runId]);
    const firstByType = new Map<string, unknown>();
    for (const row of rows) {
      if (!firstByType.has(row.record_type)) {
        firstByType.set(row.record_type, parseJson(row.raw_data));
      }
      if (firstByType.size === 2) break;
    }
    const result = Object.fromEntries(
      [...firstByType.entries()].map(([type, value]) => [type, describe(value, 0)])
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function describe(value: unknown, depth: number): unknown {
  if (depth >= 5) return typeName(value);
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      item: value.length ? describe(value[0], depth + 1) : null
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, nested]) => [key, describe(nested, depth + 1)])
    );
  }
  if (typeof value === "string") return value.length > 100 ? `${value.slice(0, 100)}...` : value;
  return value;
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  return typeof value;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
