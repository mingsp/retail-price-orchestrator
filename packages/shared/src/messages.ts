import type {
  AccountStatus,
  AccountPoolStatus,
  ArtifactKind,
  CdpCommandAction,
  CdpCommandStatus,
  CdpEndpointStatus,
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

export interface RemoteDesktopSnapshot {
  provider: "rustdesk" | "rdp" | "screen_sharing" | "none";
  target?: string;
  status: "ready" | "unavailable" | "unknown";
}

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
  bootId?: string;
  startedAt?: string;
  currentIp?: string;
  diskFreeBytes?: number;
  clockOffsetMs?: number;
  remoteDesktop?: RemoteDesktopSnapshot;
}

export interface WorkerEnrollmentRequest {
  enrollmentToken: string;
  machineLabel: string;
  hostname: string;
  os: string;
  agentVersion: string;
  networkMode: "direct" | "proxy" | "unknown";
  capabilities: WorkerCapability[];
  remoteDesktop: RemoteDesktopSnapshot;
}

export interface WorkerEnrollmentResult {
  workerId: string;
  workerToken: string;
  masterBaseUrl: string;
  enrolledAt: string;
}

export interface CreateWorkerEnrollmentTokenInput {
  label: string;
  expiresInMinutes?: number;
  maxUses?: number;
}

export interface CreatedWorkerEnrollmentToken {
  tokenId: string;
  enrollmentToken: string;
  label: string;
  expiresAt: string;
  maxUses: number;
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
  cdpEndpoint?: string;
  currentStoreId?: string;
  currentStoreName?: string;
  currentCategoryName?: string;
  lastCollectedAt?: string;
  lastVerifiedAt?: string;
  lastRiskAt?: string;
}

export interface CdpEndpointSnapshot {
  slotId?: string;
  endpointId?: string;
  workerId?: string;
  host?: string;
  port: number;
  endpointUrl?: string;
  wsEndpoint?: string;
  status: CdpEndpointStatus;
  profileId?: string;
  accountId?: string;
  accountDisplayName?: string;
  maskedLogin?: string;
  operatorOwner?: string;
  targetStoreId?: string;
  targetStoreName?: string;
  currentCategoryName?: string;
  lastSeenUrl?: string;
  lastSeenTitle?: string;
  lastScreenshotArtifactId?: string;
  manualNote?: string;
}

export interface BrowserSlotRecord {
  slotId: string;
  workerId: string;
  label: string;
  port: number;
  status: CdpEndpointStatus;
  profileId?: string;
  accountId?: string;
  targetStoreId?: string;
  remoteDesktopTarget?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBrowserSlotInput {
  workerId: string;
  label: string;
  port: number;
  remoteDesktopTarget?: string;
}

export interface UpdateBrowserSlotInput {
  label?: string;
  port?: number;
  status?: CdpEndpointStatus;
  remoteDesktopTarget?: string | null;
}

export interface BindBrowserSlotInput {
  accountId: string;
  profileId: string;
  targetStoreId: string;
}

export interface WorkerHeartbeatPayload {
  type: "worker.heartbeat";
  sentAt: string;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
  cdpEndpoints?: CdpEndpointSnapshot[];
  latestLogSummary?: string;
  execution?: WorkerExecutionSnapshot;
}

export interface WorkerExecutionPoolSnapshot {
  name: string;
  concurrency: number;
  maxQueueSize: number;
  active: number;
  waiting: number;
  rejected: number;
  completed: number;
  failed: number;
  queueWaitMsP95: number;
}

export interface WorkerResourcePressureSnapshot {
  level: "L0" | "L1" | "L2" | "L3";
  memoryUsedRatio: number;
  eventLoopDelayMsP95: number;
  acceptingNewCapture: boolean;
  reason?: string;
}

export interface WorkerExecutionSnapshot {
  capture: WorkerExecutionPoolSnapshot;
  productPipeline: WorkerExecutionPoolSnapshot;
  pressure: WorkerResourcePressureSnapshot;
  observedAt: string;
}

export interface WorkerRegisterPayload {
  type: "worker.register";
  sentAt: string;
  worker: WorkerIdentity;
  accounts: AccountSnapshot[];
  cdpEndpoints?: CdpEndpointSnapshot[];
  execution?: WorkerExecutionSnapshot;
  latestLogSummary?: string;
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
      | "login_required"
      | "store_mismatch"
      | "store_location_mismatch";
    workerId: string;
    accountId?: string;
    profileId?: string;
    cdpPort?: number;
    storeId?: string;
    storeName?: string;
    categoryName?: string;
    phase?: string;
    screenshotArtifactId?: string;
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
  cdpEndpoints?: CdpEndpointRecord[];
  execution?: WorkerExecutionSnapshot;
}

export interface AccountRegistryRow extends AccountSnapshot {
  workerId: string;
  updatedAt: string;
}

export interface AccountPoolRecord {
  accountId: string;
  displayName: string;
  maskedLogin: string;
  operatorOwner: string;
  status: AccountPoolStatus;
  riskLevel: RiskLevel;
  note?: string;
  availableAfter?: string;
  assignedWorkerId?: string;
  assignedWorkerLabel?: string;
  currentStoreId?: string;
  currentStoreName?: string;
  currentCategoryName?: string;
  profileId?: string;
  cdpPort?: number;
  lastUsedAt?: string;
  useCount: number;
  riskCount: number;
  lastRiskAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountPoolInput {
  displayName: string;
  maskedLogin: string;
  operatorOwner: string;
  note?: string;
}

export interface UpdateAccountPoolInput {
  displayName?: string;
  maskedLogin?: string;
  operatorOwner?: string;
  status?: AccountPoolStatus;
  riskLevel?: RiskLevel;
  note?: string | null;
  availableAfter?: string | null;
}

export interface ProfileRegistryRow {
  profileId: string;
  workerId: string;
  accountId?: string;
  profilePath: string;
  cdpPort: number;
  cdpEndpoint?: string;
  status: ProfileStatus;
  riskCount: number;
  lastRiskAt?: string;
  updatedAt: string;
}

export interface CdpEndpointRecord extends CdpEndpointSnapshot {
  endpointId: string;
  workerId: string;
  host: string;
  endpointUrl: string;
  status: CdpEndpointStatus;
  lastSeenAt?: string;
  updatedAt: string;
}

export interface CreateCdpCommandInput {
  slotId?: string;
  workerId: string;
  action: CdpCommandAction;
  port: number;
  profileId: string;
  profilePath?: string;
  endpointId?: string;
  accountId?: string;
  accountDisplayName?: string;
  maskedLogin?: string;
  operatorOwner?: string;
  targetStoreId?: string;
  targetStoreName?: string;
  launchUrl?: string;
  chromeExecutable?: string;
  proxyMode?: "system" | "direct";
  note?: string;
}

export interface CdpCommandRecord extends CreateCdpCommandInput {
  commandId: string;
  status: CdpCommandStatus;
  claimedBy?: string;
  claimedAt?: string;
  claimUntil?: string;
  claimGeneration: number;
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimCdpCommandInput {
  workerId: string;
}

export interface CompleteCdpCommandInput {
  status: Extract<CdpCommandStatus, "completed" | "failed">;
  claimGeneration: number;
  endpoint?: CdpEndpointSnapshot;
  lastError?: string;
}

export type RiskEventRecord = RiskEventPayload["event"] & {
  riskId: string;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  resolvedAt?: string;
};

export interface RiskClusterRecord {
  clusterId: string;
  severity: "low" | "medium" | "high" | "critical";
  riskType: RiskEventRecord["riskType"];
  storeId?: string;
  storeName?: string;
  categoryName?: string;
  eventCount: number;
  openEventCount: number;
  affectedAccountCount: number;
  affectedAccounts: string[];
  affectedProfiles: string[];
  affectedWorkers: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  status: "watch" | "quarantine" | "resolved";
  recommendation: string;
  riskIds: string[];
}

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

export interface RunProgressRecord {
  runId: string;
  storeId: string;
  storeName?: string;
  runLabel: string;
  status: RunStatus;
  totalCategories: number;
  completedCategories: number;
  activeCategories: number;
  attentionCategories: number;
  categoryCompletionPercent: number;
  expectedItemsKnown: boolean;
  expectedItems?: number;
  collectedItems: number;
  itemProgressPercent?: number;
  validatedCategories: number;
  excludedCategories: number;
  isDeliverable: boolean;
  updatedAt: string;
}

export interface BusinessOverviewRecord {
  businessDate: string;
  targetRuns: number;
  activeRuns: number;
  completedRuns: number;
  openIssues: number;
  collectedProducts: number;
  availableCollectionSlots: number;
}

export interface BusinessActivityRecord {
  activityId: string;
  occurredAt: string;
  storeName: string;
  categoryName?: string;
  message: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface BusinessIssueRecord {
  issueId: string;
  occurredAt: string;
  storeName: string;
  categoryName?: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  actionLabel: string;
}

export interface BusinessDeliveryRecord {
  runId: string;
  storeName: string;
  runLabel: string;
  status: "collecting" | "checking" | "ready" | "attention";
  productCount: number;
  hasRawData: boolean;
  canExport: boolean;
  canPrepare: boolean;
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
  assignedCdpEndpointId?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  leaseGeneration: number;
  lastProgressAt?: string;
  missingSpuCount: number;
  checkpointArtifactId?: string;
  rawArtifactId?: string;
  summaryArtifactId?: string;
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

export interface StageStoreTarget {
  storeId: string;
  storeName: string;
  role: "competitor" | "own";
  pairId: string;
  weeklyCadence: "weekly";
  priority: number;
}

export interface GenerateRunPlanInput {
  runLabel: string;
  targetStores: StageStoreTarget[];
  accountBudget: number;
  accountsPerStore: number;
  spareAccounts: number;
}

export interface GenerateRunPlanResult {
  runIds: string[];
  accountPlan: Array<{
    storeId: string;
    requiredAccounts: number;
    spareAllowed: boolean;
  }>;
}

export interface CreateCategoryTaskInput {
  categoryName: string;
  categoryOrder?: number;
  priority?: number;
  expectedItems?: number;
  cursor?: Record<string, unknown>;
}

export interface UpdateCategoryTaskInput {
  status?: TaskStatus;
  assignedWorkerId?: string | null;
  assignedAccountId?: string | null;
  assignedProfileId?: string | null;
  assignedCdpEndpointId?: string | null;
  leaseOwner?: string | null;
  leaseUntil?: string | null;
  expectedLeaseOwner?: string;
  expectedLeaseGeneration?: number;
  lastProgressAt?: string | null;
  missingSpuCount?: number;
  checkpointArtifactId?: string | null;
  rawArtifactId?: string | null;
  summaryArtifactId?: string | null;
  collectedItems?: number;
  cursor?: Record<string, unknown>;
  lastError?: string | null;
}

export const taskOperatorActions = ["resume", "sleep_2h", "requeue", "mark_manual_required"] as const;
export type TaskOperatorAction = (typeof taskOperatorActions)[number];

export interface TaskActionInput {
  action: TaskOperatorAction;
}

export interface MigrateTaskInput {
  targetSlotId: string;
  reason?: string;
}

export interface TaskClaimInput {
  workerId: string;
  accountId: string;
  profileId: string;
  cdpEndpointId?: string;
  observedPoiIdStr?: string;
  observedStoreName?: string;
  observedActualLat?: number;
  observedActualLng?: number;
  observedPageState?: "ready" | "login_required" | "manual_required" | "unknown";
}

export interface TaskClaimResult {
  task?: CategoryTaskRecord;
  reason?: "no_task" | "account_not_eligible" | "profile_not_eligible" | "cdp_not_eligible" | "store_mismatch" | "location_not_confirmed" | "page_not_ready";
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
  storageVersionId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PriceQualityRecord {
  qualityId: string;
  runId?: string;
  taskId?: string;
  storeId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  artifactId?: string;
  rawRows: number;
  uniqueSpuCount: number;
  skuRows: number;
  frontDisplayPricePresent: number;
  skuFrontDisplayPricePresent: number;
  actualPriceInfoPresent: number;
  promotionInfoPresent: number;
  dynamicLabelPresent: number;
  duplicateSpuCount: number;
  completenessStatus: "pass" | "warn" | "fail";
  metadata: Record<string, unknown>;
  checkedAt: string;
}

export interface RegisterPriceQualityInput {
  runId?: string;
  taskId?: string;
  storeId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  artifactId?: string;
  rawRows: number;
  uniqueSpuCount: number;
  skuRows: number;
  frontDisplayPricePresent: number;
  skuFrontDisplayPricePresent: number;
  actualPriceInfoPresent?: number;
  promotionInfoPresent?: number;
  dynamicLabelPresent?: number;
  duplicateSpuCount?: number;
  completenessStatus: "pass" | "warn" | "fail";
  metadata?: Record<string, unknown>;
  leaseOwner?: string;
  leaseGeneration?: number;
}

export interface ProductSnapshotInput {
  runId: string;
  captureId?: string;
  taskId: string;
  storeId: string;
  storeName?: string;
  workerId?: string;
  accountId?: string;
  accountLabel?: string;
  profileId?: string;
  cdpEndpointId?: string;
  cdpPort?: number;
  source?: string;
  sourceTs?: string;
  categoryName: string;
  categoryDisplayName?: string;
  parentCategoryName?: string;
  categoryOrder?: number;
  categoryTag?: string;
  spuId: string;
  productName: string;
  minPrice?: number;
  originPriceText?: string;
  unit?: string;
  picture?: string;
  monthSaledContent?: string;
  promotionInfo?: string;
  frontDisplayPriceText?: string;
  frontDisplayPriceValue?: number;
  userFinalPriceText?: string;
  userFinalPriceValue?: number;
  priceSourcePath?: string;
  userFinalPriceSourcePath?: string;
  priceSemantics?: "front_display_only" | "actual_payable";
  raw: Record<string, unknown>;
}

export interface SkuSnapshotInput {
  runId: string;
  captureId?: string;
  taskId: string;
  storeId: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  cdpEndpointId?: string;
  sourceTs?: string;
  categoryName: string;
  spuId: string;
  skuId: string;
  productName: string;
  spec?: string;
  price?: number;
  originPrice?: number;
  stock?: number;
  status?: number;
  promotionInfo?: string;
  frontDisplayPriceText?: string;
  frontDisplayPriceValue?: number;
  userFinalPriceText?: string;
  userFinalPriceValue?: number;
  priceSourcePath?: string;
  userFinalPriceSourcePath?: string;
  priceSemantics?: "front_display_only" | "actual_payable";
  raw: Record<string, unknown>;
}

export interface ProductSnapshotBatchInput {
  artifactId?: string;
  writeWorkerId?: string;
  leaseOwner?: string;
  leaseGeneration?: number;
  products: ProductSnapshotInput[];
  skus: SkuSnapshotInput[];
}

export interface ProductSnapshotSummary {
  runId?: string;
  taskId?: string;
  storeId?: string;
  productCount: number;
  skuCount: number;
  rawEmbeddedSkuCount?: number;
  rawEvidencedSkuCount?: number;
  frontDisplayPriceCount: number;
  userFinalPriceCount: number;
  invalidUserFinalPriceCount?: number;
  latestSnapshotAt?: string;
}

export interface ProductDataQualityGate {
  runId?: string;
  taskId?: string;
  storeId?: string;
  status: "pass" | "fail";
  businessExportAllowed: boolean;
  minUserFinalPriceCoverage: number;
  totalSnapshotRows: number;
  productCount: number;
  skuCount: number;
  rawEmbeddedSkuCount?: number;
  rawEvidencedSkuCount?: number;
  skuReconciliationDelta?: number;
  frontDisplayPriceCount: number;
  frontDisplayPriceCoverage: number;
  missingFrontDisplayPriceCount: number;
  userFinalPriceCount: number;
  invalidUserFinalPriceCount: number;
  userFinalPriceCoverage: number;
  missingUserFinalPriceCount: number;
  latestSnapshotAt?: string;
  latestArtifactId?: string;
  latestArtifactObjectKey?: string;
  reason: string;
}

export interface RetailMartSyncRunInput {
  runId: string;
  dryRun?: boolean;
  minUserFinalPriceCoverage?: number;
}

export interface RetailMartSnapshotPreviewRow {
  storeId?: string;
  storeName?: string;
  categoryName?: string;
  spuId?: string;
  skuId?: string;
  productName?: string;
  frontDisplayPriceText?: string;
  userFinalPriceText?: string;
  promotionInfo?: string;
  sourceTs?: string;
  artifactId?: string;
  dataQuality: "pass" | "missing_user_final_price";
}

export interface RetailMartSyncDryRunResult {
  runId: string;
  dryRun: true;
  targetTable: "fact_store_sku_price_snapshot";
  targetTables: ["fact_store_spu_price_snapshot", "fact_store_sku_price_snapshot"];
  status: "ready" | "blocked";
  sourceRows: number;
  sourceSpuRows: number;
  sourceSkuRows: number;
  missingFieldStats: Record<string, number>;
  qualityGate: ProductDataQualityGate;
  sampleRows: RetailMartSnapshotPreviewRow[];
  errors: string[];
}

export interface RetailMartSyncCommitResult {
  runId: string;
  dryRun: false;
  targetTable: "fact_store_sku_price_snapshot";
  targetTables: ["fact_store_spu_price_snapshot", "fact_store_sku_price_snapshot"];
  status: "synced";
  sourceRows: number;
  sourceSpuRows: number;
  sourceSkuRows: number;
  upsertedRows: number;
  upsertedSpuRows: number;
  upsertedSkuRows: number;
  syncBatchId: string;
}

export interface DataDeliveryRecord {
  deliveryId: string;
  runId: string;
  version: number;
  status: "draft" | "frozen" | "exporting" | "ready" | "syncing" | "synced" | "failed";
  productCount: number;
  skuCount: number;
  userFinalPriceCoverage: number;
  rawArtifactCount: number;
  exportArtifactId?: string;
  lastError?: string;
  frozenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionErrorInput {
  errorKey: string;
  artifactId?: string;
  runId: string;
  taskId: string;
  storeId: string;
  lineNumber?: number;
  errorCode: string;
  errorMessage: string;
  rawExcerpt?: string;
  workerId?: string;
  leaseOwner?: string;
  leaseGeneration?: number;
}

export type ReadinessSeverity = "blocker" | "warning" | "info";
export type ReadinessStatus = "ready" | "warning" | "blocked";

export interface ProductionReadinessIssue {
  id: string;
  severity: ReadinessSeverity;
  area: "worker" | "account" | "profile" | "cdp" | "task" | "risk" | "store" | "data" | "system";
  title: string;
  detail: string;
  action: string;
  refs?: string[];
}

export interface ProductionReadinessReport {
  status: ReadinessStatus;
  generatedAt: string;
  summary: {
    workers: number;
    onlineWorkers: number;
    accounts: number;
    cdpEndpoints: number;
    activeRuns: number;
    openRisks: number;
    blockers: number;
    warnings: number;
  };
  issues: ProductionReadinessIssue[];
}

export interface OperationEventInput {
  actor?: string;
  action: string;
  targetType: string;
  targetId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  cdpEndpointId?: string;
  storeId?: string;
  taskId?: string;
  riskId?: string;
  detail?: Record<string, unknown>;
}

export interface OperationEventRecord extends Required<Pick<OperationEventInput, "action" | "targetType">> {
  eventId: string;
  actor: string;
  targetId?: string;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  cdpEndpointId?: string;
  storeId?: string;
  taskId?: string;
  riskId?: string;
  detail: Record<string, unknown>;
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
  leaseOwner?: string;
  leaseGeneration?: number;
}

export interface PresignArtifactInput {
  bucket: string;
  objectKey: string;
  expiresSeconds?: number;
  taskId: string;
  runId: string;
  storeId: string;
  workerId: string;
  accountId: string;
  profileId: string;
  leaseOwner: string;
  leaseGeneration: number;
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
    }
  | {
      type: "task.updated";
      sentAt: string;
      task: CategoryTaskRecord;
    }
  | {
      type: "artifact.created";
      sentAt: string;
      artifact: ArtifactRecord;
    }
  | {
      type: "quality.created";
      sentAt: string;
      quality: PriceQualityRecord;
    };

export interface BusinessRealtimeMessage {
  type: "business.refresh";
  sentAt: string;
  domains: Array<"overview" | "runs" | "activities" | "issues" | "deliveries">;
}
