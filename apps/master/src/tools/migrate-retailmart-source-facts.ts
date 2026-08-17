import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";
import {
  classifyFactSchema,
  sourceFactSkuRemovedColumns,
  sourceFactSpuRemovedColumns
} from "../repositories/retailmart-schema.js";

const tables = [
  {
    label: "SPU",
    current: "fact_store_spu_price_snapshot",
    stage: "fact_store_spu_price_snapshot_source_fact_20260714",
    backup: "fact_store_spu_price_snapshot_pre_source_fact_20260714",
    removed: sourceFactSpuRemovedColumns,
    required: ["id", "batch_id", "snapshot_hour", "store_code", "source_spu_id", "product_name", "front_display_price_amount"]
  },
  {
    label: "SKU",
    current: "fact_store_sku_price_snapshot",
    stage: "fact_store_sku_price_snapshot_source_fact_20260714",
    backup: "fact_store_sku_price_snapshot_pre_source_fact_20260714",
    removed: sourceFactSkuRemovedColumns,
    required: ["id", "batch_id", "snapshot_hour", "store_code", "source_spu_id", "source_sku_id", "product_name", "front_display_price_amount"]
  }
] as const;

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  const connection = await mysql.createConnection(config.retailMart);
  try {
    const states = [] as Array<"legacy" | "compact" | "mixed">;
    for (const table of tables) {
      const columns = await tableColumns(connection, table.current);
      if (!columns.length) throw new Error(`migration_blocked:${table.current}_missing`);
      for (const required of table.required) {
        if (!columns.includes(required)) throw new Error(`migration_blocked:${table.current}_missing_${required}`);
      }
      const state = classifyFactSchema(columns, table.removed);
      if (state === "mixed") throw new Error(`migration_blocked:${table.current}_mixed_schema`);
      states.push(state);
    }
    if (states.every((state) => state === "compact")) {
      process.stdout.write("两张表已经是来源事实结构，无需重复迁移。\n");
      return;
    }
    if (!states.every((state) => state === "legacy")) {
      throw new Error("migration_blocked:spu_sku_schema_versions_differ");
    }
    for (const table of tables) {
      if ((await tableColumns(connection, table.backup)).length) {
        throw new Error(`migration_blocked:${table.backup}_already_exists`);
      }
    }

    const expectedCounts = new Map<string, number>();
    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table.stage)}`);
      await connection.query(`CREATE TABLE ${quoteIdentifier(table.stage)} LIKE ${quoteIdentifier(table.current)}`);
      await connection.query(
        `ALTER TABLE ${quoteIdentifier(table.stage)} ${table.removed.map((column) => `DROP COLUMN ${quoteIdentifier(column)}`).join(", ")}`
      );
      const retainedColumns = (await tableColumns(connection, table.current))
        .filter((column) => !table.removed.includes(column as never));
      const columnSql = retainedColumns.map(quoteIdentifier).join(", ");
      await connection.query(
        `INSERT INTO ${quoteIdentifier(table.stage)} (${columnSql}) SELECT ${columnSql} FROM ${quoteIdentifier(table.current)} ORDER BY id`
      );
      const sourceCount = await tableCount(connection, table.current);
      const stageCount = await tableCount(connection, table.stage);
      expectedCounts.set(table.current, sourceCount);
      if (sourceCount !== stageCount) throw new Error(`migration_verify_failed:${table.label}_row_count`);
      const mismatches = await copiedRowMismatchCount(connection, table.current, table.stage, retainedColumns);
      if (mismatches !== 0) throw new Error(`migration_verify_failed:${table.label}_retained_fields_${mismatches}`);
    }

    for (const table of tables) {
      if (await tableCount(connection, table.current) !== expectedCounts.get(table.current)) {
        throw new Error(`migration_blocked:${table.label}_source_changed_during_copy`);
      }
    }
    await connection.query(`RENAME TABLE ${tables.flatMap((table) => [
      `${quoteIdentifier(table.current)} TO ${quoteIdentifier(table.backup)}`,
      `${quoteIdentifier(table.stage)} TO ${quoteIdentifier(table.current)}`
    ]).join(", ")}`);

    for (const table of tables) {
      const expected = expectedCounts.get(table.current);
      const currentCount = await tableCount(connection, table.current);
      const backupCount = await tableCount(connection, table.backup);
      if (currentCount !== expected || backupCount !== expected) {
        throw new Error(`migration_verify_failed:${table.label}_post_rename_count`);
      }
      process.stdout.write(`${table.label}: 来源事实表 ${currentCount} 行，临时迁移备份 ${backupCount} 行。\n`);
    }
  } finally {
    await connection.end();
  }
}

async function tableColumns(connection: mysql.Connection, table: string): Promise<string[]> {
  const [rows] = await connection.query<any[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    [table]
  );
  return rows.map((row) => String(row.COLUMN_NAME));
}

async function tableCount(connection: mysql.Connection, table: string): Promise<number> {
  const [rows] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
  return Number(rows[0]?.count || 0);
}

async function copiedRowMismatchCount(
  connection: mysql.Connection,
  source: string,
  target: string,
  columns: string[]
): Promise<number> {
  const comparisons = columns
    .filter((column) => column !== "id")
    .map((column) => `NOT (target.${quoteIdentifier(column)} <=> source.${quoteIdentifier(column)})`)
    .join(" OR ");
  const [rows] = await connection.query<any[]>(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(source)} source LEFT JOIN ${quoteIdentifier(target)} target ON target.id=source.id WHERE target.id IS NULL OR ${comparisons}`
  );
  return Number(rows[0]?.count || 0);
}

function quoteIdentifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
