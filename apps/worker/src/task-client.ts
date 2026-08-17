import type { TaskClaimInput, TaskClaimResult } from "@retail-orchestrator/shared";
import http from "node:http";
import type { WorkerConfig } from "./config.js";
import { runLegacyCollector } from "./legacy-collector.js";
import { bindTaskLeaseGuard, claimTask, clearTaskLeaseGuard, renewTaskLease, updateTask } from "./master-api.js";
import { runNativeCollector } from "./native-collector.js";
import { auditPureCollectorProfile, readCdpEndpointSnapshot } from "./cdp-identity.js";
import { getExecutionRuntime } from "./execution-runtime.js";
import { readCdpRuntimeInventory } from "./cdp-runtime-state.js";

const activeTasksByEndpoint = new Map<string, string>();
const claimingEndpoints = new Set<string>();

export function startTaskPolling(config: WorkerConfig): void {
  if (!config.taskPollingEnabled) {
    console.log("[worker] task polling disabled");
    return;
  }
  if (!config.taskExecutionEnabled) {
    console.log("[worker] task polling requested, but task execution disabled; no tasks will be claimed");
    return;
  }

  console.log(`[worker] task polling and execution enabled: ${config.taskPollingIntervalMs}ms`);
  runPollingCycle(config);
  setInterval(() => {
    runPollingCycle(config);
  }, config.taskPollingIntervalMs);
}

function runPollingCycle(config: WorkerConfig): void {
  void pollOnce(config).catch((error) => {
    console.error(`[worker] task polling cycle failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function pollOnce(config: WorkerConfig): Promise<void> {
  const runtime = getExecutionRuntime();
  const pressure = runtime.snapshot().pressure;
  if (!pressure.acceptingNewCapture) {
    console.warn(`[worker] capture intake paused: ${pressure.reason || pressure.level}`);
    return;
  }
  const inventory = await readCdpRuntimeInventory(config);
  const accounts = inventory.accounts.filter(
    (candidate) =>
      ["safe", "running"].includes(candidate.status) &&
      candidate.profileStatus === "safe" &&
      !["high", "blocked"].includes(candidate.riskLevel)
  );
  if (!accounts.length) {
    console.log("[worker] no eligible account for task polling");
    return;
  }

  await Promise.all(accounts.map((account) => {
    const endpoint = inventory.cdpEndpoints.find((candidate) => candidate.accountId === account.accountId);
    const endpointKey = endpoint?.endpointId || `${config.worker.workerId}:${account.cdpPort}`;
    return runtime.capturePool.run(
      { key: endpointKey },
      () => pollAccountSlot(config, account, endpoint)
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (isExecutionPoolBackpressureError(message)) {
        console.log(`[worker] account slot busy ${account.accountId}: ${message.split(":", 1)[0]}`);
        return;
      }
      console.error(`[worker] account slot polling failed ${account.accountId}: ${message}`);
    });
  }));
}

export function isExecutionPoolBackpressureError(message: string): boolean {
  return message.startsWith("pool_key_already_scheduled") || message.startsWith("pool_queue_full");
}

async function pollAccountSlot(
  config: WorkerConfig,
  account: WorkerConfig["accounts"][number],
  endpoint: WorkerConfig["cdpEndpoints"][number] | undefined
): Promise<void> {
  const endpointKey = endpoint?.endpointId || `${config.worker.workerId}:${account.cdpPort}`;
  if (!acquireEndpointClaim(endpointKey)) {
    console.log(`[worker] endpoint already running: ${endpointKey} task=${activeTasksByEndpoint.get(endpointKey)}`);
    return;
  }
  let result: TaskClaimResult;
  try {
    if (endpoint && !(await isCdpEndpointReachable(endpoint.endpointUrl || `http://127.0.0.1:${endpoint.port}`))) {
      console.warn(`[worker] endpoint unreachable; skip claim: ${endpointKey}`);
      return;
    }

    if (endpoint && config.enforcePureCollectorProfile) {
      const profileAudit = await auditPureCollectorProfile(endpoint);
      if (!profileAudit.safe) {
        console.error(
          `[worker] pure collector profile rejected; skip claim: ${endpointKey} merchant_domains=${profileAudit.forbiddenDomains.join(",")}`
        );
        return;
      }
    }

    const observation = endpoint ? await readCdpEndpointSnapshot(endpoint) : undefined;
    if (!observation || observation.status !== "ready") {
      console.warn(`[worker] page not ready; skip claim: ${endpointKey} state=${observation?.status || "unknown"}`);
      return;
    }
    const observedLocation = readActualLocation(observation.lastSeenUrl);
    const claim: TaskClaimInput = {
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      cdpEndpointId: endpoint?.endpointId,
      observedPoiIdStr: readPoiIdStr(observation.lastSeenUrl),
      observedStoreName: observation.lastSeenTitle,
      observedActualLat: observedLocation.latitude,
      observedActualLng: observedLocation.longitude,
      observedPageState: observation.status
    };
    result = await claimTask(config, claim);
    if (result.task) activeTasksByEndpoint.set(endpointKey, result.task.taskId);
  } finally {
    claimingEndpoints.delete(endpointKey);
  }

  if (result.task) {
    bindTaskLeaseGuard(result.task.taskId, config.worker.workerId, result.task.leaseGeneration);
    const abortController = new AbortController();
    const stopLeaseRenewal = startLeaseRenewal(config, result.task.taskId, () => abortController.abort());
    console.log(
      `[worker] claimed task ${result.task.taskId} on ${endpointKey}: ${result.task.storeName || result.task.storeId} / ${result.task.categoryName}`
    );
    try {
      if (config.collectorAdapter === "native") {
        await runNativeCollector({ config, task: result.task, account, signal: abortController.signal });
      } else {
        await runLegacyCollector({ config, task: result.task, account, signal: abortController.signal });
      }
    } catch (error) {
      console.error(`[worker] task execution failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      stopLeaseRenewal();
      clearTaskLeaseGuard(result.task.taskId);
      activeTasksByEndpoint.delete(endpointKey);
    }
    return;
  }
  console.log(`[worker] no task claimed for ${endpointKey}: ${result.reason || "unknown"}`);
}

function readPoiIdStr(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).searchParams.get("poi_id_str") || undefined;
  } catch {
    return undefined;
  }
}

export function readActualLocation(url: string | undefined): {
  latitude?: number;
  longitude?: number;
} {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    const latitude = normalizeCoordinate(parsed.searchParams.get("actualLat"), 90);
    const longitude = normalizeCoordinate(parsed.searchParams.get("actualLng"), 180);
    return latitude === undefined || longitude === undefined ? {} : { latitude, longitude };
  } catch {
    return {};
  }
}

function normalizeCoordinate(value: string | null, maxAbsolute: number): number | undefined {
  if (!value) return undefined;
  let numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (Math.abs(numeric) > maxAbsolute) numeric /= 1_000_000;
  return Math.abs(numeric) <= maxAbsolute ? numeric : undefined;
}

export function acquireEndpointClaim(endpointKey: string): boolean {
  if (activeTasksByEndpoint.has(endpointKey) || claimingEndpoints.has(endpointKey)) return false;
  claimingEndpoints.add(endpointKey);
  return true;
}

export function releaseEndpointClaimForTest(endpointKey: string): void {
  claimingEndpoints.delete(endpointKey);
}

function startLeaseRenewal(config: WorkerConfig, taskId: string, onLeaseLost: () => void): () => void {
  const leaseMs = 10 * 60 * 1000;
  let consecutiveFailures = 0;
  const renew = () => {
    void renewTaskLease(config, taskId, Math.floor(leaseMs / 1000)).then(() => {
      consecutiveFailures = 0;
    }).catch((error) => {
      consecutiveFailures++;
      console.error(`[worker] failed to renew task lease ${taskId}: ${error.message}`);
      if (String(error.message).includes("409") || consecutiveFailures >= 3) onLeaseLost();
    });
  };
  renew();
  const interval = setInterval(renew, 2 * 60 * 1000);
  return () => clearInterval(interval);
}

function isCdpEndpointReachable(endpointUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL("/json/version", endpointUrl);
    const req = http.request(url, { method: "GET", timeout: 2_000 }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 400));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}
