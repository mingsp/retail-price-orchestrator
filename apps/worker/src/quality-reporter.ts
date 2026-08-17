import fs from "node:fs/promises";
import path from "node:path";
import type { RegisterPriceQualityInput } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { registerPriceQuality } from "./master-api.js";

export interface QualityRegistrationDefaults {
  taskId?: string;
  runId?: string;
  storeId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  artifactId?: string;
}

export async function registerQualityManifest(
  config: WorkerConfig,
  qualityPath: string,
  defaults: QualityRegistrationDefaults = {}
): Promise<void> {
  const payload = normalizeQualityManifest(JSON.parse(await fs.readFile(qualityPath, "utf8")), defaults);
  await registerPriceQuality(config, payload);
}

export async function findQualityManifestPath(summaryPath: string): Promise<string | undefined> {
  const summary = await readJsonFile(summaryPath);
  const explicit = pickQualityPath(summary, summaryPath);
  if (explicit && (await exists(explicit))) return explicit;

  const summaryPayload = extractEmbeddedQuality(summary);
  if (summaryPayload) return summaryPath;

  const dir = path.dirname(summaryPath);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const fallback = entries.find((entry) => entry.endsWith(".quality.json"));
  if (!fallback) return undefined;
  const candidate = path.join(dir, fallback);
  return (await exists(candidate)) ? candidate : undefined;
}

export function normalizeQualityManifest(
  manifest: unknown,
  defaults: QualityRegistrationDefaults = {}
): RegisterPriceQualityInput {
  const source = extractEmbeddedQuality(manifest);
  if (!source) throw new Error("quality_manifest_invalid");

  return {
    runId: pickString(source.runId) ?? defaults.runId,
    taskId: pickString(source.taskId) ?? defaults.taskId,
    storeId: pickString(source.storeId) ?? defaults.storeId,
    workerId: pickString(source.workerId) ?? defaults.workerId,
    accountId: pickString(source.accountId) ?? defaults.accountId,
    profileId: pickString(source.profileId) ?? defaults.profileId,
    artifactId: pickString(source.artifactId) ?? defaults.artifactId,
    rawRows: requireNumber(source.rawRows, "rawRows"),
    uniqueSpuCount: requireNumber(source.uniqueSpuCount, "uniqueSpuCount"),
    skuRows: requireNumber(source.skuRows, "skuRows"),
    frontDisplayPricePresent: requireNumber(source.frontDisplayPricePresent, "frontDisplayPricePresent"),
    skuFrontDisplayPricePresent: requireNumber(source.skuFrontDisplayPricePresent, "skuFrontDisplayPricePresent"),
    actualPriceInfoPresent: optionalNumber(source.actualPriceInfoPresent),
    promotionInfoPresent: optionalNumber(source.promotionInfoPresent),
    dynamicLabelPresent: optionalNumber(source.dynamicLabelPresent),
    duplicateSpuCount: optionalNumber(source.duplicateSpuCount),
    completenessStatus: requireCompletenessStatus(source.completenessStatus),
    metadata: isRecord(source.metadata) ? source.metadata : {}
  };
}

async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function pickQualityPath(summary: unknown, summaryPath: string): string | undefined {
  if (!isRecord(summary)) return undefined;
  const direct = [summary.qualityManifestPath, summary.qualityPath];
  if (isRecord(summary.metadata)) direct.push(summary.metadata.qualityManifestPath, summary.metadata.qualityPath);
  for (const value of direct) {
    const stringValue = pickString(value);
    if (!stringValue) continue;
    return path.isAbsolute(stringValue) ? stringValue : path.resolve(path.dirname(summaryPath), stringValue);
  }
  return undefined;
}

function extractEmbeddedQuality(manifest: unknown): Record<string, unknown> | undefined {
  if (!isRecord(manifest)) return undefined;
  if (looksLikeQualityPayload(manifest)) return manifest;
  if (isRecord(manifest.quality) && looksLikeQualityPayload(manifest.quality)) return manifest.quality;
  return undefined;
}

function looksLikeQualityPayload(value: Record<string, unknown>): boolean {
  return ["rawRows", "uniqueSpuCount", "skuRows", "frontDisplayPricePresent", "skuFrontDisplayPricePresent", "completenessStatus"].every(
    (key) => key in value
  );
}

function requireNumber(value: unknown, field: string): number {
  const parsed = optionalNumber(value);
  if (parsed === undefined) throw new Error(`quality_manifest_invalid:${field}`);
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function requireCompletenessStatus(value: unknown): "pass" | "warn" | "fail" {
  if (value === "pass" || value === "warn" || value === "fail") return value;
  throw new Error("quality_manifest_invalid:completenessStatus");
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
