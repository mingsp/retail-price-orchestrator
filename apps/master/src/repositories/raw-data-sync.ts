import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { Client } from "minio";
import mysql from "mysql2/promise";
import type { Pool } from "pg";
import type { RetailMartDbConfig } from "./retailmart-sync.js";

const rawDataTable = "fact_store_raw_data_snapshot";

export interface RawStoreDataContext {
  storeSnapshotId: string;
  storeCode: string;
  storeName: string;
  sourceStoreId?: string;
  channelCode: string;
  fallbackCollectedAt: string;
}

export interface RawStoreDataRow {
  store_snapshot_id: string;
  channel_code: string;
  store_code: string;
  store_name: string;
  source_store_id: string | null;
  record_type: "product" | "category" | "other";
  source_spu_id: string | null;
  category_key: string | null;
  collected_at: string;
  raw_data: string;
  record_hash: string;
}

export interface RawStoreDataSyncResult {
  runId: string;
  artifactCount: number;
  scannedRows: number;
  sourceRows: number;
  insertedRows: number;
  duplicateRows: number;
  productRows: number;
  categoryRows: number;
  ignoredRows: number;
}

export function parseRawStoreDataLine(line: string, context: RawStoreDataContext): RawStoreDataRow {
  const sourceText = line.trim();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(sourceText) as Record<string, any>;
  } catch {
    throw new Error("raw_store_data_invalid_json");
  }
  const product = Object.keys(objectValue(payload.productRaw)).length
    ? objectValue(payload.productRaw)
    : objectValue(payload.product);
  const category = objectValue(payload.category);
  const recordType = Object.keys(product).length
    ? "product"
    : Object.keys(category).length
      ? "category"
      : "other";
  const nestedRawProduct = objectValue(product.raw);
  const sourceSpuId = firstText(product.spu_id, product.id, nestedRawProduct.spu_id, nestedRawProduct.id);
  const categoryKey = firstText(
    category.tag,
    category.name,
    Number.isFinite(Number(category.i)) && Number.isFinite(Number(category.j)) ? `${category.i}:${category.j}` : undefined
  );
  return {
    store_snapshot_id: context.storeSnapshotId,
    channel_code: context.channelCode,
    store_code: context.storeCode,
    store_name: context.storeName,
    source_store_id: context.sourceStoreId || null,
    record_type: recordType,
    source_spu_id: sourceSpuId,
    category_key: categoryKey,
    collected_at: toShanghaiTimestamp(payload.ts || context.fallbackCollectedAt),
    raw_data: JSON.stringify(payload),
    record_hash: createHash("sha256").update(sourceText).digest("hex")
  };
}

export function isRawStoreDataArtifact(input: {
  kind: string;
  objectKey: string;
  metadata?: Record<string, unknown>;
}): boolean {
  return (input.kind === "raw_jsonl" && input.objectKey.endsWith(".products.raw.jsonl"))
    || input.metadata?.artifactPart === "categories"
    || input.objectKey.endsWith(".categories.jsonl");
}

export function requiredRawArtifactReadOptions(versionId: string | null | undefined, artifactId: string) {
  if (!versionId) throw new Error(`raw_store_data_artifact_version_missing:${artifactId}`);
  return { versionId };
}

export async function syncRetailMartRawData(
  db: Pool,
  config: RetailMartDbConfig,
  s3: Client,
  runId: string,
  options: { force?: boolean } = {}
): Promise<RawStoreDataSyncResult> {
  const runResult = await db.query(`
    SELECT r.run_id, r.store_id, s.name AS store_name, s.poi_id_str, s.platform
    FROM store_runs r JOIN stores s ON s.store_id = r.store_id
    WHERE r.run_id = $1
  `, [runId]);
  const run = runResult.rows[0];
  if (!run) throw new Error("raw_store_data_sync_run_not_found");
  const artifactResult = await db.query(`
    SELECT artifact_id, kind, bucket, object_key, storage_version_id, metadata, created_at
    FROM artifacts
    WHERE run_id = $1
      AND (
        (kind = 'raw_jsonl' AND object_key LIKE '%.products.raw.jsonl')
        OR metadata->>'artifactPart' = 'categories'
        OR object_key LIKE '%.categories.jsonl'
      )
      AND ($2::boolean OR NOT (metadata ? 'rawDataSnapshotSyncedAt'))
    ORDER BY created_at, artifact_id
  `, [runId, Boolean(options.force)]);

  const connection = await mysql.createConnection(config);
  const result: RawStoreDataSyncResult = {
    runId,
    artifactCount: artifactResult.rows.length,
    scannedRows: 0,
    sourceRows: 0,
    insertedRows: 0,
    duplicateRows: 0,
    productRows: 0,
    categoryRows: 0,
    ignoredRows: 0
  };
  try {
    await ensureRawStoreDataTable(connection);
    for (const artifact of artifactResult.rows) {
      const context: RawStoreDataContext = {
        storeSnapshotId: runId,
        storeCode: run.store_id,
        storeName: run.store_name,
        sourceStoreId: run.poi_id_str || undefined,
        channelCode: run.platform || "meituan_h5",
        fallbackCollectedAt: artifact.created_at.toISOString()
      };
      const stream = await s3.getObject(
        artifact.bucket,
        artifact.object_key,
        requiredRawArtifactReadOptions(artifact.storage_version_id, artifact.artifact_id)
      );
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let chunk: RawStoreDataRow[] = [];
      for await (const line of lines) {
        if (!line.trim()) continue;
        const row = parseRawStoreDataLine(line, context);
        result.scannedRows += 1;
        if (row.record_type === "other") {
          result.ignoredRows += 1;
          continue;
        }
        result.sourceRows += 1;
        if (row.record_type === "product") result.productRows += 1;
        else result.categoryRows += 1;
        chunk.push(row);
        if (chunk.length >= 50) {
          result.insertedRows += await insertRawRows(connection, chunk);
          chunk = [];
        }
      }
      if (chunk.length) result.insertedRows += await insertRawRows(connection, chunk);
      await db.query(`
        UPDATE artifacts
        SET metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object('rawDataSnapshotSyncedAt', now()::text)
        WHERE artifact_id = $1
      `, [artifact.artifact_id]);
    }
    result.duplicateRows = result.sourceRows - result.insertedRows;
    return result;
  } finally {
    await connection.end();
  }
}

export async function ensureRawStoreDataTable(connection: mysql.Connection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${rawDataTable} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键',
      store_snapshot_id CHAR(36) NOT NULL COMMENT '一次完整门店采集的数据版本',
      channel_code VARCHAR(32) NOT NULL COMMENT '来源渠道',
      store_code VARCHAR(128) NOT NULL COMMENT '门店稳定编码',
      store_name VARCHAR(255) NOT NULL COMMENT '门店名称',
      source_store_id VARCHAR(128) DEFAULT NULL COMMENT '平台来源门店 ID',
      record_type VARCHAR(32) NOT NULL COMMENT 'product、category 或 other',
      source_spu_id VARCHAR(128) DEFAULT NULL COMMENT '来源 SPU ID，仅用于检索',
      category_key VARCHAR(255) DEFAULT NULL COMMENT '来源类目标识，仅用于检索',
      collected_at DATETIME(3) NOT NULL COMMENT '原始记录采集时间',
      raw_data JSON NOT NULL COMMENT '完整原始 JSON 记录，不裁剪业务字段',
      record_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '原始记录 SHA-256',
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入库时间',
      PRIMARY KEY (id),
      UNIQUE KEY uk_store_raw_record (store_snapshot_id, store_code, record_hash),
      KEY idx_store_raw_spu (store_code, store_snapshot_id, record_type, source_spu_id),
      KEY idx_store_raw_category (store_code, store_snapshot_id, record_type, category_key),
      KEY idx_store_raw_collected (store_code, collected_at),
      CONSTRAINT chk_store_raw_record_type CHECK (record_type IN ('product', 'category'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      COMMENT='门店完整原始数据快照，业务字段由下游按需提取'
  `);
}

export async function insertRawRows(connection: mysql.Connection, rows: RawStoreDataRow[]): Promise<number> {
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]) as Array<keyof RawStoreDataRow>;
  const placeholders = rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  const values = rows.flatMap((row) => columns.map((column) => row[column]));
  const [result] = await connection.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO ${rawDataTable} (${columns.map((column) => `\`${String(column)}\``).join(",")}) VALUES ${placeholders}`,
    values
  );
  return result.affectedRows;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return null;
}

function toShanghaiTimestamp(value: unknown): string {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("raw_store_data_invalid_timestamp");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}
