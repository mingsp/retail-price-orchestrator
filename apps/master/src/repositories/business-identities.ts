import { createHash } from "node:crypto";

export interface RunBusinessIdentityInput {
  channel: string;
  storeId: string;
  scheduleWindow: string;
  scopeVersion: string;
}

export interface CanonicalCategoryIdentityInput {
  categoryName: string;
  parentName?: string | null;
  categoryTag?: string | null;
  categoryType?: string | number | null;
}

function normalizeIdentityPart(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeCategoryName(value: string): string {
  return normalizeIdentityPart(value).replace(/\s+/gu, "");
}

export function buildRunBusinessKey(input: RunBusinessIdentityInput): string {
  const canonicalIdentity = [
    normalizeIdentityPart(input.channel).toLowerCase(),
    normalizeIdentityPart(input.storeId),
    normalizeIdentityPart(input.scheduleWindow),
    normalizeIdentityPart(input.scopeVersion)
  ].join("\u001f");

  return createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
}

export function buildCanonicalCategoryKey(input: CanonicalCategoryIdentityInput): string {
  const tag = input.categoryTag == null ? "" : normalizeIdentityPart(String(input.categoryTag));
  if (tag) {
    const type = input.categoryType == null ? "unknown" : normalizeIdentityPart(String(input.categoryType));
    return `tag:${type}:${tag}`;
  }

  const categoryName = normalizeCategoryName(input.categoryName);
  const parentName = input.parentName == null ? "" : normalizeCategoryName(input.parentName);
  return `name:${parentName ? `${parentName}/` : ""}${categoryName}`;
}
