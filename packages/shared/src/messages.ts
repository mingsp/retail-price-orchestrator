import type { AccountStatus, ProfileStatus, RiskLevel, WorkerStatus } from "./status.js";

export type WorkerCapability =
  | "chrome_cdp"
  | "local_artifacts"
  | "codex_operator"
  | "manual_verification"
  | "s3_upload";

export interface WorkerIdentity {
  workerId: string;
  machineLabel: string;
  hostname: string;
  os: string;
  agentVersion: string;
  status: WorkerStatus;
  networkMode: "direct" | "proxy" | "unknown";
  codexOperator: boolean;
  capabilities: WorkerCapability[];
}

export interface AccountSnapshot {
  accountId: string;
  displayName: string;
  maskedLogin?: string;
  status: AccountStatus;
  riskLevel: RiskLevel;
  profileId: string;
  profileStatus: ProfileStatus;
  profilePath: string;
  cdpPort: number;
  currentStoreId?: string;
  currentStoreName?: string;
  currentCategoryName?: string;
  lastVerifiedAt?: string;
  lastRiskAt?: string;
}

export interface WorkerHeartbeatPayload {
  type: "worker.heartbeat";
  sentAt: string;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
  latestLogSummary?: string;
}

export interface WorkerRegisterPayload {
  type: "worker.register";
  sentAt: string;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
}

export interface RiskEventPayload {
  type: "worker.risk_event";
  sentAt: string;
  event: {
    riskId?: string;
    severity: "low" | "medium" | "high" | "critical";
    riskType:
      | "captcha"
      | "identity_check"
      | "interface_403"
      | "interface_418"
      | "account_blocked"
      | "profile_risk"
      | "device_risk"
      | "login_required";
    workerId: string;
    accountId?: string;
    profileId?: string;
    cdpPort?: number;
    storeId?: string;
    storeName?: string;
    categoryName?: string;
    phase?: string;
    observed: string;
    recommendedAction: string;
  };
}

export type WorkerToMasterMessage =
  | WorkerRegisterPayload
  | WorkerHeartbeatPayload
  | RiskEventPayload;

export type MasterToWorkerMessage =
  | {
      type: "master.register_ack" | "master.heartbeat_ack";
      receivedAt: string;
      workerId: string;
    }
  | {
      type: "master.error";
      receivedAt: string;
      message: string;
    };

export interface WorkerStatusRow {
  worker: WorkerIdentity & {
    lastSeenAt: string;
    latestLogSummary?: string;
  };
  accounts: AccountSnapshot[];
}

export type DashboardMessage =
  | {
      type: "dashboard.snapshot";
      sentAt: string;
      workers: WorkerStatusRow[];
    }
  | {
      type: "worker.updated";
      sentAt: string;
      worker: WorkerStatusRow;
    }
  | {
      type: "risk.created";
      sentAt: string;
      risk: RiskEventPayload["event"];
    };

