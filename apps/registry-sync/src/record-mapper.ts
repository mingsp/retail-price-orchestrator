import { createHash } from "node:crypto";
import { mapAccountRecord } from "./account-mapper.js";
import type { DwsRecord } from "./dws-client.js";
import { normalizeStoreUrl } from "./store-mapper.js";

export interface RuntimeFieldState {
  fieldId: string;
  fieldName: string;
  type: string;
  key: string;
}

export interface RuntimeTableState {
  key: string;
  name: string;
  tableId: string;
  fields: RuntimeFieldState[];
}

export interface InternalRegistryRecord {
  sourceTableId: string;
  sourceRecordId: string;
  sourceVersion: number;
  entityType: "store" | "account" | "worker" | "collection_plan";
  entityId: string;
  contentHash: string;
  payload: Record<string, unknown>;
}

export function mapStoreTableRecord(record: DwsRecord, table: RuntimeTableState): InternalRegistryRecord {
  const cells = createCellReader(record, table);
  const normalized = normalizeStoreUrl(cells.requiredText("submitted_url"));
  const linkedMasterStoreId = normalizeLinkedStoreId(cells.text("master_store_id"));
  const payload = compact({
    name: cells.requiredText("store_name"),
    platform: normalizePlatform(cells.text("platform")),
    poiIdStr: normalized.poiIdStr,
    canonicalUrl: normalized.canonicalUrl,
    city: cells.text("city"),
    address: cells.text("address"),
    status: normalizeStoreStatus(cells.text("enabled_status")),
    collectionPolicy: compact({
      storeNumber: cells.text("store_number"),
      businessArea: cells.text("business_area"),
      priority: cells.text("priority"),
      frequency: cells.text("frequency"),
      weeklyRounds: cells.number("weekly_rounds"),
      expectedHours: cells.number("expected_hours"),
      defaultAccountCount: cells.number("default_account_count"),
      businessOwner: cells.text("business_owner"),
      note: cells.text("note")
    })
  });
  return envelope(
    record,
    table,
    "store",
    linkedMasterStoreId || stableEntityId("store", normalized.identityKey),
    payload,
    cells.version()
  );
}

export function mapAccountTableRecord(record: DwsRecord, table: RuntimeTableState, hmacKey: string): InternalRegistryRecord {
  const cells = createCellReader(record, table);
  const owner = cells.requiredText("operator_owner");
  const dto = mapAccountRecord({
    phone: cells.requiredText("account_number"),
    owner,
    displayName: owner,
    department: cells.text("department"),
    minimumCooldownHours: cells.number("minimum_cooldown_hours")
  }, hmacKey);
  const payload = compact({
    displayName: dto.displayName,
    maskedLogin: dto.maskedLogin,
    phoneFingerprint: dto.phoneFingerprint,
    operatorOwner: dto.operatorOwner,
    department: dto.department,
    minimumCooldownHours: dto.minimumCooldownHours
  });
  return envelope(record, table, "account", `account-${dto.phoneFingerprint.slice(0, 24)}`, payload, cells.version());
}

export function mapWorkerTableRecord(record: DwsRecord, table: RuntimeTableState): InternalRegistryRecord {
  const cells = createCellReader(record, table);
  const sourceIdentity = cells.text("worker_number") || record.recordId;
  const payload = compact({
    deviceName: cells.requiredText("device_name"),
    hostname: cells.text("hostname"),
    currentIp: cells.text("current_ip"),
    macAddress: cells.text("mac_address"),
    operatingSystem: normalizeOperatingSystem(cells.text("operating_system")),
    deviceOwner: cells.text("device_owner"),
    location: cells.text("location"),
    sshAlias: cells.text("ssh_alias"),
    sshUsername: cells.text("ssh_username"),
    sshStatus: cells.text("ssh_status"),
    remoteDesktopType: cells.text("remote_desktop_type"),
    remoteDesktopTarget: cells.text("remote_desktop_target"),
    plannedSlots: cells.number("planned_slots"),
    maximumSlots: cells.number("maximum_slots"),
    maintenanceWindow: cells.text("maintenance_window"),
    masterWorkerId: cells.text("master_worker_id"),
    note: cells.text("note")
  });
  return envelope(record, table, "worker", stableEntityId("worker-registry", sourceIdentity), payload, cells.version());
}

export function mapCollectionPlanTableRecord(
  record: DwsRecord,
  table: RuntimeTableState,
  resolveStoreId: (reference: string) => string | undefined
): InternalRegistryRecord {
  const cells = createCellReader(record, table);
  const storeReference = cells.requiredText("store_reference");
  const storeId = resolveStoreId(storeReference);
  if (!storeId) throw new Error("collection_plan_store_not_found");
  const sourceIdentity = cells.text("plan_number") || record.recordId;
  const payload = compact({
    storeId,
    frequency: cells.text("frequency"),
    weekdays: cells.list("weekdays"),
    startWindow: cells.text("start_window"),
    targetCompletion: cells.text("target_completion"),
    plannedAccounts: cells.number("planned_accounts"),
    priority: cells.text("priority"),
    enabledStatus: cells.text("enabled_status"),
    includeCoupons: cells.boolean("include_coupons"),
    rawRetention: cells.text("raw_retention"),
    notificationPolicy: cells.text("notification_policy"),
    approvalStatus: cells.text("approval_status")
  });
  return envelope(record, table, "collection_plan", stableEntityId("plan", sourceIdentity), payload, cells.version());
}

function envelope(
  record: DwsRecord,
  table: RuntimeTableState,
  entityType: InternalRegistryRecord["entityType"],
  entityId: string,
  payload: Record<string, unknown>,
  sourceVersion: number
): InternalRegistryRecord {
  return {
    sourceTableId: table.tableId,
    sourceRecordId: record.recordId,
    sourceVersion,
    entityType,
    entityId,
    contentHash: createHash("sha256").update(stableStringify(payload), "utf8").digest("hex"),
    payload
  };
}

function createCellReader(record: DwsRecord, table: RuntimeTableState) {
  const fields = new Map(table.fields.map((field) => [field.key, field]));
  const raw = (key: string): unknown => {
    const field = fields.get(key);
    if (!field) return undefined;
    return record.cells[field.fieldId] ?? record.cells[field.fieldName];
  };
  return {
    text(key: string) { return toText(raw(key)); },
    requiredText(key: string) {
      const value = toText(raw(key));
      if (!value) throw new Error(`registry_required_field_missing:${key}`);
      return value;
    },
    number(key: string) { return toNumber(raw(key)); },
    boolean(key: string) { return toBoolean(raw(key)); },
    list(key: string) { return toList(raw(key)); },
    version() {
      const explicit = toNumber(raw("sync_version"));
      if (explicit && Number.isSafeInteger(explicit) && explicit > 0) return explicit;
      const sourceTime = record.updatedAt ?? record.modifiedTime ?? record.updatedTime;
      const timestamp = sourceTime ? new Date(String(sourceTime)).getTime() : Number.NaN;
      return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 1;
    }
  };
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const values = value.map(toText).filter((item): item is string => Boolean(item));
    return values.join(",") || undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["name", "text", "link", "url", "value", "label", "displayName"]) {
    const normalized = toText(object[key]);
    if (normalized) return normalized;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = toText(value);
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const text = toText(value)?.toLowerCase();
  if (["true", "1", "是", "勾选"].includes(text || "")) return true;
  if (["false", "0", "否", "未勾选"].includes(text || "")) return false;
  return undefined;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toText).filter((item): item is string => Boolean(item));
  const text = toText(value);
  return text ? text.split(/[,，]/).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizePlatform(value: string | undefined): string {
  return !value || value === "美团H5" ? "meituan_h5" : value;
}

function normalizeOperatingSystem(value: string | undefined): string | undefined {
  if (value === "Windows" || value === "macOS") return value;
  return value;
}

function normalizeStoreStatus(value: string | undefined): string {
  if (value === "启用") return "active";
  if (value === "暂停") return "paused";
  if (value === "退役") return "retired";
  return "draft";
}

function normalizeLinkedStoreId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error("invalid_master_store_id");
  return value;
}

function stableEntityId(prefix: string, identity: string): string {
  return `${prefix}-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24)}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
