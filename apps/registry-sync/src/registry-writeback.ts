import { createHash } from "node:crypto";
import type { DwsRecord, DwsRecordWrite } from "./dws-client.js";
import { redactSensitiveText } from "./dws-client.js";
import type { InternalRegistryRecord, RuntimeTableState } from "./record-mapper.js";

export interface RegistryValidationIssue {
  code: string;
  message: string;
  sourceTableId?: string;
  sourceRecordId?: string;
}

export interface RegistryWritebackDwsClient {
  queryAllRecords(baseId: string, tableId: string): Promise<DwsRecord[]>;
  createRecords(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<string[]>;
  updateRecords(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<void>;
}

export interface TableRecordUpdates {
  tableId: string;
  records: DwsRecordWrite[];
}

export function buildPublishedRecordUpdates(
  records: InternalRegistryRecord[],
  tables: RuntimeTableState[],
  syncedAt: string
): TableRecordUpdates[] {
  const grouped = new Map<string, DwsRecordWrite[]>();
  for (const record of records) {
    const table = tables.find((candidate) => candidate.tableId === record.sourceTableId);
    if (!table) throw new Error(`registry_writeback_table_missing:${record.sourceTableId}`);
    const cells: Record<string, unknown> = {
      [requiredFieldId(table, "sync_version")]: record.sourceVersion,
      [requiredFieldId(table, "sync_status")]: "已同步",
      [requiredFieldId(table, "last_synced_at")]: syncedAt
    };
    addEntityFields(cells, record, table, syncedAt);
    const current = grouped.get(table.tableId) || [];
    current.push({ recordId: record.sourceRecordId, cells });
    grouped.set(table.tableId, current);
  }
  return [...grouped.entries()].map(([tableId, tableRecords]) => ({ tableId, records: tableRecords }));
}

export function buildSyncIssueRecord(
  issue: RegistryValidationIssue,
  issueTable: RuntimeTableState,
  observedAt: string
): DwsRecordWrite {
  const issueNumber = issueStableNumber(issue);
  return {
    cells: {
      [requiredFieldId(issueTable, "issue_number")]: issueNumber,
      [requiredFieldId(issueTable, "source_table")]: issue.sourceTableId || "批次级",
      [requiredFieldId(issueTable, "source_record_id")]: issue.sourceRecordId || "",
      [requiredFieldId(issueTable, "field_name")]: extractIssueField(issue.code),
      [requiredFieldId(issueTable, "issue_type")]: classifyIssueType(issue.code),
      [requiredFieldId(issueTable, "business_message")]: safeBusinessText(issue.message),
      [requiredFieldId(issueTable, "suggested_fix")]: suggestedFix(issue.code),
      [requiredFieldId(issueTable, "first_seen_at")]: observedAt,
      [requiredFieldId(issueTable, "last_seen_at")]: observedAt,
      [requiredFieldId(issueTable, "status")]: "待处理"
    }
  };
}

export async function writePublishedRecords(options: {
  baseId: string;
  records: InternalRegistryRecord[];
  tables: RuntimeTableState[];
  dws: RegistryWritebackDwsClient;
  syncedAt?: string;
}): Promise<number> {
  const updates = buildPublishedRecordUpdates(
    options.records,
    options.tables,
    options.syncedAt || new Date().toISOString()
  );
  let count = 0;
  for (const update of updates) {
    for (const batch of chunks(update.records, 30)) {
      await options.dws.updateRecords(options.baseId, update.tableId, batch);
      count += batch.length;
    }
    await assertWritebackReadback(options.dws, options.baseId, update.tableId, update.records);
  }
  return count;
}

export async function writeSyncIssues(options: {
  baseId: string;
  issues: RegistryValidationIssue[];
  tables: RuntimeTableState[];
  dws: RegistryWritebackDwsClient;
  observedAt?: string;
}): Promise<number> {
  if (!options.issues.length) return 0;
  const issueTable = options.tables.find((table) => table.key === "sync_issues");
  if (!issueTable) throw new Error("registry_sync_issue_table_missing");
  const numberFieldId = requiredFieldId(issueTable, "issue_number");
  const existing = await options.dws.queryAllRecords(options.baseId, issueTable.tableId);
  const byNumber = new Map(existing.map((record) => [String(record.cells[numberFieldId] || ""), record]));
  const observedAt = options.observedAt || new Date().toISOString();
  const creates: DwsRecordWrite[] = [];
  const updates: DwsRecordWrite[] = [];

  for (const issue of options.issues) {
    const draft = buildSyncIssueRecord(issue, issueTable, observedAt);
    const number = String(draft.cells[numberFieldId]);
    const current = byNumber.get(number);
    if (current) {
      const firstSeenId = requiredFieldId(issueTable, "first_seen_at");
      delete draft.cells[firstSeenId];
      updates.push({ recordId: current.recordId, cells: draft.cells });
    } else {
      creates.push(draft);
    }
  }

  for (const batch of chunks(creates, 30)) await options.dws.createRecords(options.baseId, issueTable.tableId, batch);
  for (const batch of chunks(updates, 30)) await options.dws.updateRecords(options.baseId, issueTable.tableId, batch);
  const expectedNumbers = [...creates, ...updates].map((item) => String(item.cells[numberFieldId]));
  const after = await options.dws.queryAllRecords(options.baseId, issueTable.tableId);
  const actualNumbers = new Set(after.map((record) => String(record.cells[numberFieldId] || "")));
  if (expectedNumbers.some((number) => !actualNumbers.has(number))) throw new Error("registry_issue_writeback_readback_failed");
  return creates.length + updates.length;
}

function addEntityFields(
  cells: Record<string, unknown>,
  record: InternalRegistryRecord,
  table: RuntimeTableState,
  syncedAt: string
): void {
  if (record.entityType === "store") {
    assign(cells, table, "poi_id_str", record.payload.poiIdStr);
    assign(cells, table, "canonical_url", record.payload.canonicalUrl);
    assignOptional(cells, table, "validation_status", "通过");
    assign(cells, table, "last_validated_at", syncedAt);
    assign(cells, table, "master_store_id", record.entityId);
    return;
  }
  if (record.entityType === "account") {
    assign(cells, table, "masked_phone", record.payload.maskedLogin);
    assign(cells, table, "phone_fingerprint", record.payload.phoneFingerprint);
    assign(cells, table, "master_account_id", record.entityId);
    return;
  }
  if (record.entityType === "worker") {
    assign(cells, table, "master_worker_id", record.entityId);
    return;
  }
  assign(cells, table, "master_plan_id", record.entityId);
}

function assign(cells: Record<string, unknown>, table: RuntimeTableState, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const field = table.fields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`registry_writeback_field_missing:${table.key}:${key}`);
  cells[field.fieldId] = value;
}

function assignOptional(cells: Record<string, unknown>, table: RuntimeTableState, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const field = table.fields.find((candidate) => candidate.key === key);
  if (field) cells[field.fieldId] = value;
}

function requiredFieldId(table: RuntimeTableState, key: string): string {
  const field = table.fields.find((candidate) => candidate.key === key);
  if (!field?.fieldId) throw new Error(`registry_writeback_field_missing:${table.key}:${key}`);
  return field.fieldId;
}

function issueStableNumber(issue: RegistryValidationIssue): string {
  const identity = [issue.code, issue.sourceTableId || "", issue.sourceRecordId || ""].join("|");
  return `SYNC-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 12).toUpperCase()}`;
}

function classifyIssueType(code: string): string {
  if (/schema/i.test(code)) return "Schema变化";
  if (/incomplete|pagination|partial/i.test(code)) return "读取不完整";
  if (/duplicate/i.test(code)) return "重复记录";
  if (/conflict|version/i.test(code)) return "版本冲突";
  if (/reference|not_found|missing_store/i.test(code)) return "引用缺失";
  return "数据校验";
}

function suggestedFix(code: string): string {
  const type = classifyIssueType(code);
  if (type === "Schema变化") return "请恢复被修改的字段名称和类型，再重新同步";
  if (type === "读取不完整") return "请确认钉钉可正常访问，等待下一次完整同步";
  if (type === "重复记录") return "请合并重复台账记录并保留唯一编号";
  if (type === "版本冲突") return "请核对最近修改，确认后提高同步版本";
  if (type === "引用缺失") return "请先补齐并启用被引用的门店或设备记录";
  return "请按业务说明补齐或修正对应字段";
}

function extractIssueField(code: string): string {
  const parts = code.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function safeBusinessText(value: string): string {
  return redactSensitiveText(value)
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s]*/g, "[本机路径已隐藏]")
    .slice(0, 500);
}

async function assertWritebackReadback(
  dws: RegistryWritebackDwsClient,
  baseId: string,
  tableId: string,
  expected: DwsRecordWrite[]
): Promise<void> {
  const actual = await dws.queryAllRecords(baseId, tableId);
  const byId = new Map(actual.map((record) => [record.recordId, record]));
  for (const item of expected) {
    const record = item.recordId ? byId.get(item.recordId) : undefined;
    if (!record) throw new Error("registry_writeback_readback_failed");
    for (const [fieldId, value] of Object.entries(item.cells)) {
      if (normalizeCell(record.cells[fieldId]) !== normalizeCell(value)) throw new Error("registry_writeback_readback_failed");
    }
  }
}

function normalizeCell(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (typeof object.name === "string") return object.name;
  }
  return JSON.stringify(value);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
