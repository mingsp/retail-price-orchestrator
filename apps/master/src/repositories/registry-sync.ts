import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type RegistryEntityType = "store" | "account" | "worker" | "collection_plan";

export interface RegistrySyncRecordInput {
  sourceTableId: string;
  sourceRecordId: string;
  sourceVersion: number;
  entityType: RegistryEntityType;
  entityId: string;
  contentHash: string;
  payload: Record<string, unknown>;
}

export interface RegistrySyncBatchInput {
  provider: "dingtalk_aitable";
  sourceBaseId: string;
  schemaHash: string;
  readComplete: boolean;
  records: RegistrySyncRecordInput[];
}

export interface RegistryValidationIssue {
  code: string;
  message: string;
  sourceTableId?: string;
  sourceRecordId?: string;
}

export interface RegistryValidationResult {
  valid: boolean;
  issues: RegistryValidationIssue[];
}

export interface RegistryPublishResult {
  batchId: string;
  status: "published";
  recordCount: number;
  idempotentReplay: boolean;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PHONE_PATTERN = /(?<!\d)1\d{10}(?!\d)/;
const RESTRICTED_KEYS = new Set([
  "cells",
  "phone",
  "fullphone",
  "full_phone",
  "完整手机号",
  "rawrecord",
  "raw_record"
]);

export function validateRegistryBatch(input: RegistrySyncBatchInput, expectedSchemaHash: string): RegistryValidationResult {
  const issues: RegistryValidationIssue[] = [];
  if (!input.readComplete) issues.push(issue("incomplete_source_read", "来源表未完成全量读取"));
  if (!SHA256_PATTERN.test(input.schemaHash) || input.schemaHash !== expectedSchemaHash) {
    issues.push(issue("schema_hash_mismatch", "钉钉台账结构与 Master 预期不一致"));
  }
  if (input.provider !== "dingtalk_aitable") issues.push(issue("unsupported_provider", "不支持的数据来源"));
  if (!requiredText(input.sourceBaseId)) issues.push(issue("source_base_missing", "缺少来源 Base 标识"));
  if (!Array.isArray(input.records)) issues.push(issue("records_missing", "缺少同步记录"));

  const seen = new Set<string>();
  for (const record of input.records || []) {
    const sourceKey = `${record.sourceTableId}\u0000${record.sourceRecordId}`;
    if (seen.has(sourceKey)) {
      issues.push(issue("duplicate_source_record", "同一来源记录在批次中重复", record));
      continue;
    }
    seen.add(sourceKey);
    if (!requiredText(record.sourceTableId) || !requiredText(record.sourceRecordId)) {
      issues.push(issue("source_identity_missing", "来源记录标识不完整", record));
    }
    if (!Number.isSafeInteger(record.sourceVersion) || record.sourceVersion < 1) {
      issues.push(issue("invalid_source_version", "同步版本必须是正整数", record));
    }
    if (!requiredText(record.entityId) || !["store", "account", "worker", "collection_plan"].includes(record.entityType)) {
      issues.push(issue("invalid_entity_identity", "Master 实体标识或类型无效", record));
    }
    if (!SHA256_PATTERN.test(record.contentHash)) {
      issues.push(issue("invalid_content_hash", "记录内容哈希无效", record));
    }
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
      issues.push(issue("invalid_payload", "内部记录载荷无效", record));
    } else if (containsRestrictedRegistryValue(record.payload)) {
      issues.push(issue("restricted_payload", "内部记录包含受限原始字段或完整手机号", record));
    }
  }
  return { valid: issues.length === 0, issues };
}

export function containsRestrictedRegistryValue(value: unknown, key = ""): boolean {
  if (RESTRICTED_KEYS.has(key.toLowerCase())) return true;
  if (typeof value === "string") return PHONE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((item) => containsRestrictedRegistryValue(item));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>)
    .some(([childKey, childValue]) => containsRestrictedRegistryValue(childValue, childKey));
}

export function computeRegistryBatchIdempotencyKey(input: RegistrySyncBatchInput): string {
  const canonical = {
    provider: input.provider,
    sourceBaseId: input.sourceBaseId,
    schemaHash: input.schemaHash,
    records: [...input.records]
      .sort((left, right) => `${left.sourceTableId}\u0000${left.sourceRecordId}`.localeCompare(`${right.sourceTableId}\u0000${right.sourceRecordId}`))
      .map((record) => ({
        sourceTableId: record.sourceTableId,
        sourceRecordId: record.sourceRecordId,
        sourceVersion: record.sourceVersion,
        entityType: record.entityType,
        entityId: record.entityId,
        contentHash: record.contentHash
      }))
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export async function preflightRegistryBatch(
  db: Pool,
  input: RegistrySyncBatchInput,
  expectedSchemaHash: string
): Promise<RegistryValidationResult> {
  const validation = validateRegistryBatch(input, expectedSchemaHash);
  if (!validation.valid || input.records.length === 0) return validation;
  const conflicts = await findVersionConflicts(db, input.records);
  return {
    valid: conflicts.length === 0,
    issues: [...validation.issues, ...conflicts]
  };
}

export async function publishRegistryBatch(
  db: Pool,
  input: RegistrySyncBatchInput,
  expectedSchemaHash: string
): Promise<RegistryPublishResult> {
  const validation = await preflightRegistryBatch(db, input, expectedSchemaHash);
  if (!validation.valid) throw new RegistryBatchRejectedError(validation.issues);
  const idempotencyKey = computeRegistryBatchIdempotencyKey(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`
      SELECT batch_id, record_count, status
      FROM registry_sync_batches
      WHERE idempotency_key = $1
      FOR UPDATE
    `, [idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].status !== "published") throw new Error("registry_batch_not_replayable");
      await client.query("COMMIT");
      return {
        batchId: existing.rows[0].batch_id,
        status: "published",
        recordCount: Number(existing.rows[0].record_count),
        idempotentReplay: true
      };
    }

    await assertNoVersionConflicts(client, input.records);
    const batchId = randomUUID();
    await client.query(`
      INSERT INTO registry_sync_batches (
        batch_id, provider, source_base_id, schema_hash, idempotency_key,
        record_count, status, started_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'publishing',now())
    `, [batchId, input.provider, input.sourceBaseId, input.schemaHash, idempotencyKey, input.records.length]);

    for (const record of input.records) {
      await applyRegistryEntity(client, record);
      await client.query(`
        INSERT INTO registry_sync_records (
          provider, source_table_id, source_record_id, source_version, content_hash,
          entity_type, entity_id, last_batch_id, status, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',now())
        ON CONFLICT (provider, source_table_id, source_record_id) DO UPDATE SET
          source_version = EXCLUDED.source_version,
          content_hash = EXCLUDED.content_hash,
          entity_type = EXCLUDED.entity_type,
          entity_id = EXCLUDED.entity_id,
          last_batch_id = EXCLUDED.last_batch_id,
          status = 'published',
          updated_at = now()
      `, [input.provider, record.sourceTableId, record.sourceRecordId, record.sourceVersion, record.contentHash,
        record.entityType, record.entityId, batchId]);
    }
    await client.query(`
      UPDATE registry_sync_batches
      SET status = 'published', completed_at = now()
      WHERE batch_id = $1
    `, [batchId]);
    await client.query("COMMIT");
    return { batchId, status: "published", recordCount: input.records.length, idempotentReplay: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getRegistrySyncStatus(db: Pool): Promise<Record<string, unknown>> {
  const [latest, counts, issues] = await Promise.all([
    db.query(`SELECT batch_id, status, record_count, started_at, completed_at FROM registry_sync_batches ORDER BY started_at DESC LIMIT 1`),
    db.query(`SELECT entity_type, count(*)::int AS count FROM registry_sync_records WHERE status = 'published' GROUP BY entity_type ORDER BY entity_type`),
    db.query(`SELECT count(*)::int AS count FROM registry_sync_issues WHERE status = 'open'`)
  ]);
  return {
    latestBatch: latest.rows[0] || null,
    publishedEntities: counts.rows,
    openIssueCount: Number(issues.rows[0]?.count || 0)
  };
}

export class RegistryBatchRejectedError extends Error {
  constructor(public readonly issues: RegistryValidationIssue[]) {
    super("registry_batch_rejected");
  }
}

async function findVersionConflicts(db: Pick<Pool, "query">, records: RegistrySyncRecordInput[]): Promise<RegistryValidationIssue[]> {
  const issues: RegistryValidationIssue[] = [];
  for (const record of records) {
    const current = await db.query(`
      SELECT source_version, content_hash
      FROM registry_sync_records
      WHERE provider = 'dingtalk_aitable' AND source_table_id = $1 AND source_record_id = $2
    `, [record.sourceTableId, record.sourceRecordId]);
    const row = current.rows[0];
    if (!row) continue;
    if (Number(row.source_version) > record.sourceVersion) {
      issues.push(issue("stale_source_version", "来源记录版本早于 Master 已发布版本", record));
    } else if (Number(row.source_version) === record.sourceVersion && row.content_hash !== record.contentHash) {
      issues.push(issue("version_content_conflict", "相同同步版本的记录内容发生变化", record));
    }
  }
  return issues;
}

async function assertNoVersionConflicts(client: PoolClient, records: RegistrySyncRecordInput[]): Promise<void> {
  const issues: RegistryValidationIssue[] = [];
  for (const record of records) {
    const current = await client.query(`
      SELECT source_version, content_hash
      FROM registry_sync_records
      WHERE provider = 'dingtalk_aitable' AND source_table_id = $1 AND source_record_id = $2
      FOR UPDATE
    `, [record.sourceTableId, record.sourceRecordId]);
    const row = current.rows[0];
    if (!row) continue;
    if (Number(row.source_version) > record.sourceVersion) {
      issues.push(issue("stale_source_version", "来源记录版本早于 Master 已发布版本", record));
    } else if (Number(row.source_version) === record.sourceVersion && row.content_hash !== record.contentHash) {
      issues.push(issue("version_content_conflict", "相同同步版本的记录内容发生变化", record));
    }
  }
  if (issues.length) throw new RegistryBatchRejectedError(issues);
}

async function applyRegistryEntity(client: PoolClient, record: RegistrySyncRecordInput): Promise<void> {
  if (record.entityType === "store") return applyStore(client, record);
  if (record.entityType === "account") return applyAccount(client, record);
  if (record.entityType === "collection_plan") return applyCollectionPlan(client, record);
  if (record.entityType === "worker") return applyWorkerRegistry(client, record);
}

async function applyStore(client: PoolClient, record: RegistrySyncRecordInput): Promise<void> {
  const payload = record.payload;
  const name = payloadText(payload, "name");
  const url = payloadText(payload, "canonicalUrl");
  const poiIdStr = payloadText(payload, "poiIdStr");
  await client.query(`
    INSERT INTO stores (store_id, name, platform, poi_id_str, url, city, address, status, collection_policy, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
    ON CONFLICT (store_id) DO UPDATE SET
      name = EXCLUDED.name,
      platform = EXCLUDED.platform,
      poi_id_str = EXCLUDED.poi_id_str,
      url = EXCLUDED.url,
      city = EXCLUDED.city,
      address = EXCLUDED.address,
      status = EXCLUDED.status,
      collection_policy = EXCLUDED.collection_policy,
      updated_at = now()
  `, [record.entityId, name, optionalText(payload.platform) || "meituan_h5", poiIdStr, url,
    optionalText(payload.city), optionalText(payload.address), optionalText(payload.status) || "draft",
    JSON.stringify(payload.collectionPolicy || {})]);
}

async function applyAccount(client: PoolClient, record: RegistrySyncRecordInput): Promise<void> {
  const payload = record.payload;
  await client.query(`
    INSERT INTO account_pool (
      account_id, display_name, masked_login, operator_owner, status, risk_level,
      note, available_after, updated_at
    ) VALUES ($1,$2,$3,$4,$5,'normal',$6,$7,now())
    ON CONFLICT (account_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      masked_login = EXCLUDED.masked_login,
      operator_owner = EXCLUDED.operator_owner,
      note = EXCLUDED.note,
      updated_at = now()
  `, [record.entityId, payloadText(payload, "displayName"), payloadText(payload, "maskedLogin"),
    payloadText(payload, "operatorOwner"), optionalText(payload.status) || "available",
    optionalText(payload.note), optionalDate(payload.availableAfter)]);
}

async function applyCollectionPlan(client: PoolClient, record: RegistrySyncRecordInput): Promise<void> {
  const payload = record.payload;
  await client.query(`
    INSERT INTO collection_plan_definitions (
      plan_id, store_id, frequency, weekdays, start_window, target_completion,
      planned_accounts, priority, enabled_status, include_coupons, raw_retention,
      notification_policy, approval_status, source_payload, updated_at
    ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
    ON CONFLICT (plan_id) DO UPDATE SET
      store_id = EXCLUDED.store_id,
      frequency = EXCLUDED.frequency,
      weekdays = EXCLUDED.weekdays,
      start_window = EXCLUDED.start_window,
      target_completion = EXCLUDED.target_completion,
      planned_accounts = EXCLUDED.planned_accounts,
      priority = EXCLUDED.priority,
      enabled_status = EXCLUDED.enabled_status,
      include_coupons = EXCLUDED.include_coupons,
      raw_retention = EXCLUDED.raw_retention,
      notification_policy = EXCLUDED.notification_policy,
      approval_status = EXCLUDED.approval_status,
      source_payload = EXCLUDED.source_payload,
      updated_at = now()
  `, [record.entityId, payloadText(payload, "storeId"), optionalText(payload.frequency) || "temporary",
    JSON.stringify(Array.isArray(payload.weekdays) ? payload.weekdays : []), optionalText(payload.startWindow),
    optionalText(payload.targetCompletion), optionalNumber(payload.plannedAccounts), optionalText(payload.priority) || "normal",
    optionalText(payload.enabledStatus) || "draft", Boolean(payload.includeCoupons), optionalText(payload.rawRetention),
    optionalText(payload.notificationPolicy), optionalText(payload.approvalStatus) || "pending", JSON.stringify(payload)]);
}

async function applyWorkerRegistry(client: PoolClient, record: RegistrySyncRecordInput): Promise<void> {
  const payload = record.payload;
  await client.query(`
    INSERT INTO worker_registry_metadata (
      registry_worker_id, master_worker_id, device_name, operating_system, device_owner,
      location, ssh_alias, remote_desktop_type, remote_desktop_target,
      planned_slots, maximum_slots, maintenance_window, note, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    ON CONFLICT (registry_worker_id) DO UPDATE SET
      master_worker_id = EXCLUDED.master_worker_id,
      device_name = EXCLUDED.device_name,
      operating_system = EXCLUDED.operating_system,
      device_owner = EXCLUDED.device_owner,
      location = EXCLUDED.location,
      ssh_alias = EXCLUDED.ssh_alias,
      remote_desktop_type = EXCLUDED.remote_desktop_type,
      remote_desktop_target = EXCLUDED.remote_desktop_target,
      planned_slots = EXCLUDED.planned_slots,
      maximum_slots = EXCLUDED.maximum_slots,
      maintenance_window = EXCLUDED.maintenance_window,
      note = EXCLUDED.note,
      updated_at = now()
  `, [record.entityId, optionalText(payload.masterWorkerId), payloadText(payload, "deviceName"),
    optionalText(payload.operatingSystem), optionalText(payload.deviceOwner), optionalText(payload.location),
    optionalText(payload.sshAlias), optionalText(payload.remoteDesktopType), optionalText(payload.remoteDesktopTarget),
    optionalNumber(payload.plannedSlots), optionalNumber(payload.maximumSlots), optionalText(payload.maintenanceWindow),
    optionalText(payload.note)]);
}

function issue(code: string, message: string, record?: Pick<RegistrySyncRecordInput, "sourceTableId" | "sourceRecordId">): RegistryValidationIssue {
  return { code, message, sourceTableId: record?.sourceTableId, sourceRecordId: record?.sourceRecordId };
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function payloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (!requiredText(value)) throw new Error(`registry_payload_missing:${key}`);
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
