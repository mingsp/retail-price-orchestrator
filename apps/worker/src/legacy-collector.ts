import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AccountSnapshot, CategoryTaskRecord } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { createRiskEvent, presignArtifact, registerArtifact, setTaskStatus, updateTask } from "./master-api.js";

interface LegacyRunContext {
  config: WorkerConfig;
  task: CategoryTaskRecord;
  account: AccountSnapshot;
}

export async function runLegacyCollector({ config, task, account }: LegacyRunContext): Promise<void> {
  const scriptRoot = path.resolve(process.cwd(), config.legacyScriptRoot);
  const scriptPath = path.join(scriptRoot, config.legacyScriptName);
  const captureDate = shanghaiDate();
  const runId = `${config.worker.workerId}-${task.taskId}`;
  const outputFiles = {
    results: path.join(scriptRoot, `meituan-v4-receiver-results-${captureDate}.jsonl`),
    status: path.join(scriptRoot, `meituan-v4-receiver-status-${captureDate}.jsonl`),
    natural: path.join(scriptRoot, `meituan-natural-responses-${captureDate}.jsonl`),
    riskLog: path.join(scriptRoot, `meituan-category-capture-risk-log-${captureDate}.md`)
  };

  await assertRequiredFile(scriptPath, "legacy collector script");
  await assertRequiredFile(outputFiles.natural, "natural request source");
  if (config.categoryPlanFile) {
    await assertRequiredFile(path.resolve(scriptRoot, config.categoryPlanFile), "category plan");
  }

  await setTaskStatus(config, task.taskId, "running", {
    assignedWorkerId: config.worker.workerId,
    assignedAccountId: account.accountId,
    assignedProfileId: account.profileId,
    cursor: { adapter: "legacy-cdp", runId, startedAt: new Date().toISOString() }
  });

  const env = buildLegacyEnv(config, task, account, runId, captureDate);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: scriptRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let collectedItems = task.collectedItems || 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      void handleCollectorLine(config, task, account, line, (delta) => {
        collectedItems += delta;
        return collectedItems;
      });
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    console.error(`[collector:${task.taskId}] ${chunk.trim()}`);
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  if (exitCode === 0) {
    await updateTask(config, task.taskId, {
      status: "completed",
      collectedItems,
      cursor: { adapter: "legacy-cdp", runId, completedAt: new Date().toISOString() }
    });
  } else {
    await updateTask(config, task.taskId, {
      status: "failed",
      collectedItems,
      lastError: `legacy collector exited with code ${exitCode}`,
      cursor: { adapter: "legacy-cdp", runId, failedAt: new Date().toISOString() }
    });
  }

  await uploadArtifacts(config, task, account, runId, outputFiles);
}

function buildLegacyEnv(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  runId: string,
  captureDate: string
): Record<string, string> {
  const cursor = task.cursor || {};
  const categoryTag = typeof cursor.categoryTag === "string" ? cursor.categoryTag : "";
  const env: Record<string, string> = {
    MT_RUN_ID: runId,
    MT_CAPTURE_DATE: captureDate,
    MT_CDP_PORT: String(account.cdpPort),
    MT_ACCOUNT_LABEL: account.displayName,
    MT_CATEGORY_NAMES: task.categoryName,
    MT_CATEGORY_TAGS: categoryTag,
    MT_STOP_FILE: `${runId}.stop`,
    MT_RISK_RESUME_FILE: `${runId}.risk-resume.ok`
  };
  if (config.categoryPlanFile) env.MT_CATEGORY_PLAN_FILE = config.categoryPlanFile;
  return env;
}

async function handleCollectorLine(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  line: string,
  addCollectedItems: (delta: number) => number
): Promise<void> {
  console.log(`[collector:${task.taskId}] ${line}`);
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.event === "captured_product_response") {
    const count = Number(event.listCount || 0);
    const collectedItems = count > 0 ? addCollectedItems(count) : task.collectedItems;
    await updateTask(config, task.taskId, {
      status: "running",
      collectedItems,
      cursor: { lastEvent: event.event, pageIndex: event.pageIndex, updatedAt: new Date().toISOString() }
    }).catch((error) => console.error(`[worker] failed to update task progress: ${error.message}`));
    return;
  }

  if (["risk_pause", "risk_pause_waiting", "inpage_response_risk"].includes(event.event)) {
    await updateTask(config, task.taskId, {
      status: "manual_required",
      lastError: event.reason || event.event,
      cursor: { lastEvent: event.event, updatedAt: new Date().toISOString() }
    }).catch((error) => console.error(`[worker] failed to mark manual_required: ${error.message}`));
    await createRiskEvent(config, {
      severity: "high",
      riskType: inferRiskType(event),
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      cdpPort: account.cdpPort,
      storeId: task.storeId,
      storeName: task.storeName,
      categoryName: task.categoryName,
      phase: "legacy-collector",
      observed: JSON.stringify(event).slice(0, 1000),
      recommendedAction: "人工检查当前 CDP 页面；如验证码/登录/身份核实，处理后创建脚本提示的 resume 文件。"
    }).catch((error) => console.error(`[worker] failed to create risk event: ${error.message}`));
    return;
  }

  if (event.event === "risk_pause_resumed") {
    await updateTask(config, task.taskId, {
      status: "running",
      cursor: { lastEvent: event.event, resumedAt: new Date().toISOString() }
    }).catch((error) => console.error(`[worker] failed to mark running: ${error.message}`));
  }
}

function inferRiskType(event: any) {
  const text = JSON.stringify(event);
  if (text.includes("418")) return "interface_418";
  if (text.includes("403")) return "interface_403";
  if (text.includes("登录")) return "login_required";
  if (text.includes("验证码") || text.includes("verify.meituan.com") || text.includes("yoda")) return "captcha";
  return "identity_check";
}

async function uploadArtifacts(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot,
  runId: string,
  files: Record<string, string>
): Promise<void> {
  for (const [kind, file] of Object.entries(files)) {
    if (!(await exists(file))) continue;
    const stat = await fs.stat(file);
    const buffer = await fs.readFile(file);
    const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
    const objectKind = kind === "results" || kind === "natural" ? "raw_jsonl" : kind === "status" ? "log" : "log";
    const objectKey = [
      task.storeId,
      task.runId,
      task.taskId,
      `${runId}-${path.basename(file)}`
    ].join("/");
    const presign = await presignArtifact(config, config.artifactBucket, objectKey);
    const response = await fetch(presign.url, {
      method: "PUT",
      body: buffer
    });
    if (!response.ok) throw new Error(`artifact upload failed ${response.status}: ${objectKey}`);
    await registerArtifact(config, {
      taskId: task.taskId,
      runId: task.runId,
      storeId: task.storeId,
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      kind: objectKind,
      bucket: config.artifactBucket,
      objectKey,
      contentType: file.endsWith(".jsonl") ? "application/jsonl" : "text/plain",
      sizeBytes: stat.size,
      checksumSha256,
      metadata: { adapter: "legacy-cdp", sourceFile: file }
    });
  }
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

function shanghaiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replaceAll("-", "");
}
