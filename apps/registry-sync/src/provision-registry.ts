import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import manifestValue from "../../../deploy/dingtalk/production-registry.schema.json" with { type: "json" };
import { executeDwsJson } from "./dws-client.js";
import { chunkFields, toDwsField, type DwsFieldDefinition } from "./schema-provisioner.js";
import { createSchemaHash, validateSchemaManifest } from "./schema-manifest.js";

interface DwsResult {
  success?: boolean;
  data?: Record<string, unknown>;
  summary?: string;
}

interface DwsTable {
  tableId: string;
  tableName: string;
}

interface DwsField {
  fieldId: string;
  fieldName: string;
  type: string;
}

const manifest = validateSchemaManifest(manifestValue);
const statePath = requiredEnvironment("REGISTRY_STATE_PATH");

const baseId = await resolveBaseId();
const tableState: Array<{ key: string; name: string; tableId: string; fields: DwsField[] }> = [];

for (const table of manifest.tables) {
  const base = await getBase(baseId);
  const existing = base.tables.find((candidate) => candidate.tableName === table.name);
  const tableId = existing?.tableId || await createTable(baseId, table.name, table.fields.map(toDwsField));
  await ensureFields(baseId, tableId, table.fields.map(toDwsField));
  const fields = await getFields(baseId, tableId);
  verifyFields(table.name, fields, table.fields.map(toDwsField));
  tableState.push({ key: table.key, name: table.name, tableId, fields });
}

await mkdir(dirname(statePath), { recursive: true });
await writeFile(statePath, `${JSON.stringify({
  version: manifest.version,
  baseId,
  baseName: manifest.baseName,
  schemaHash: createSchemaHash(manifest),
  provisionedAt: new Date().toISOString(),
  tables: tableState
}, null, 2)}\n`, { encoding: "utf8", flag: "w" });

process.stdout.write(`${JSON.stringify({
  success: true,
  baseName: manifest.baseName,
  tableCount: tableState.length,
  fieldCount: tableState.reduce((sum, table) => sum + table.fields.length, 0),
  statePath
})}\n`);

async function resolveBaseId(): Promise<string> {
  const configured = process.env.DINGTALK_BASE_ID?.trim();
  if (configured) {
    const base = await getBase(configured);
    if (base.baseName !== manifest.baseName) throw new Error("configured_dingtalk_base_name_mismatch");
    return configured;
  }

  const search = await runDws(["aitable", "base", "search", "--query", manifest.baseName]);
  const bases = asArray(search.data?.bases).filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
  const exact = bases.filter((base) => base.baseName === manifest.baseName);
  if (exact.length > 1) throw new Error("duplicate_dingtalk_registry_base");
  if (exact.length === 1) return requiredString(exact[0].baseId, "dingtalk_base_id_missing");

  const created = await runDws(["aitable", "base", "create", "--name", manifest.baseName]);
  return requiredString(created.data?.baseId, "dingtalk_base_create_missing_id");
}

async function getBase(baseId: string) {
  const result = await runDws(["aitable", "base", "get", "--base-id", baseId]);
  return {
    baseId: requiredString(result.data?.baseId, "dingtalk_base_id_missing"),
    baseName: requiredString(result.data?.baseName, "dingtalk_base_name_missing"),
    tables: asArray(result.data?.tables).map((table) => {
      const value = table as Record<string, unknown>;
      return {
        tableId: requiredString(value.tableId, "dingtalk_table_id_missing"),
        tableName: requiredString(value.tableName, "dingtalk_table_name_missing")
      };
    }) as DwsTable[]
  };
}

async function createTable(baseId: string, name: string, fields: DwsFieldDefinition[]): Promise<string> {
  const [initial, ...remaining] = chunkFields(fields);
  const created = await runDws([
    "aitable", "table", "create",
    "--base-id", baseId,
    "--name", name,
    "--fields", JSON.stringify(initial)
  ]);
  const tableId = requiredString(created.data?.tableId, "dingtalk_table_create_missing_id");
  for (const batch of remaining) await createFields(baseId, tableId, batch);
  return tableId;
}

async function ensureFields(baseId: string, tableId: string, expected: DwsFieldDefinition[]) {
  const existing = await getFields(baseId, tableId);
  const byName = new Map(existing.map((field) => [field.fieldName, field]));
  for (const field of expected) {
    const current = byName.get(field.fieldName);
    if (current && current.type !== field.type) throw new Error(`dingtalk_field_type_conflict:${field.fieldName}`);
  }
  const missing = expected.filter((field) => !byName.has(field.fieldName));
  for (const batch of chunkFields(missing)) await createFields(baseId, tableId, batch);
}

async function createFields(baseId: string, tableId: string, fields: DwsFieldDefinition[]) {
  if (fields.length === 0) return;
  await runDws([
    "aitable", "field", "create",
    "--base-id", baseId,
    "--table-id", tableId,
    "--fields", JSON.stringify(fields)
  ]);
}

async function getFields(baseId: string, tableId: string): Promise<DwsField[]> {
  const result = await runDws(["aitable", "field", "get", "--base-id", baseId, "--table-id", tableId]);
  return asArray(result.data?.fields).map((field) => {
    const value = field as Record<string, unknown>;
    return {
      fieldId: requiredString(value.fieldId, "dingtalk_field_id_missing"),
      fieldName: requiredString(value.fieldName, "dingtalk_field_name_missing"),
      type: requiredString(value.type, "dingtalk_field_type_missing")
    };
  });
}

function verifyFields(tableName: string, actual: DwsField[], expected: DwsFieldDefinition[]) {
  const actualByName = new Map(actual.map((field) => [field.fieldName, field]));
  for (const field of expected) {
    const current = actualByName.get(field.fieldName);
    if (!current) throw new Error(`dingtalk_field_missing:${tableName}:${field.fieldName}`);
    if (current.type !== field.type) throw new Error(`dingtalk_field_type_conflict:${tableName}:${field.fieldName}`);
  }
}

async function runDws(args: string[]): Promise<DwsResult> {
  const result = await executeDwsJson([...args, "--yes", "--format", "json"], 90_000) as DwsResult;
  if (!result || result.success !== true || !result.data) throw new Error("dws_operation_failed");
  return result;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("dws_array_result_missing");
  return value;
}
