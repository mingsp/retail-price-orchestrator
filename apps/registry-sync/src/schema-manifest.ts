import { createHash } from "node:crypto";

const allowedFieldTypes = new Set(["text", "single_select", "multi_select", "number", "date_time", "url", "person", "checkbox"]);
const allowedOwners = new Set(["business", "technical", "master", "worker", "shared"]);
const allowedSensitivity = new Set(["internal", "confidential", "restricted"]);

export interface RegistryFieldManifest {
  key: string;
  name: string;
  type: string;
  owner: string;
  sensitivity: string;
  syncToMaster: boolean;
  options?: string[];
}

export interface RegistryTableManifest {
  key: string;
  name: string;
  tableId?: string;
  fields: RegistryFieldManifest[];
}

export interface RegistrySchemaManifest {
  version: number;
  baseName: string;
  baseId?: string;
  tables: RegistryTableManifest[];
}

export function validateSchemaManifest(value: unknown): RegistrySchemaManifest {
  if (!value || typeof value !== "object") throw new Error("invalid_registry_schema");
  const manifest = value as RegistrySchemaManifest;
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw new Error("invalid_registry_schema_version");
  if (!manifest.baseName?.trim() || !Array.isArray(manifest.tables) || manifest.tables.length === 0) throw new Error("invalid_registry_schema");

  assertUnique(manifest.tables.map((table) => table.key), "duplicate_registry_table_key");
  for (const table of manifest.tables) {
    if (!table.key?.trim() || !table.name?.trim() || !Array.isArray(table.fields) || table.fields.length === 0) {
      throw new Error("invalid_registry_table");
    }
    assertUnique(table.fields.map((field) => field.key), "duplicate_registry_field_key");
    assertUnique(table.fields.map((field) => field.name), "duplicate_registry_field_name");
    for (const field of table.fields) {
      if (!field.key?.trim() || !field.name?.trim() || !allowedFieldTypes.has(field.type)) throw new Error("invalid_registry_field");
      if (!allowedOwners.has(field.owner) || !allowedSensitivity.has(field.sensitivity) || typeof field.syncToMaster !== "boolean") {
        throw new Error("invalid_registry_field_policy");
      }
      if (field.options && (!Array.isArray(field.options) || field.options.some((option) => !option.trim()))) {
        throw new Error("invalid_registry_field_options");
      }
    }
  }
  return manifest;
}

export function createSchemaHash(manifest: RegistrySchemaManifest): string {
  return createHash("sha256").update(stableStringify(manifest)).digest("hex");
}

function assertUnique(values: string[], errorCode: string) {
  if (new Set(values).size !== values.length) throw new Error(errorCode);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
