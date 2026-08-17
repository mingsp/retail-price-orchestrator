import { readFile } from "node:fs/promises";
import type { RuntimeTableState } from "./record-mapper.js";
import type { RegistrySchemaManifest } from "./schema-manifest.js";
import { createSchemaHash } from "./schema-manifest.js";

interface PersistedFieldState {
  fieldId: string;
  fieldName: string;
  type: string;
}

interface PersistedTableState {
  key: string;
  name: string;
  tableId: string;
  fields: PersistedFieldState[];
}

export interface RegistryRuntimeState {
  baseId: string;
  schemaHash: string;
  tables: RuntimeTableState[];
}

export async function loadRegistryRuntimeState(path: string, manifest: RegistrySchemaManifest): Promise<RegistryRuntimeState> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const baseId = requiredText(raw.baseId, "registry_state_base_missing");
  const schemaHash = requiredText(raw.schemaHash, "registry_state_hash_missing");
  if (schemaHash !== createSchemaHash(manifest)) throw new Error("registry_state_schema_hash_mismatch");
  if (!Array.isArray(raw.tables)) throw new Error("registry_state_tables_missing");
  const persisted = raw.tables as PersistedTableState[];
  const tables = manifest.tables.map((definition) => {
    const state = persisted.find((item) => item.key === definition.key);
    if (!state?.tableId || !Array.isArray(state.fields)) throw new Error(`registry_state_table_missing:${definition.key}`);
    return {
      key: definition.key,
      name: definition.name,
      tableId: state.tableId,
      fields: definition.fields.map((field) => {
        const deployed = state.fields.find((item) => item.fieldName === field.name);
        if (!deployed?.fieldId) throw new Error(`registry_state_field_missing:${definition.key}:${field.key}`);
        return { ...deployed, key: field.key };
      })
    };
  });
  return { baseId, schemaHash, tables };
}

function requiredText(value: unknown, error: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(error);
  return value;
}
