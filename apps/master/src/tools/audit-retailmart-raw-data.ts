import mysql from "mysql2/promise";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const runIds = process.argv.slice(2);
  if (!runIds.length) throw new Error("run_id_required");

  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");

  const connection = await mysql.createConnection(config.retailMart);
  try {
    const placeholders = runIds.map(() => "?").join(",");
    const [rawRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT
        store_snapshot_id,
        store_name,
        channel_code,
        source_store_id,
        COUNT(*) AS total_rows,
        SUM(record_type = 'product') AS product_rows,
        SUM(record_type = 'category') AS category_rows,
        COUNT(DISTINCT CASE WHEN record_type = 'product' THEN source_spu_id END) AS distinct_spu,
        COUNT(DISTINCT record_hash) AS distinct_hashes,
        SUM(OCTET_LENGTH(raw_data)) AS raw_json_bytes,
        SUM(
          CASE WHEN record_type = 'product' THEN COALESCE(
            JSON_LENGTH(JSON_EXTRACT(raw_data, '$.productRaw.skus')),
            JSON_LENGTH(JSON_EXTRACT(raw_data, '$.productRaw.raw.skus')),
            JSON_LENGTH(JSON_EXTRACT(raw_data, '$.product.skus')),
            JSON_LENGTH(JSON_EXTRACT(raw_data, '$.product.raw.skus')),
            0
          ) ELSE 0 END
        ) AS embedded_sku_entries,
        SUM(record_type = 'product' AND source_spu_id IS NULL) AS missing_spu_id,
        SUM(record_type = 'category' AND category_key IS NULL) AS missing_category_key,
        SUM(
          record_type = 'product'
          AND JSON_EXTRACT(raw_data, '$.productRaw') IS NULL
          AND JSON_EXTRACT(raw_data, '$.product') IS NULL
        ) AS missing_product_payload,
        SUM(
          record_type = 'category'
          AND JSON_EXTRACT(raw_data, '$.category') IS NULL
        ) AS missing_category_payload,
        DATE_FORMAT(MIN(collected_at), '%Y-%m-%d %H:%i:%s') AS first_collected_at,
        DATE_FORMAT(MAX(collected_at), '%Y-%m-%d %H:%i:%s') AS last_collected_at
      FROM fact_store_raw_data_snapshot
      WHERE store_snapshot_id IN (${placeholders})
      GROUP BY store_snapshot_id, store_name, channel_code, source_store_id
      ORDER BY store_name
    `, runIds);
    const factRows = [];
    for (const tableName of ["fact_store_spu_price_snapshot", "fact_store_sku_price_snapshot"]) {
      const [tableRows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT COUNT(*) AS table_count
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = ?
      `, [tableName]);
      const tableExists = Number(tableRows[0]?.table_count || 0) > 0;
      let rowsForRuns = 0;
      if (tableExists) {
        const [countRows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS row_count FROM \`${tableName}\` WHERE batch_id IN (${placeholders})`,
          runIds
        );
        rowsForRuns = Number(countRows[0]?.row_count || 0);
      }
      factRows.push({ tableName, tableExists, rowsForRuns });
    }

    process.stdout.write(`${JSON.stringify({ rawRows, factRows }, null, 2)}\n`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
