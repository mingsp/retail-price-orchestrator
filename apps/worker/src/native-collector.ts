import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AccountSnapshot, CategoryTaskRecord, TaskStatus } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { buildNativeArtifactUploadPlan, type NativeOutputFiles, uploadArtifactPlan } from "./artifact-uploader.js";
import { createRiskEvent, registerIngestionError, registerPriceQuality, setTaskStatus, updateTask } from "./master-api.js";
import { captureRiskScreenshot } from "./risk-screenshot.js";
import { ingestRawProductJsonl } from "./product-ingestion.js";
import { replayProgressFile } from "./progress-reporter.js";
import { findQualityManifestPath, registerQualityManifest } from "./quality-reporter.js";
import { collectorProcessGroupOptions, terminateChildProcessTree, waitForChildClose } from "./child-process-lifecycle.js";
import { getExecutionRuntime } from "./execution-runtime.js";

interface NativeRunContext {
  config: WorkerConfig;
  task: CategoryTaskRecord;
  account: AccountSnapshot;
  signal?: AbortSignal;
}

export async function runNativeCollector({ config, task, account, signal }: NativeRunContext): Promise<void> {
  if (signal?.aborted) throw new Error("native_collector_aborted");
  const scriptRoot = path.resolve(process.cwd(), config.nativeScriptRoot);
  const scriptPath = path.join(scriptRoot, config.nativeScriptName);
  const captureAttemptId = typeof task.cursor?.captureAttemptId === "string" ? task.cursor.captureAttemptId : undefined;
  const resumeCaptureId = typeof task.cursor?.resumeCaptureId === "string" ? task.cursor.resumeCaptureId : undefined;
  const { runId, captureId } = buildNativeRunIdentity(
    task.runId,
    task.taskId,
    config.worker.workerId,
    captureAttemptId,
    resumeCaptureId
  );
  const outputDir = path.resolve(process.cwd(), config.nativeOutputRoot, task.storeId, task.runId, task.taskId);
  const outputFiles: NativeOutputFiles = {
    raw: path.join(outputDir, `${captureId}.products.raw.jsonl`),
    categories: path.join(outputDir, `${captureId}.categories.jsonl`),
    progress: path.join(outputDir, `${captureId}.progress.jsonl`),
    summary: path.join(outputDir, `${captureId}.summary.json`),
    checkpoint: path.join(outputDir, `${captureId}.checkpoint.json`)
  };

  await assertRequiredFile(scriptPath, "native collector script");
  await fs.mkdir(outputDir, { recursive: true });

  const runCursor = prepareNativeRunCursor(task.cursor, captureId, outputDir);
  await markNativeCollectorStarted(config, task.taskId, runCursor);

  const env = buildNativeEnv(config, task, account, runId, captureId, outputDir);
  const child = spawn(process.execPath, [scriptPath], {
    ...collectorProcessGroupOptions(),
    cwd: scriptRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const childClosed = waitForChildClose(child);
  const abortHandler = () => {
    void terminateChildProcessTree(child).catch((error) => {
      console.error(`[native-collector:${task.taskId}] failed to terminate process tree: ${error.message}`);
    });
  };
  signal?.addEventListener("abort", abortHandler, { once: true });

  let collectedItems = task.collectedItems || 0;
  let latestCursor = runCursor;
  const processedProgressLines = new Set<string>();
  const pendingProgressUpdates: Promise<void>[] = [];
  let stdoutBuffer = "";
  let manualRequiredDetected = false;
  const updateProgressState = (event: any) => {
    if (typeof event.collectedItems === "number") {
      collectedItems = Math.max(collectedItems, event.collectedItems);
    }
    const eventTs = typeof event.ts === "string" ? event.ts : new Date().toISOString();
    const latestProgressTs = typeof latestCursor.nativeProgressTs === "string" ? latestCursor.nativeProgressTs : "";
    if (latestProgressTs && eventTs < latestProgressTs) {
      return { collectedItems, latestCursor };
    }
    latestCursor = mergeCursor(latestCursor, {
      lastEvent: event.event,
      updatedAt: new Date().toISOString(),
      nativeProgressTs: eventTs,
      percent: event.percent ?? undefined,
      requestCount: event.requestCount ?? undefined,
      totalRows: event.totalRows ?? undefined,
      totalUniqueSpu: event.totalUniqueSpu ?? undefined,
      adaptiveObservedChunkSize: event.adaptiveObservedChunkSize ?? undefined
    });
    return { collectedItems, latestCursor };
  };
  const markManualRequired = (cursor: Record<string, unknown>) => {
    manualRequiredDetected = true;
    latestCursor = cursor;
  };
  const processNativeProgressLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const pending = handleNativeLine(config, task, account, trimmed, updateProgressState, markManualRequired)
      .then(() => {
        processedProgressLines.add(trimmed);
      })
      .catch((error) => {
        console.error(`[worker] failed to handle native progress line: ${error.message}`);
      });
    pendingProgressUpdates.push(pending);
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) processNativeProgressLine(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    console.error(`[native-collector:${task.taskId}] ${chunk.trim()}`);
  });

  const exitCode = await childClosed;
  signal?.removeEventListener("abort", abortHandler);
  if (signal?.aborted) throw new Error("native_collector_aborted");

  if (stdoutBuffer.trim()) processNativeProgressLine(stdoutBuffer);
  await Promise.all(pendingProgressUpdates);
  const replayResult = await replayProgressFile(outputFiles.progress, {
    seenLines: processedProgressLines,
    onLine: async (line) => {
      if (isNativeProgressLineBeforeRun(line, runCursor.startedAt)) {
        processedProgressLines.add(line);
        return;
      }
      await handleNativeLine(config, task, account, line, updateProgressState, markManualRequired);
      processedProgressLines.add(line);
    }
  }).catch((error) => {
    console.error(`[worker] failed to replay native progress file: ${error.message}`);
    return { replayed: 0, skipped: 0 };
  });
  if (replayResult.replayed > 0) {
    console.log(`[native-collector:${task.taskId}] replayed ${replayResult.replayed} missed progress events`);
  }

  const summaryResult = await readNativeSummaryResult(outputFiles.summary);
  const finalStatus = resolveNativeFinalStatus(exitCode, manualRequiredDetected, summaryResult.status);
  const terminalCursor = mergeCursor(latestCursor, {
    adapter: "native-cdp",
    runId,
    captureId,
    skippedAt: finalStatus === "skipped" ? new Date().toISOString() : undefined,
    failedAt: finalStatus === "failed" ? new Date().toISOString() : undefined,
    manualRequiredPreservedAt: finalStatus === "manual_required" ? new Date().toISOString() : undefined,
    nativeExitCode: exitCode ?? undefined
  });

  if (finalStatus !== "captured") {
    await updateTask(config, task.taskId, {
      status: finalStatus,
      collectedItems,
      ...(finalStatus === "failed" ? { lastError: summaryResult.error || `native collector exited with code ${exitCode}` } : {}),
      ...(finalStatus === "skipped" ? { lastError: summaryResult.skippedReason || "native collector skipped task" } : {}),
      cursor: terminalCursor
    });
    await uploadArtifactPlan(config, task, account, buildNativeArtifactUploadPlan(task, captureId, outputFiles)).catch((error) => {
      console.warn(`[native-collector:${task.taskId}] partial artifact upload failed: ${error.message}`);
    });
    return;
  }

  await updateTask(config, task.taskId, { status: "captured", collectedItems, cursor: terminalCursor });
  const { productPipelinePool } = getExecutionRuntime();
  await productPipelinePool.run({ key: task.taskId, signal }, async () => {
    let rawArtifactId: string | undefined;
    try {
    await updateTask(config, task.taskId, { status: "uploading" });
    const uploadedArtifacts = await uploadArtifactPlan(
      config,
      task,
      account,
      buildNativeArtifactUploadPlan(task, captureId, outputFiles)
    );
    rawArtifactId = uploadedArtifacts.raw?.artifactId;
    if (!rawArtifactId) throw new Error("raw_artifact_missing");

    await updateTask(config, task.taskId, {
      status: "structuring",
      rawArtifactId,
      checkpointArtifactId: uploadedArtifacts.checkpoint?.artifactId ?? null,
      summaryArtifactId: uploadedArtifacts.summary?.artifactId ?? null
    });
    const ingestion = await ingestRawProductJsonl(config, outputFiles.raw, {
      artifactId: rawArtifactId,
      canonicalIdentity: { runId: task.runId, taskId: task.taskId, captureId }
    });
    if (ingestion.rawRows === 0 || ingestion.products !== ingestion.rawRows) {
      throw new Error(`raw_structured_mismatch:${ingestion.rawRows}:${ingestion.products}`);
    }

    await updateTask(config, task.taskId, { status: "validating" });
    const quality = await registerPriceQuality(config, {
      taskId: task.taskId,
      runId: task.runId,
      storeId: task.storeId,
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      artifactId: rawArtifactId,
      rawRows: ingestion.rawRows,
      uniqueSpuCount: ingestion.uniqueSpuCount,
      skuRows: ingestion.skus,
      frontDisplayPricePresent: ingestion.frontDisplayPricePresent,
      skuFrontDisplayPricePresent: ingestion.skuFrontDisplayPricePresent,
      actualPriceInfoPresent: ingestion.actualPriceInfoPresent,
      promotionInfoPresent: ingestion.promotionInfoPresent,
      duplicateSpuCount: ingestion.duplicateSpuCount,
      metadata: {
        captureId,
        categoryComplete: true,
        batches: ingestion.batches,
        categoryProductRelationCount: ingestion.uniqueCategorySpuCount,
        repeatedCrossCategorySpuCount: ingestion.repeatedCrossCategorySpuCount,
        actualPriceCoverage: (ingestion.products + ingestion.skus) > 0
          ? ingestion.actualPriceInfoPresent / (ingestion.products + ingestion.skus)
          : 0
      }
    });
    if (quality.completenessStatus !== "pass") {
      throw new Error(`master_quality_${quality.completenessStatus}`);
    }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await registerIngestionError(config, {
        errorKey: `${task.taskId}:${captureId}:pipeline`,
        artifactId: rawArtifactId,
        runId: task.runId,
        taskId: task.taskId,
        storeId: task.storeId,
        errorCode: message.split(":", 1)[0] || "data_pipeline_failed",
        errorMessage: message,
        rawExcerpt: `captureId=${captureId}`
      }).catch(() => undefined);
      await updateTask(config, task.taskId, {
        status: "needs_review",
        lastError: `data_pipeline_failed:${message}`,
        cursor: mergeCursor(terminalCursor, { pipelineFailedAt: new Date().toISOString() })
      }).catch(() => undefined);
      throw error;
    }
  });
}

export async function markNativeCollectorStarted(
  config: WorkerConfig,
  taskId: string,
  cursor: Record<string, unknown>
): Promise<void> {
  await setTaskStatus(config, taskId, "collecting", { cursor });
}

export function resolveNativeFinalStatus(
  exitCode: number | null,
  manualRequiredDetected: boolean,
  summaryStatus?: string
): TaskStatus {
  if (manualRequiredDetected) return "manual_required";
  if (summaryStatus === "skipped") return "skipped";
  if (summaryStatus === "manual_required") return "manual_required";
  if (summaryStatus === "incomplete") return "failed";
  if (summaryStatus === "completed" && exitCode === 0) return "captured";
  if (summaryStatus === "failed") return "failed";
  return exitCode === 0 ? "captured" : "failed";
}

export function resolveNativeProgressStatus(_event: { event?: string; completed?: boolean }): TaskStatus {
  return "collecting";
}

function buildNativeEnv(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  runId: string,
  captureId: string,
  outputDir: string
): Record<string, string> {
  const cursor = task.cursor || {};
  const categoryI = pickCursorNumber(cursor, "categoryI");
  const categoryJ = pickCursorNumber(cursor, "categoryJ");
  const observedSmoothChunkSize = pickCursorNumber(cursor, "observedSmoothChunkSize");
  const categoryTag = typeof cursor.categoryTag === "string" ? cursor.categoryTag : "";
  const targetUrlPart = typeof cursor.targetUrlPart === "string" ? cursor.targetUrlPart : "";

  const env: Record<string, string> = {
    MT_RUN_ID: runId,
    MT_CAPTURE_ID: captureId,
    MT_TASK_ID: task.taskId,
    MT_WORKER_ID: config.worker.workerId,
    MT_STORE_ID: task.storeId,
    MT_STORE_NAME: task.storeName || "",
    MT_ACCOUNT_ID: account.accountId,
    MT_ACCOUNT_LABEL: account.displayName,
    MT_PROFILE_ID: account.profileId,
    MT_PROFILE_PATH: account.profilePath,
    MT_CDP_PORT: String(account.cdpPort),
    MT_CDP_ENDPOINT: account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`,
    MT_OUTPUT_DIR: outputDir,
    MT_CATEGORY_NAMES: task.categoryName,
    MT_TASK_CURSOR_JSON: JSON.stringify(cursor),
    MT_EXPECTED_ITEMS: String(task.expectedItems || ""),
    MT_STOP_FILE: path.join(outputDir, `${captureId}.stop`),
    MT_RISK_RESUME_FILE: path.join(outputDir, `${captureId}.risk-resume.ok`),
    MT_DELAY_MIN_MS: String(config.nativeDelayMinMs),
    MT_DELAY_MAX_MS: String(config.nativeDelayMaxMs),
    MT_CATEGORY_REST_MIN_MS: String(config.nativeCategoryRestMinMs),
    MT_CATEGORY_REST_MAX_MS: String(config.nativeCategoryRestMaxMs),
    MT_RISK_SLEEP_MS: String(config.nativeRiskSleepMs),
    MT_DYNAMIC_CHUNK_MODE: config.nativeDynamicChunkMode,
    MT_ALLOW_PAGE_FALLBACK: config.nativeAllowPageFallback ? "true" : "false"
  };

  if (targetUrlPart) env.MT_TARGET_URL_PART = targetUrlPart;
  if (categoryTag) env.MT_CATEGORY_TAG = categoryTag;
  if (categoryI !== undefined) env.MT_CATEGORY_I = String(categoryI);
  if (categoryJ !== undefined) env.MT_CATEGORY_J = String(categoryJ);
  if (observedSmoothChunkSize !== undefined) {
    env.MT_OBSERVED_SMOOTH_CHUNK_SIZE = String(observedSmoothChunkSize);
  }
  return env;
}

export function buildNativeRunIdentity(
  runId: string,
  taskId: string,
  workerId: string,
  captureAttemptId?: string,
  resumeCaptureId?: string
): { runId: string; captureId: string } {
  const resumed = resumeCaptureId?.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (resumed) return { runId, captureId: resumed };
  const suffix = captureAttemptId?.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return { runId, captureId: [workerId, taskId, suffix].filter(Boolean).join("-") };
}

async function handleNativeLine(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  line: string,
  updateProgress: (event: any) => { collectedItems: number; latestCursor: Record<string, unknown> },
  markManualRequired?: (cursor: Record<string, unknown>) => void
): Promise<void> {
  console.log(`[native-collector:${task.taskId}] ${line}`);
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (["task_progress", "page0_done", "smooth_chunk_done", "category_done", "products_written"].includes(event.event)) {
    const next = updateProgress(event);
    await updateTask(config, task.taskId, {
      status: resolveNativeProgressStatus(event),
      collectedItems: next.collectedItems,
      cursor: next.latestCursor
    }).catch((error) => console.error(`[worker] failed to update native task progress: ${error.message}`));
    return;
  }

  if (event.event === "category_unavailable") {
    const next = updateProgress(event);
    await updateTask(config, task.taskId, {
      status: "skipped",
      collectedItems: next.collectedItems,
      lastError: event.reason || "category unavailable in current page runtime",
      cursor: mergeCursor(next.latestCursor, {
        skippedReason: event.reason,
        categoryTag: event.categoryTag,
        categoryI: event.categoryI,
        categoryJ: event.categoryJ
      })
    }).catch((error) => console.error(`[worker] failed to mark native task skipped: ${error.message}`));
    return;
  }

  if (["risk_pause", "request_error"].includes(event.event) && event.risk !== false) {
    const next = updateProgress(event);
    const riskCursor = mergeCursor(next.latestCursor, {
      lastRiskAt: new Date().toISOString(),
      resumeFile: event.resumeFile
    });
    markManualRequired?.(riskCursor);
    const screenshotArtifactId = await captureRiskScreenshot(config, task, account).catch((error) => {
      console.warn(`[worker] failed to capture risk screenshot: ${error.message}`);
      return undefined;
    });
    await updateTask(config, task.taskId, {
      status: "manual_required",
      collectedItems: next.collectedItems,
      lastError: event.err?.message || event.event,
      cursor: riskCursor
    }).catch((error) => console.error(`[worker] failed to mark native task manual_required: ${error.message}`));
    await createRiskEvent(config, {
      severity: inferSeverity(event),
      riskType: inferRiskType(event),
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      cdpPort: account.cdpPort,
      storeId: task.storeId,
      storeName: task.storeName,
      categoryName: task.categoryName,
      phase: "native-cdp-collector",
      screenshotArtifactId,
      observed: conciseObserved(event),
      recommendedAction: "人工查看该 CDP 页面；处理验证/登录后，在输出目录创建脚本给出的 risk-resume.ok 文件恢复。"
    }).catch((error) => console.error(`[worker] failed to create native risk event: ${error.message}`));
    return;
  }

  if (event.event === "risk_pause_resumed") {
    const next = updateProgress(event);
    await updateTask(config, task.taskId, {
      status: "running",
      cursor: mergeCursor(next.latestCursor, { resumedAt: new Date().toISOString() })
    }).catch((error) => console.error(`[worker] failed to resume native task: ${error.message}`));
  }
}

async function readNativeSummaryResult(summaryPath: string): Promise<{
  status?: string;
  error?: string;
  skippedReason?: string;
}> {
  if (!(await exists(summaryPath))) return {};
  try {
    const raw = await fs.readFile(summaryPath, "utf8");
    const summary = JSON.parse(raw) as { status?: string; error?: string; skippedReason?: string };
    const status = normalizeNativeSummaryStatus(summary.status);
    return {
      status,
      error: typeof summary.error === "string" ? summary.error : undefined,
      skippedReason: typeof summary.skippedReason === "string" ? summary.skippedReason : undefined
    };
  } catch {
    return {};
  }
}

export function normalizeNativeSummaryStatus(value: unknown): string | undefined {
  const statuses = new Set([
    "pending", "assigned", "running", "collecting", "captured", "uploading",
    "structuring", "validating", "paused", "manual_required", "completed",
    "completed_valid", "needs_review", "failed", "skipped", "incomplete"
  ]);
  return typeof value === "string" && statuses.has(value) ? value : undefined;
}

function inferSeverity(event: any) {
  const text = JSON.stringify(event);
  if (text.includes("403") || text.includes("418")) return "critical";
  return "high";
}

function inferRiskType(event: any) {
  const text = JSON.stringify(event);
  if (text.includes("418")) return "interface_418";
  if (text.includes("403")) return "interface_403";
  if (text.includes("登录")) return "login_required";
  if (text.includes("验证码") || text.includes("verify.meituan.com") || text.includes("yoda")) return "captcha";
  return "identity_check";
}

function conciseObserved(event: any): string {
  const parts = [
    event.label ? `label=${event.label}` : "",
    event.err?.message ? `message=${event.err.message}` : "",
    event.requestCount ? `request=${event.requestCount}` : "",
    event.resumeFile ? `resume=${event.resumeFile}` : ""
  ].filter(Boolean);
  return parts.join("; ").slice(0, 1000) || JSON.stringify(event).slice(0, 1000);
}

async function registerNativeQualityIfPresent(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  summaryPath: string,
  artifactId?: string
): Promise<void> {
  const qualityPath = await findQualityManifestPath(summaryPath).catch((error) => {
    console.warn(`[native-collector:${task.taskId}] failed to locate quality manifest: ${error.message}`);
    return undefined;
  });
  if (!qualityPath) return;

  await registerQualityManifest(config, qualityPath, {
    taskId: task.taskId,
    runId: task.runId,
    storeId: task.storeId,
    workerId: config.worker.workerId,
    accountId: account.accountId,
    profileId: account.profileId,
    artifactId
  }).catch((error) => {
    console.warn(`[native-collector:${task.taskId}] failed to register quality manifest: ${error.message}`);
  });
}

function mergeCursor(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...base, ...extra }).filter(([, value]) => value !== undefined)
  );
}

function isNativeProgressLineBeforeRun(line: string, startedAt: unknown): boolean {
  if (typeof startedAt !== "string") return false;
  const runStartedAt = Date.parse(startedAt);
  if (!Number.isFinite(runStartedAt)) return false;
  try {
    const event = JSON.parse(line) as { ts?: unknown };
    if (typeof event.ts !== "string") return false;
    const eventTs = Date.parse(event.ts);
    return Number.isFinite(eventTs) && eventTs < runStartedAt;
  } catch {
    return false;
  }
}

function prepareNativeRunCursor(
  cursor: Record<string, unknown> = {},
  captureId: string,
  outputDir: string
): Record<string, unknown> {
  const {
    completedAt,
    failedAt,
    skippedAt,
    manualRequiredPreservedAt,
    skippedReason,
    lastEvent,
    nativeProgressTs,
    percent,
    requestCount,
    totalRows,
    totalUniqueSpu,
    adaptiveObservedChunkSize,
    resumedAt,
    lastRiskAt,
    resumeFile,
    ...rest
  } = cursor;
  void completedAt;
  void failedAt;
  void skippedAt;
  void manualRequiredPreservedAt;
  void skippedReason;
  void lastEvent;
  void nativeProgressTs;
  void percent;
  void requestCount;
  void totalRows;
  void totalUniqueSpu;
  void adaptiveObservedChunkSize;
  void resumedAt;
  void lastRiskAt;
  void resumeFile;

  return mergeCursor(rest, {
    adapter: "native-cdp",
    captureId,
    startedAt: new Date().toISOString(),
    outputDir
  });
}

function pickCursorNumber(cursor: Record<string, unknown>, key: string): number | undefined {
  const value = cursor[key];
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

async function assertRequiredFile(file: string, label: string): Promise<void> {
  if (!(await exists(file))) throw new Error(`missing ${label}: ${file}`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
