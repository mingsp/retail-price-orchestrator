import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactRecord, CategoryTaskRecord, PriceQualityRecord } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "../apps/worker/src/config.js";
import { ingestRawProductJsonl } from "../apps/worker/src/product-ingestion.js";
import { registerPriceQuality, updateTask } from "../apps/worker/src/master-api.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const repairTimes = process.argv.includes("--repair-times");
const masterBaseUrl = process.env.MASTER_BASE_URL || "http://127.0.0.1:17890";
const tokenFile = process.env.WORKER_SHARED_TOKEN_FILE || path.join(root, ".runtime", "worker-shared-token.local");
const workerSharedToken = process.env.WORKER_SHARED_TOKEN || fs.readFileSync(tokenFile, "utf8").trim();
const selectedStore = process.argv.find((value) => value.startsWith("--store="))?.slice("--store=".length);

const config = {
  masterBaseUrl,
  workerSharedToken,
  masterRequestTimeoutMs: 30_000,
  mutationSpoolFile: path.join(root, ".runtime", "spool", "backfill-mutations.jsonl"),
  worker: { workerId: "pipeline-backfill" }
} as WorkerConfig;

const [tasksPayload, artifactsPayload, qualityPayload] = await Promise.all([
  fetchJson<{ tasks: CategoryTaskRecord[] }>("/api/tasks"),
  fetchJson<{ artifacts: ArtifactRecord[] }>("/api/artifacts"),
  fetchJson<{ qualityChecks: PriceQualityRecord[] }>("/api/quality-checks")
]);

const artifactsByTask = groupByTask(artifactsPayload.artifacts);
const qualityTaskIds = new Set(qualityPayload.qualityChecks.map((row) => row.taskId).filter(Boolean));

if (repairTimes) {
  let repaired = 0;
  let skipped = 0;
  for (const task of tasksPayload.tasks) {
    const cursor = (task.cursor || {}) as Record<string, unknown>;
    if (!cursor.pipelineBackfilledAt) continue;
    const nativeProgressTs = typeof cursor.nativeProgressTs === "string" ? cursor.nativeProgressTs : undefined;
    if (!nativeProgressTs) {
      skipped++;
      continue;
    }
    await updateTask(config, task.taskId, { lastProgressAt: nativeProgressTs });
    repaired++;
  }
  console.log(JSON.stringify({ mode: "repair-times", repaired, skipped }));
  process.exit(0);
}

const candidates = tasksPayload.tasks.filter((task) =>
  task.status === "completed" && (!selectedStore || task.storeId === selectedStore || task.storeName === selectedStore)
);

const summary = { mode: apply ? "apply" : "dry-run", candidates: candidates.length, ready: 0, skipped: 0, completed: 0, failed: 0 };

for (const task of candidates) {
  if (qualityTaskIds.has(task.taskId)) {
    summary.skipped++;
    log(task, "skip", "quality already registered");
    continue;
  }

  const captureId = captureIdentity(task);
  const rawPath = findRawPath(task, captureId);
  const rawArtifact = latestRawArtifact(artifactsByTask.get(task.taskId) || []);
  if (!captureId || !rawPath || !rawArtifact) {
    summary.skipped++;
    log(task, "skip", [!captureId ? "capture id missing" : "", !rawPath ? "raw JSONL missing" : "", !rawArtifact ? "raw artifact missing" : ""].filter(Boolean).join(", "));
    continue;
  }
  if (fs.statSync(rawPath).size === 0) {
    summary.skipped++;
    log(task, "skip", "raw JSONL is empty and requires business review");
    continue;
  }

  summary.ready++;
  if (!apply) {
    log(task, "ready", path.basename(rawPath));
    continue;
  }

  try {
    const ingestion = await ingestRawProductJsonl(config, rawPath, {
      artifactId: rawArtifact.artifactId,
      canonicalIdentity: { runId: task.runId, taskId: task.taskId, captureId }
    });
    if (ingestion.rawRows === 0 || ingestion.products !== ingestion.rawRows) {
      throw new Error(`raw_structured_mismatch:${ingestion.rawRows}:${ingestion.products}`);
    }

    await registerPriceQuality(config, {
      taskId: task.taskId,
      runId: task.runId,
      storeId: task.storeId,
      workerId: task.assignedWorkerId,
      accountId: task.assignedAccountId,
      profileId: task.assignedProfileId,
      artifactId: rawArtifact.artifactId,
      rawRows: ingestion.rawRows,
      uniqueSpuCount: ingestion.uniqueSpuCount,
      skuRows: ingestion.skus,
      frontDisplayPricePresent: ingestion.frontDisplayPricePresent,
      skuFrontDisplayPricePresent: ingestion.skuFrontDisplayPricePresent,
      actualPriceInfoPresent: ingestion.actualPriceInfoPresent,
      promotionInfoPresent: ingestion.promotionInfoPresent,
      duplicateSpuCount: ingestion.duplicateSpuCount,
      completenessStatus: "pass",
      metadata: { captureId, batches: ingestion.batches, source: "native_capture_backfill" }
    });
    await updateTask(config, task.taskId, {
      status: "completed_valid",
      collectedItems: ingestion.products,
      lastProgressAt: task.lastProgressAt || null,
      lastError: null,
      cursor: { ...task.cursor, captureId, completedAt: new Date().toISOString(), qualityStatus: "pass", pipelineBackfilledAt: new Date().toISOString() }
    });
    summary.completed++;
    log(task, "completed_valid", `${ingestion.products} products`);
  } catch (error) {
    summary.failed++;
    log(task, "failed", error instanceof Error ? error.message : String(error));
  }
}

console.log(JSON.stringify(summary));
if (summary.failed > 0) process.exitCode = 1;

async function fetchJson<T>(pathname: string): Promise<T> {
  const response = await fetch(new URL(pathname, masterBaseUrl));
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function groupByTask(artifacts: ArtifactRecord[]): Map<string, ArtifactRecord[]> {
  const grouped = new Map<string, ArtifactRecord[]>();
  for (const artifact of artifacts) {
    if (!artifact.taskId) continue;
    const rows = grouped.get(artifact.taskId) || [];
    rows.push(artifact);
    grouped.set(artifact.taskId, rows);
  }
  return grouped;
}

function latestRawArtifact(artifacts: ArtifactRecord[]): ArtifactRecord | undefined {
  return artifacts
    .filter((artifact) => artifact.kind === "raw_jsonl")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function captureIdentity(task: CategoryTaskRecord): string | undefined {
  const cursor = (task.cursor || {}) as Record<string, unknown>;
  const value = cursor.captureId || cursor.runId;
  return typeof value === "string" && value ? value : undefined;
}

function findRawPath(task: CategoryTaskRecord, captureId?: string): string | undefined {
  if (!captureId) return undefined;
  const directories = [
    path.join(root, ".runtime", "native-capture", task.storeId, task.runId, task.taskId),
    path.join(root, ".runtime", "native-capture", task.storeId, task.runId, captureId)
  ];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    const filename = fs.readdirSync(directory).find((name) => name.endsWith(".products.raw.jsonl"));
    if (filename) return path.join(directory, filename);
  }
  return undefined;
}

function log(task: CategoryTaskRecord, state: string, detail: string): void {
  console.log(`[backfill] ${task.storeName || task.storeId} | ${task.categoryName} | ${state} | ${detail}`);
}
