import type {
  AccountStatus,
  ArtifactKind,
  ProfileStatus,
  RiskLevel,
  RunStatus,
  StoreStatus,
  TaskStatus,
  WorkerStatus
} from "./status.js";

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

export interface AccountRegistryRow extends AccountSnapshot {
  workerId: string;
  updatedAt: string;
}

export interface ProfileRegistryRow {
  profileId: string;
  workerId: string;
  accountId?: string;
  profilePath: string;
  cdpPort: number;
  status: ProfileStatus;
  riskCount: number;
  lastRiskAt?: string;
  updatedAt: string;
}

export type RiskEventRecord = RiskEventPayload["event"] & {
  riskId: string;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  resolvedAt?: string;
};

export interface AccountStatusUpdate {
  status?: AccountStatus;
  riskLevel?: RiskLevel;
  currentStoreId?: string | null;
  currentStoreName?: string | null;
  currentCategoryName?: string | null;
  lastVerifiedAt?: string | null;
  lastRiskAt?: string | null;
}

export interface ProfileStatusUpdate {
  status?: ProfileStatus;
  boundAccountId?: string | null;
  lastRiskAt?: string | null;
}

export interface StoreRecord {
  storeId: string;
  name: string;
  platform: "meituan_h5";
  poiIdStr?: string;
  url: string;
  city?: string;
  address?: string;
  status: StoreStatus;
  collectionPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StoreRunRecord {
  runId: string;
  storeId: string;
  storeName?: string;
  runLabel: string;
  status: RunStatus;
  strategy: "category_split" | "account_rotation";
  targetFinishAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTaskRecord {
  taskId: string;
  runId: string;
  storeId: string;
  storeName?: string;
  categoryName: string;
  categoryOrder: number;
  status: TaskStatus;
  priority: number;
  assignedWorkerId?: string;
  assignedAccountId?: string;
  assignedProfileId?: string;
  expectedItems?: number;
  collectedItems: number;
  cursor: Record<string, unknown>;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStoreInput {
  storeId: string;
  name: string;
  platform?: "meituan_h5";
  poiIdStr?: string;
  url: string;
  city?: string;
  address?: string;
  status?: StoreStatus;
  collectionPolicy?: Record<string, unknown>;
}

export interface CreateRunInput {
  storeId: string;
  runLabel: string;
  strategy?: "category_split" | "account_rotation";
  targetFinishAt?: string;
}

export interface CreateCategoryTaskInput {
  categoryName: string;
  categoryOrder?: number;
  priority?: number;
  expectedItems?: number;
}

export interface UpdateCategoryTaskInput {
  status?: TaskStatus;
  assignedWorkerId?: string | null;
  assignedAccountId?: string | null;
  assignedProfileId?: string | null;
  collectedItems?: number;
  cursor?: Record<string, unknown>;
  lastError?: string | null;
}

export interface TaskClaimInput {
  workerId: string;
  accountId: string;
  profileId: string;
}

export interface TaskClaimResult {
  task?: CategoryTaskRecord;
  reason?: "no_task" | "account_not_eligible" | "profile_not_eligible";
}

export interface ArtifactRecord {
  artifactId: string;
  taskId?: string;
  runId?: string;
  storeId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  kind: ArtifactKind;
  bucket: string;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  checksumSha256?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RegisterArtifactInput {
  taskId?: string;
  runId?: string;
  storeId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  kind: ArtifactKind;
  bucket: string;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  checksumSha256?: string;
  metadata?: Record<string, unknown>;
}

export interface PresignArtifactInput {
  bucket: string;
  objectKey: string;
  expiresSeconds?: number;
}

export interface PresignArtifactResult {
  url: string;
  expiresSeconds: number;
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
      risk: RiskEventRecord;
    };
