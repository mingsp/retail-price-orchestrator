import type { WorkerConfig } from "./config.js";
import type { WorkerHeartbeatPayload, WorkerRegisterPayload } from "@retail-orchestrator/shared";

export function buildRegister(config: WorkerConfig): WorkerRegisterPayload {
  return {
    type: "worker.register",
    sentAt: new Date().toISOString(),
    worker: config.worker,
    accounts: config.accounts
  };
}

export function buildHeartbeat(config: WorkerConfig): WorkerHeartbeatPayload {
  return {
    type: "worker.heartbeat",
    sentAt: new Date().toISOString(),
    worker: config.worker,
    accounts: config.accounts,
    latestLogSummary: `heartbeat from ${config.worker.workerId}`
  };
}

