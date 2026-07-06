import os from "node:os";
import type { AccountSnapshot, WorkerIdentity } from "@retail-orchestrator/shared";

export interface WorkerConfig {
  masterBaseUrl: string;
  workerSharedToken: string;
  heartbeatIntervalMs: number;
  taskPollingEnabled: boolean;
  taskPollingIntervalMs: number;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
}

export function loadConfig(): WorkerConfig {
  const workerId = process.env.WORKER_ID || `${os.hostname()}-worker`;
  const accounts = parseAccounts(workerId);
  return {
    masterBaseUrl: process.env.MASTER_BASE_URL || "http://127.0.0.1:17890",
    workerSharedToken: process.env.WORKER_SHARED_TOKEN || "change-me",
    heartbeatIntervalMs: Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS || 10_000),
    taskPollingEnabled: (process.env.WORKER_ENABLE_TASK_POLLING || "false") === "true",
    taskPollingIntervalMs: Number(process.env.WORKER_TASK_POLLING_INTERVAL_MS || 30_000),
    worker: {
      workerId,
      machineLabel: process.env.WORKER_MACHINE_LABEL || workerId,
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      agentVersion: "0.1.0",
      status: "online",
      networkMode: (process.env.WORKER_NETWORK_MODE as "direct" | "proxy" | "unknown") || "unknown",
      codexOperator: (process.env.WORKER_CODEX_OPERATOR || "true") === "true",
      capabilities: ["chrome_cdp", "local_artifacts", "codex_operator", "manual_verification", "s3_upload"]
    },
    accounts
  };
}

function parseAccounts(workerId: string): AccountSnapshot[] {
  if (process.env.WORKER_ACCOUNTS_JSON) {
    return JSON.parse(process.env.WORKER_ACCOUNTS_JSON) as AccountSnapshot[];
  }
  return [
    {
      accountId: `${workerId}-account-01`,
      displayName: `${workerId} default account`,
      maskedLogin: "",
      status: "safe",
      riskLevel: "normal",
      profileId: `${workerId}-profile-01`,
      profileStatus: "safe",
      profilePath: "browser-profiles/account-01-safe",
      cdpPort: Number(process.env.WORKER_DEFAULT_CDP_PORT || 9223)
    }
  ];
}
