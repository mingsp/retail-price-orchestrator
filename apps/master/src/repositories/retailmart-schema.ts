export const compactSpuRemovedColumns = [
  "brand_name",
  "sku_count",
  "base_price_amount",
  "spu_price_basis",
  "match_method",
  "match_confidence",
  "price_quality",
  "created_at"
] as const;

export const compactSkuRemovedColumns = [
  "unit_price_amount",
  "match_method",
  "match_confidence",
  "price_quality",
  "created_at"
] as const;

export const sourceFactSpuRemovedColumns = [
  "comparison_price_amount",
  "comparison_price_type"
] as const;

export const sourceFactSkuRemovedColumns = [
  "comparison_price_amount",
  "comparison_price_type"
] as const;

export type FactSchemaState = "legacy" | "compact" | "mixed";

export function classifyFactSchema(
  columns: readonly string[],
  removedColumns: readonly string[]
): FactSchemaState {
  const presentCount = removedColumns.filter((column) => columns.includes(column)).length;
  if (presentCount === removedColumns.length) return "legacy";
  if (presentCount === 0) return "compact";
  return "mixed";
}
