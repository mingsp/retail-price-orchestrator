import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";

const legacyTable = "fact_store_sku_price_snapshot_legacy_20260713";
const currentTable = "fact_store_sku_price_snapshot";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  const connection = await mysql.createConnection({
    ...config.retailMart,
    multipleStatements: true
  });
  try {
    const currentColumns = await tableColumns(connection, currentTable);
    const legacyColumns = await tableColumns(connection, legacyTable);
    const currentIsLegacy = currentColumns.includes("business_key_hash");
    const currentIsFinal = currentColumns.includes("source_sku_id") && currentColumns.includes("snapshot_hour");

    if (currentIsLegacy && legacyColumns.length) {
      throw new Error(`migration_blocked:${legacyTable}_already_exists_while_current_is_legacy`);
    }
    if (currentIsLegacy) {
      const [countRows] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM ${currentTable}`);
      await connection.query(`RENAME TABLE ${currentTable} TO ${legacyTable}`);
      process.stdout.write(`旧表已完整备份为 ${legacyTable}，行数 ${Number(countRows[0]?.count || 0)}。\n`);
    } else if (currentColumns.length && !currentIsFinal) {
      throw new Error("migration_blocked:unknown_current_sku_table_schema");
    }

    const migrationPath = resolve(process.cwd(), "../../infra/mysql/20260713_two_level_price_snapshots.sql");
    const sql = await readFile(migrationPath, "utf8");
    await connection.query(sql);

    const spuColumns = await tableColumns(connection, "fact_store_spu_price_snapshot");
    const skuColumns = await tableColumns(connection, currentTable);
    for (const required of ["id", "batch_id", "snapshot_hour", "source_spu_id", "product_name"]) {
      if (!spuColumns.includes(required)) throw new Error(`migration_verify_failed:spu_missing_${required}`);
    }
    for (const required of ["id", "batch_id", "snapshot_hour", "source_spu_id", "source_sku_id", "product_name"]) {
      if (!skuColumns.includes(required)) throw new Error(`migration_verify_failed:sku_missing_${required}`);
    }
    process.stdout.write("两级价格快照表结构校验通过。\n");
  } finally {
    await connection.end();
  }
}

async function tableColumns(connection: mysql.Connection, table: string): Promise<string[]> {
  const [rows] = await connection.query<any[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((row) => String(row.COLUMN_NAME));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
