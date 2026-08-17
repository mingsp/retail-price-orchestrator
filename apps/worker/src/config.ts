import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AccountSnapshot, CdpEndpointSnapshot, WorkerIdentity } from "@retail-orchestrator/shared";
import type { PersistedWorkerIdentity } from "./worker-identity-store.js";

export interface WorkerConfig {
  runtimeRole: "core" | "cdp_helper";
  masterBaseUrl: string;
  workerToken: string;
  masterRequestTimeoutMs: number;
  heartbeatIntervalMs: number;
  taskPollingEnabled: boolean;
  taskExecutionEnabled: boolean;
  taskPollingIntervalMs: number;
  enforcePureCollectorProfile: boolean;
  cdpCommandPollingEnabled: boolean;
  cdpCommandPollingIntervalMs: number;
  chromeExecutable: string;
  chromeProfileRoot: string;
  cdpStateFile: string;
  collectorAdapter: "legacy" | "native";
  legacyScriptRoot: string;
  legacyScriptName: string;
  nativeScriptRoot: string;
  nativeScriptName: string;
  nativeOutputRoot: string;
  nativeDelayMinMs: number;
  nativeDelayMaxMs: number;
  nativeCategoryRestMinMs: number;
  nativeCategoryRestMaxMs: number;
  nativeRiskSleepMs: number;
  nativeDynamicChunkMode: "conservative" | "balanced" | "fast";
  nativeAllowPageFallback: boolean;
  captureConcurrency: number;
  captureQueueMax: number;
  productPipelineConcurrency: number;
  productPipelineQueueMax: number;
  memoryShrinkRatio: number;
  memoryStopRatio: number;
  eventLoopStopMs: number;
  categoryPlanFile?: string;
  artifactBucket: string;
  mutationSpoolFile: string;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
  cdpEndpoints: CdpEndpointSnapshot[];
}

const processStartedAt = new Date().toISOString();
const processBootId = randomUUID();
const packagedAgentVersion = readPackagedAgentVersion();

export function resolveWorkerAgentVersion(env: NodeJS.ProcessEnv = process.env): string {
  const version = env.WORKER_AGENT_VERSION?.trim() || packagedAgentVersion;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("worker_agent_version_invalid");
  }
  return version;
}

export function resolveWorkerMachineLabel(env: NodeJS.ProcessEnv, fallback: string): string {
  const encoded = env.WORKER_MACHINE_LABEL_BASE64?.trim();
  if (encoded) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new Error("worker_machine_label_base64_invalid");
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64")).trim();
      if (!decoded) throw new Error("empty");
      return decoded;
    } catch {
      throw new Error("worker_machine_label_base64_invalid");
    }
  }
  return env.WORKER_MACHINE_LABEL?.trim() || fallback;
}

export function loadConfig(identity: PersistedWorkerIdentity): WorkerConfig {
  const workerId = identity.workerId;
  const accounts = resolveConfiguredAccounts(process.env);
  const cdpEndpoints = parseCdpEndpoints(workerId, accounts);
  const execution = resolveExecutionPoolConfig(process.env, accounts.length);
  return {
    runtimeRole: process.env.WORKER_RUNTIME_ROLE === "cdp_helper" ? "cdp_helper" : "core",
    masterBaseUrl: identity.masterBaseUrl,
    workerToken: identity.workerToken,
    masterRequestTimeoutMs: Number(process.env.WORKER_MASTER_REQUEST_TIMEOUT_MS || 10_000),
    heartbeatIntervalMs: Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 10_000),
    taskPollingEnabled: (process.env.WORKER_ENABLE_TASK_POLLING || "false") === "true",
    taskExecutionEnabled: (process.env.WORKER_ENABLE_TASK_EXECUTION || "false") === "true",
    taskPollingIntervalMs: Number(process.env.WORKER_TASK_POLLING_INTERVAL_MS || 30_000),
    enforcePureCollectorProfile: (process.env.WORKER_ENFORCE_PURE_PROFILE || "true") !== "false",
    cdpCommandPollingEnabled: (process.env.WORKER_ENABLE_CDP_COMMANDS || "false") === "true",
    cdpCommandPollingIntervalMs: Number(process.env.WORKER_CDP_COMMAND_POLLING_INTERVAL_MS || 10_000),
    chromeExecutable: process.env.WORKER_CHROME_EXECUTABLE || defaultChromeExecutable(),
    chromeProfileRoot: process.env.WORKER_CHROME_PROFILE_ROOT || ".runtime/chrome-profiles",
    cdpStateFile: resolveCdpStateFile(process.env),
    collectorAdapter: parseCollectorAdapter(process.env.WORKER_COLLECTOR_ADAPTER || "legacy"),
    legacyScriptRoot: process.env.WORKER_LEGACY_SCRIPT_ROOT || "..",
    legacyScriptName: process.env.WORKER_LEGACY_SCRIPT_NAME || "mt-cdp-inpage-category-products.mjs",
    nativeScriptRoot: process.env.WORKER_NATIVE_SCRIPT_ROOT || "scripts",
    nativeScriptName: process.env.WORKER_NATIVE_SCRIPT_NAME || "native-cdp-store-capture.mjs",
    nativeOutputRoot: process.env.WORKER_NATIVE_OUTPUT_ROOT || ".runtime/native-capture",
    nativeDelayMinMs: Number(process.env.WORKER_NATIVE_DELAY_MIN_MS || 45_000),
    nativeDelayMaxMs: Number(process.env.WORKER_NATIVE_DELAY_MAX_MS || 120_000),
    nativeCategoryRestMinMs: Number(process.env.WORKER_NATIVE_CATEGORY_REST_MIN_MS || 90_000),
    nativeCategoryRestMaxMs: Number(process.env.WORKER_NATIVE_CATEGORY_REST_MAX_MS || 240_000),
    nativeRiskSleepMs: Number(process.env.WORKER_NATIVE_RISK_SLEEP_MS || 3_600_000),
    nativeDynamicChunkMode: parseNativeDynamicMode(process.env.WORKER_NATIVE_DYNAMIC_CHUNK_MODE || "balanced"),
    nativeAllowPageFallback: (process.env.WORKER_NATIVE_ALLOW_PAGE_FALLBACK || "false") === "true",
    ...execution,
    categoryPlanFile: process.env.WORKER_CATEGORY_PLAN_FILE || undefined,
    artifactBucket: process.env.WORKER_ARTIFACT_BUCKET || "raw-artifacts",
    mutationSpoolFile: process.env.WORKER_MUTATION_SPOOL_FILE || ".runtime/spool/master-mutations.jsonl",
    worker: {
      workerId,
      machineLabel: resolveWorkerMachineLabel(process.env, workerId),
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      agentVersion: resolveWorkerAgentVersion(),
      status: "online",
      networkMode: (process.env.WORKER_NETWORK_MODE as "direct" | "proxy" | "unknown") || "unknown",
      codexOperator: false,
      capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
      bootId: processBootId,
      startedAt: processStartedAt,
      currentIp: currentLanIp(),
      remoteDesktop: readRemoteDesktopConfig()
    },
    accounts,
    cdpEndpoints
  };
}

export function resolveCdpStateFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WORKER_CDP_STATE_FILE?.trim()) return env.WORKER_CDP_STATE_FILE.trim();
  const identityFile = env.WORKER_IDENTITY_FILE?.trim();
  return identityFile
    ? path.join(path.dirname(identityFile), "cdp-runtime-state.json")
    : path.resolve(".runtime/state/cdp-runtime-state.json");
}

export interface WorkerExecutionPoolConfig {
  captureConcurrency: number;
  captureQueueMax: number;
  productPipelineConcurrency: number;
  productPipelineQueueMax: number;
  memoryShrinkRatio: number;
  memoryStopRatio: number;
  eventLoopStopMs: number;
}

export function resolveExecutionPoolConfig(
  env: NodeJS.ProcessEnv = process.env,
  accountCount = 1
): WorkerExecutionPoolConfig {
  const defaultCaptureConcurrency = Math.max(1, Math.min(4, accountCount));
  const memoryShrinkRatio = boundedRatio(env.WORKER_MEMORY_SHRINK_RATIO, 0.96, "worker_memory_shrink_ratio_invalid");
  const memoryStopRatio = boundedRatio(env.WORKER_MEMORY_STOP_RATIO, 0.99, "worker_memory_stop_ratio_invalid");
  if (memoryShrinkRatio >= memoryStopRatio) throw new Error("worker_memory_threshold_order_invalid");
  return {
    captureConcurrency: boundedInteger(
      env.WORKER_CAPTURE_CONCURRENCY,
      defaultCaptureConcurrency,
      1,
      32,
      "worker_capture_concurrency_invalid"
    ),
    captureQueueMax: boundedInteger(
      env.WORKER_CAPTURE_QUEUE_MAX,
      Math.max(1, accountCount),
      0,
      128,
      "worker_capture_queue_max_invalid"
    ),
    productPipelineConcurrency: boundedInteger(
      env.WORKER_PRODUCT_PIPELINE_CONCURRENCY,
      1,
      1,
      8,
      "worker_product_pipeline_concurrency_invalid"
    ),
    productPipelineQueueMax: boundedInteger(
      env.WORKER_PRODUCT_PIPELINE_QUEUE_MAX,
      8,
      0,
      128,
      "worker_product_pipeline_queue_max_invalid"
    ),
    memoryShrinkRatio,
    memoryStopRatio,
    eventLoopStopMs: boundedInteger(
      env.WORKER_EVENT_LOOP_STOP_MS,
      100,
      10,
      5_000,
      "worker_event_loop_stop_ms_invalid"
    )
  };
}

function readPackagedAgentVersion(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(packageUrl, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("worker_package_version_missing");
  }
  return packageJson.version.trim();
}

function currentLanIp(): string | undefined {
  return selectWorkerIp(Object.values(os.networkInterfaces()).flatMap((addresses) => addresses || []));
}

export function selectWorkerIp(
  addresses: Array<{ family: string | number; internal: boolean; address: string }>
): string | undefined {
  const externalIpv4 = addresses.filter((address) =>
    (address.family === "IPv4" || address.family === 4) && !address.internal
  );
  return externalIpv4.find((address) => isPrivateIpv4(address.address))?.address
    || externalIpv4[0]?.address;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function readRemoteDesktopConfig(): WorkerIdentity["remoteDesktop"] {
  const provider = process.env.WORKER_REMOTE_DESKTOP_PROVIDER;
  const target = process.env.WORKER_REMOTE_DESKTOP_TARGET || undefined;
  return {
    provider: provider === "rustdesk" || provider === "rdp" || provider === "screen_sharing" ? provider : "none",
    target,
    status: provider && provider !== "none" && target ? "ready" : "unknown"
  };
}

function defaultChromeExecutable(): string {
  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : "",
      process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe` : "",
      process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe` : ""
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || "chrome.exe";
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return "google-chrome";
}

function parseCollectorAdapter(value: string): "legacy" | "native" {
  return value === "native" ? "native" : "legacy";
}

function parseNativeDynamicMode(value: string): "conservative" | "balanced" | "fast" {
  if (value === "conservative" || value === "fast") return value;
  return "balanced";
}

export function resolveConfiguredAccounts(env: NodeJS.ProcessEnv): AccountSnapshot[] {
  if (env.WORKER_ACCOUNTS_JSON_FILE) {
    return JSON.parse(readJsonConfigFile(env.WORKER_ACCOUNTS_JSON_FILE)) as AccountSnapshot[];
  }
  if (env.WORKER_ACCOUNTS_JSON) {
    return JSON.parse(env.WORKER_ACCOUNTS_JSON) as AccountSnapshot[];
  }
  return [];
}

function parseCdpEndpoints(workerId: string, accounts: AccountSnapshot[]): CdpEndpointSnapshot[] {
  if (process.env.WORKER_CDP_ENDPOINTS_JSON_FILE) {
    return JSON.parse(readJsonConfigFile(process.env.WORKER_CDP_ENDPOINTS_JSON_FILE)) as CdpEndpointSnapshot[];
  }
  if (process.env.WORKER_CDP_ENDPOINTS_JSON) {
    return JSON.parse(process.env.WORKER_CDP_ENDPOINTS_JSON) as CdpEndpointSnapshot[];
  }
  return accounts.map((account) => {
    const endpointUrl = account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`;
    let host = "127.0.0.1";
    try {
      host = new URL(endpointUrl).hostname;
    } catch {
      host = "127.0.0.1";
    }
    return {
      endpointId: `${workerId}:${account.cdpPort}`,
      workerId,
      host,
      port: account.cdpPort,
      endpointUrl,
      status: account.profileStatus === "profile_risk" ? "profile_risk" : "ready",
      profileId: account.profileId,
      accountId: account.accountId,
      accountDisplayName: account.displayName,
      maskedLogin: account.maskedLogin,
      targetStoreId: account.currentStoreId,
      targetStoreName: account.currentStoreName,
      currentCategoryName: account.currentCategoryName
    };
  });
}

function readJsonConfigFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  errorCode: string
): number {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(errorCode);
  return value;
}

function boundedRatio(raw: string | undefined, fallback: number, errorCode: string): number {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error(errorCode);
  return value;
}
