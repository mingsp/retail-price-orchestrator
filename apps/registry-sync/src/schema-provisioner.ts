import type { RegistryFieldManifest } from "./schema-manifest.js";

export interface DwsFieldDefinition {
  fieldName: string;
  type: string;
  config?: Record<string, unknown>;
}

export function toDwsField(field: RegistryFieldManifest): DwsFieldDefinition {
  const base = { fieldName: field.name };
  switch (field.type) {
    case "text":
    case "url":
    case "checkbox":
      return { ...base, type: field.type };
    case "number":
      return { ...base, type: "number", config: { formatter: "FLOAT_2" } };
    case "date_time":
      return { ...base, type: "date", config: { formatter: "YYYY-MM-DD HH:mm:ss" } };
    case "person":
      return { ...base, type: "user", config: { multiple: false } };
    case "single_select":
      return {
        ...base,
        type: "singleSelect",
        config: { options: requireOptions(field).map((name) => ({ name })) }
      };
    case "multi_select":
      return {
        ...base,
        type: "multipleSelect",
        config: { options: requireOptions(field).map((name) => ({ name })) }
      };
    default:
      throw new Error("unsupported_registry_field_type");
  }
}

export function chunkFields<T>(fields: T[], maximum = 15): T[][] {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 15) throw new Error("invalid_dws_field_batch_size");
  const chunks: T[][] = [];
  for (let index = 0; index < fields.length; index += maximum) {
    chunks.push(fields.slice(index, index + maximum));
  }
  return chunks;
}

function requireOptions(field: RegistryFieldManifest): string[] {
  if (!field.options?.length) throw new Error("registry_select_options_required");
  return field.options;
}
