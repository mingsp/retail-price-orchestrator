import type { DwsField, DwsRecord, DwsUser } from "./dws-client.js";
import type { MasterRegistryClient, RegistryBatchRequest } from "./master-client.js";
import {
  mapAccountTableRecord,
  mapCollectionPlanTableRecord,
  mapStoreTableRecord,
  mapWorkerTableRecord,
  type InternalRegistryRecord,
  type RuntimeTableState
} from "./record-mapper.js";
import type { RegistryRuntimeState } from "./runtime-state.js";
import type { DwsRecordWrite } from "./dws-client.js";
import {
  writePublishedRecords,
  writeSyncIssues,
  type RegistryValidationIssue,
  type RegistryWritebackDwsClient
} from "./registry-writeback.js";

export interface RegistryDwsClient {
  queryFields(baseId: string, tableId: string): Promise<DwsField[]>;
  queryAllRecords(baseId: string, tableId: string): Promise<DwsRecord[]>;
  queryUsers?(userIds: string[]): Promise<DwsUser[]>;
  createRecords?(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<string[]>;
  updateRecords?(baseId: string, tableId: string, records: DwsRecordWrite[]): Promise<void>;
}

export interface RegistrySyncRunInput {
  runtimeState: RegistryRuntimeState;
  hmacKey: string;
  mode: "dry_run" | "publish";
  writebackEnabled?: boolean;
}

export interface RegistrySyncRunResult {
  mode: "dry_run" | "publish";
  recordCount: number;
  entityCounts: Record<string, number>;
  masterResult: Record<string, unknown>;
}

export async function runRegistrySync(
  input: RegistrySyncRunInput,
  dws: RegistryDwsClient,
  master: MasterRegistryClient
): Promise<RegistrySyncRunResult> {
  const recordsByTable = new Map<string, DwsRecord[]>();
  for (const table of input.runtimeState.tables.filter((candidate) => candidate.key !== "sync_issues")) {
    const actualFields = await dws.queryFields(input.runtimeState.baseId, table.tableId);
    assertTableSchema(table, actualFields);
    const records = await dws.queryAllRecords(input.runtimeState.baseId, table.tableId);
    recordsByTable.set(table.key, records.filter(isMeaningfulRecord));
  }
  if (input.writebackEnabled) {
    const issueTable = requiredTable(input.runtimeState.tables, "sync_issues");
    assertTableSchema(issueTable, await dws.queryFields(input.runtimeState.baseId, issueTable.tableId));
  }

  const mapped: InternalRegistryRecord[] = [];
  const storeTable = requiredTable(input.runtimeState.tables, "stores");
  const storeAliases = new Map<string, string>();
  for (const record of recordsByTable.get("stores") || []) {
    const item = safelyMap(() => mapStoreTableRecord(record, storeTable));
    mapped.push(item);
    const name = String(item.payload.name || "").trim();
    const policy = item.payload.collectionPolicy as Record<string, unknown> | undefined;
    const number = String(policy?.storeNumber || "").trim();
    if (name) storeAliases.set(name, item.entityId);
    if (number) storeAliases.set(number, item.entityId);
    storeAliases.set(item.entityId, item.entityId);
  }

  const accountTable = requiredTable(input.runtimeState.tables, "accounts");
  const accountRecords = await resolveAccountOwnerNames(recordsByTable.get("accounts") || [], accountTable, dws);
  for (const record of accountRecords) {
    mapped.push(safelyMap(() => mapAccountTableRecord(record, accountTable, input.hmacKey)));
  }

  const workerTable = requiredTable(input.runtimeState.tables, "workers");
  for (const record of recordsByTable.get("workers") || []) {
    mapped.push(safelyMap(() => mapWorkerTableRecord(record, workerTable)));
  }

  const planTable = requiredTable(input.runtimeState.tables, "collection_plans");
  for (const record of recordsByTable.get("collection_plans") || []) {
    mapped.push(safelyMap(() => mapCollectionPlanTableRecord(record, planTable, (reference) => storeAliases.get(reference))));
  }

  const batch: RegistryBatchRequest = {
    provider: "dingtalk_aitable",
    sourceBaseId: input.runtimeState.baseId,
    schemaHash: input.runtimeState.schemaHash,
    readComplete: true,
    records: mapped
  };
  const preflightResult = await master.preflight(batch);
  const preflightIssues = extractMasterIssues(preflightResult);
  if (preflightIssues.length > 0 || preflightResult.valid === false) {
    if (input.writebackEnabled) {
      await writeSyncIssues({
        baseId: input.runtimeState.baseId,
        issues: preflightIssues.length ? preflightIssues : [{ code: "registry_preflight_rejected", message: "台账预检未通过" }],
        tables: input.runtimeState.tables,
        dws: requireWritebackDws(dws)
      });
    }
    throw new Error("registry_preflight_rejected");
  }

  let masterResult = preflightResult;
  if (input.mode === "publish") {
    masterResult = await master.publish(batch);
    const publishIssues = extractMasterIssues(masterResult);
    if (publishIssues.length > 0 || masterResult.requestRejected === true) {
      if (input.writebackEnabled) {
        await writeSyncIssues({
          baseId: input.runtimeState.baseId,
          issues: publishIssues.length ? publishIssues : [{ code: "registry_publish_rejected", message: "台账发布未通过" }],
          tables: input.runtimeState.tables,
          dws: requireWritebackDws(dws)
        });
      }
      throw new Error("registry_publish_rejected");
    }
    if (input.writebackEnabled) {
      await writePublishedRecords({
        baseId: input.runtimeState.baseId,
        records: mapped,
        tables: input.runtimeState.tables,
        dws: requireWritebackDws(dws)
      });
    }
  }
  return {
    mode: input.mode,
    recordCount: mapped.length,
    entityCounts: mapped.reduce<Record<string, number>>((counts, record) => {
      counts[record.entityType] = (counts[record.entityType] || 0) + 1;
      return counts;
    }, {}),
    masterResult
  };
}

function extractMasterIssues(result: Record<string, unknown>): RegistryValidationIssue[] {
  if (!Array.isArray(result.issues)) return [];
  return result.issues.filter((item): item is RegistryValidationIssue => {
    if (!item || typeof item !== "object") return false;
    const issue = item as Record<string, unknown>;
    return typeof issue.code === "string" && typeof issue.message === "string";
  });
}

function requireWritebackDws(dws: RegistryDwsClient): RegistryWritebackDwsClient {
  if (typeof dws.createRecords !== "function" || typeof dws.updateRecords !== "function") {
    throw new Error("registry_writeback_client_missing");
  }
  return {
    queryAllRecords: dws.queryAllRecords.bind(dws),
    createRecords: dws.createRecords.bind(dws),
    updateRecords: dws.updateRecords.bind(dws)
  };
}

export function assertTableSchema(expected: RuntimeTableState, actual: DwsField[]): void {
  const byId = new Map(actual.map((field) => [field.fieldId, field]));
  for (const field of expected.fields) {
    const current = byId.get(field.fieldId);
    if (!current || current.fieldName !== field.fieldName || normalizeFieldType(current.type) !== normalizeFieldType(field.type)) {
      throw new Error(`registry_schema_drift:${expected.key}:${field.key}`);
    }
  }
}

function requiredTable(tables: RuntimeTableState[], key: string): RuntimeTableState {
  const table = tables.find((candidate) => candidate.key === key);
  if (!table) throw new Error(`registry_table_missing:${key}`);
  return table;
}

async function resolveAccountOwnerNames(
  records: DwsRecord[],
  table: RuntimeTableState,
  dws: RegistryDwsClient
): Promise<DwsRecord[]> {
  const ownerField = table.fields.find((field) => field.key === "operator_owner");
  if (!ownerField || records.length === 0) return records;

  const recordOwners = new Map<string, string>();
  const userIds = new Set<string>();
  for (const record of records) {
    const value = record.cells[ownerField.fieldId] ?? record.cells[ownerField.fieldName];
    if (embeddedOwnerName(value)) continue;
    const ids = extractOwnerUserIds(value);
    if (ids.length === 0) continue;
    if (ids.length !== 1) throw new Error("registry_account_owner_ambiguous");
    recordOwners.set(record.recordId, ids[0]!);
    userIds.add(ids[0]!);
  }

  if (userIds.size === 0) return records;
  if (!dws.queryUsers) throw new Error("registry_account_owner_resolver_missing");
  const users = await dws.queryUsers([...userIds].sort());
  const byId = new Map(users.map((user) => [user.userId, user]));

  return records.map((record) => {
    const userId = recordOwners.get(record.recordId);
    if (!userId) return record;
    const user = byId.get(userId);
    if (!user?.displayName.trim()) throw new Error("registry_account_owner_unresolved");
    return {
      ...record,
      cells: {
        ...record.cells,
        [ownerField.fieldId]: [{ userId, name: user.displayName.trim() }]
      }
    };
  });
}

function embeddedOwnerName(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const names = value.map(embeddedOwnerName).filter((name): name is string => Boolean(name));
    return names.length === 1 ? names[0] : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["name", "displayName", "label", "text"]) {
    if (typeof object[key] === "string" && object[key].trim()) return object[key].trim();
  }
  return undefined;
}

function extractOwnerUserIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const object = item as Record<string, unknown>;
    const userId = String(object.userId ?? object.orgUserId ?? "").trim();
    return userId ? [userId] : [];
  }))];
}

function safelyMap<T>(mapper: () => T): T {
  try {
    return mapper();
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_:.-]+$/i.test(error.message) ? error.message : "redacted";
    throw new Error(`registry_mapping_failed:${code}`);
  }
}

function normalizeFieldType(value: string): string {
  const compact = value.replace(/[_-]/g, "").toLowerCase();
  if (compact === "person" || compact === "user") return "person";
  if (compact === "date" || compact === "datetime") return "datetime";
  if (compact === "singleselect") return "singleselect";
  if (compact === "multiselect" || compact === "multipleselect") return "multiselect";
  return compact;
}

function isMeaningfulRecord(record: DwsRecord): boolean {
  return Object.values(record.cells).some(isMeaningfulCellValue);
}

function isMeaningfulCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isMeaningfulCellValue);
  if (typeof value === "object") return Object.values(value).some(isMeaningfulCellValue);
  return true;
}
