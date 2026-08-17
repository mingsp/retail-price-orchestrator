import type { WorkerConfig } from "./config.js";
import type { WorkerHeartbeatPayload, WorkerRegisterPayload } from "@retail-orchestrator/shared";
import { readCdpIdentitySnapshots } from "./cdp-identity.js";
import fs from "node:fs/promises";
import { getExecutionRuntime } from "./execution-runtime.js";
import { applyEndpointHealthToAccounts, readCdpRuntimeInventory } from "./cdp-runtime-state.js";

export function buildRegister(config: WorkerConfig): WorkerRegisterPayload {
  return {
    type: "worker.register",
    sentAt: new Date().toISOString(),
    worker: config.worker,
    accounts: config.accounts,
    cdpEndpoints: config.cdpEndpoints
  };
}

export async function buildHeartbeat(config: WorkerConfig): Promise<WorkerHeartbeatPayload> {
  const worker = { ...config.worker, diskFreeBytes: await readDiskFreeBytes() };
  const execution = getExecutionRuntime().snapshot();
  const inventory = await readCdpRuntimeInventory(config);
  const cdpEndpoints = await readCdpIdentitySnapshots(config, inventory.cdpEndpoints);
  return {
    type: "worker.heartbeat",
    sentAt: new Date().toISOString(),
    worker,
    accounts: applyEndpointHealthToAccounts(inventory.accounts, cdpEndpoints),
    cdpEndpoints,
    execution,
    latestLogSummary: buildExecutionSummary(execution)
  };
}

export function buildExecutionSummary(execution: WorkerHeartbeatPayload["execution"]): string {
  if (!execution) return "设备状态待同步";
  const parts = [
    `正在采集 ${execution.capture.active} 项`,
    `等待 ${execution.capture.waiting} 项`,
    `数据处理中 ${execution.productPipeline.active} 项`
  ];
  if (execution.pressure.level !== "L0") parts.push("系统已自动降速");
  return parts.join("，");
}

async function readDiskFreeBytes(): Promise<number | undefined> {
  try {
    const stats = await fs.statfs(process.cwd());
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}
