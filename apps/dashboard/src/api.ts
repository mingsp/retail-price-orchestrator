import type {
  AccountRegistryRow,
  AccountPoolRecord,
  AccountStatusUpdate,
  ArtifactRecord,
  BindBrowserSlotInput,
  BrowserSlotRecord,
  CdpCommandRecord,
  CategoryTaskRecord,
  CreateCdpCommandInput,
  CreateBrowserSlotInput,
  CreateAccountPoolInput,
  CreateCategoryTaskInput,
  CreateRunInput,
  CreateStoreInput,
  DashboardMessage,
  OperationEventRecord,
  MigrateTaskInput,
  ProductDataQualityGate,
  PriceQualityRecord,
  ProductionReadinessReport,
  ProductSnapshotSummary,
  RiskClusterRecord,
  ProfileRegistryRow,
  ProfileStatusUpdate,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  TaskActionInput,
  UpdateCategoryTaskInput,
  UpdateAccountPoolInput,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import type {
  BusinessActivityRecord,
  BusinessDeliveryRecord,
  BusinessIssueRecord,
  BusinessOverviewRecord,
  RunProgressRecord
} from "@retail-orchestrator/shared";
import type { BusinessRealtimeMessage } from "@retail-orchestrator/shared";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {};
const apiBase = viteEnv.DEV
  ? (viteEnv.VITE_MASTER_BASE_URL || "http://127.0.0.1:17890")
  : window.location.origin;
const requestTimeoutMs = Number(viteEnv.VITE_API_TIMEOUT_MS || 8_000);

export type DashboardConnectionState = "connecting" | "live" | "disconnected" | "ws-error";

export interface RealtimeConnection {
  close(): void;
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let lastError: unknown;
  const headers = new Headers(init.headers);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(input, { ...init, headers, signal: controller.signal });
      if (response.status >= 500 && attempt + 1 < attempts) {
        await delay(250 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await delay(250 * (attempt + 1));
    } finally {
      window.clearTimeout(timer);
    }
  }

  const reason = lastError instanceof DOMException && lastError.name === "AbortError" ? "请求超时" : "网络连接异常";
  throw new Error(`采集数据暂时无法同步：${reason}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(`${apiBase}${path}`);
  if (!response.ok) throw new Error(`请求失败: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchBusinessOverview(date?: string): Promise<BusinessOverviewRecord> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return (await getJson<{ overview: BusinessOverviewRecord }>(`/api/business/v1/overview${query}`)).overview;
}

export async function fetchBusinessRuns(): Promise<RunProgressRecord[]> {
  return (await getJson<{ runs: RunProgressRecord[] }>("/api/business/v1/runs")).runs;
}

export async function fetchBusinessActivities(limit = 30): Promise<BusinessActivityRecord[]> {
  return (await getJson<{ activities: BusinessActivityRecord[] }>(`/api/business/v1/activities?limit=${limit}`)).activities;
}

export async function fetchBusinessIssues(limit = 30): Promise<BusinessIssueRecord[]> {
  return (await getJson<{ issues: BusinessIssueRecord[] }>(`/api/business/v1/issues?limit=${limit}`)).issues;
}

export async function fetchBusinessDeliveries(): Promise<BusinessDeliveryRecord[]> {
  return (await getJson<{ deliveries: BusinessDeliveryRecord[] }>("/api/business/v1/deliveries")).deliveries;
}

export async function prepareBusinessDelivery(runId: string): Promise<{ url: string }> {
  const freeze = await apiFetch(`${apiBase}/api/deliveries/${runId}/freeze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minUserFinalPriceCoverage: 0 })
  });
  if (!freeze.ok) throw new Error(`数据尚未达到交付条件: ${freeze.status}`);
  const exported = await apiFetch(`${apiBase}/api/deliveries/${runId}/export`, { method: "POST" });
  if (!exported.ok) throw new Error(`业务文件生成失败: ${exported.status}`);
  return exported.json() as Promise<{ url: string }>;
}

export async function getBusinessDeliveryDownload(runId: string): Promise<string> {
  const data = await getJson<{ url: string }>(`/api/deliveries/${runId}/download`);
  return data.url;
}

export async function fetchWorkers(): Promise<WorkerStatusRow[]> {
  const response = await apiFetch(`${apiBase}/api/workers`);
  if (!response.ok) throw new Error(`failed to fetch workers: ${response.status}`);
  const data = (await response.json()) as { workers: WorkerStatusRow[] };
  return data.workers;
}

export async function fetchBrowserSlots(): Promise<BrowserSlotRecord[]> {
  return (await getJson<{ slots: BrowserSlotRecord[] }>("/api/browser-slots")).slots;
}

export async function createBrowserSlot(input: CreateBrowserSlotInput): Promise<BrowserSlotRecord> {
  const response = await apiFetch(`${apiBase}/api/browser-slots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`创建浏览器席位失败: ${response.status}`);
  return ((await response.json()) as { slot: BrowserSlotRecord }).slot;
}

export async function bindBrowserSlot(slotId: string, input: BindBrowserSlotInput): Promise<BrowserSlotRecord> {
  const response = await apiFetch(`${apiBase}/api/browser-slots/${slotId}/bind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`绑定浏览器席位失败: ${response.status}`);
  return ((await response.json()) as { slot: BrowserSlotRecord }).slot;
}

export async function migrateTask(taskId: string, input: MigrateTaskInput): Promise<CategoryTaskRecord> {
  const response = await apiFetch(`${apiBase}/api/tasks/${taskId}/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`任务切换失败: ${response.status}`);
  return ((await response.json()) as { task: CategoryTaskRecord }).task;
}

export async function fetchAccounts(): Promise<AccountRegistryRow[]> {
  const response = await apiFetch(`${apiBase}/api/accounts`);
  if (!response.ok) throw new Error(`failed to fetch accounts: ${response.status}`);
  const data = (await response.json()) as { accounts: AccountRegistryRow[] };
  return data.accounts;
}

export async function fetchAccountPool(): Promise<AccountPoolRecord[]> {
  return (await getJson<{ accounts: AccountPoolRecord[] }>("/api/account-pool")).accounts;
}

export async function createAccountPool(input: CreateAccountPoolInput): Promise<AccountPoolRecord> {
  const response = await apiFetch(`${apiBase}/api/account-pool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`账号登记失败: ${response.status}`);
  return ((await response.json()) as { account: AccountPoolRecord }).account;
}

export async function updateAccountPool(accountId: string, input: UpdateAccountPoolInput): Promise<AccountPoolRecord> {
  const response = await apiFetch(`${apiBase}/api/account-pool/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`账号状态更新失败: ${response.status}`);
  return ((await response.json()) as { account: AccountPoolRecord }).account;
}

export async function fetchProfiles(): Promise<ProfileRegistryRow[]> {
  const response = await apiFetch(`${apiBase}/api/profiles`);
  if (!response.ok) throw new Error(`failed to fetch profiles: ${response.status}`);
  const data = (await response.json()) as { profiles: ProfileRegistryRow[] };
  return data.profiles;
}

export async function fetchRiskEvents(): Promise<RiskEventRecord[]> {
  const response = await apiFetch(`${apiBase}/api/risk-events`);
  if (!response.ok) throw new Error(`failed to fetch risk events: ${response.status}`);
  const data = (await response.json()) as { riskEvents: RiskEventRecord[] };
  return data.riskEvents;
}

export async function fetchRiskClusters(): Promise<RiskClusterRecord[]> {
  const response = await apiFetch(`${apiBase}/api/risk-clusters`);
  if (!response.ok) throw new Error(`failed to fetch risk clusters: ${response.status}`);
  const data = (await response.json()) as { riskClusters: RiskClusterRecord[] };
  return data.riskClusters;
}

export async function fetchStores(): Promise<StoreRecord[]> {
  const response = await apiFetch(`${apiBase}/api/stores`);
  if (!response.ok) throw new Error(`failed to fetch stores: ${response.status}`);
  const data = (await response.json()) as { stores: StoreRecord[] };
  return data.stores;
}

export async function createStore(input: CreateStoreInput): Promise<StoreRecord> {
  const response = await apiFetch(`${apiBase}/api/stores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`failed to create store: ${response.status}`);
  const data = (await response.json()) as { store: StoreRecord };
  return data.store;
}

export async function fetchRuns(): Promise<StoreRunRecord[]> {
  const response = await apiFetch(`${apiBase}/api/runs`);
  if (!response.ok) throw new Error(`failed to fetch runs: ${response.status}`);
  const data = (await response.json()) as { runs: StoreRunRecord[] };
  return data.runs;
}

export async function createRun(input: CreateRunInput): Promise<StoreRunRecord> {
  const response = await apiFetch(`${apiBase}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`failed to create run: ${response.status}`);
  const data = (await response.json()) as { run: StoreRunRecord };
  return data.run;
}

export async function fetchTasks(): Promise<CategoryTaskRecord[]> {
  const response = await apiFetch(`${apiBase}/api/tasks`);
  if (!response.ok) throw new Error(`failed to fetch tasks: ${response.status}`);
  const data = (await response.json()) as { tasks: CategoryTaskRecord[] };
  return data.tasks;
}

export async function createCategoryTasks(runId: string, tasks: CreateCategoryTaskInput[]): Promise<CategoryTaskRecord[]> {
  const response = await apiFetch(`${apiBase}/api/runs/${runId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks })
  });
  if (!response.ok) throw new Error(`failed to create category tasks: ${response.status}`);
  const data = (await response.json()) as { tasks: CategoryTaskRecord[] };
  return data.tasks;
}

export async function fetchArtifacts(): Promise<ArtifactRecord[]> {
  const response = await apiFetch(`${apiBase}/api/artifacts`);
  if (!response.ok) throw new Error(`failed to fetch artifacts: ${response.status}`);
  const data = (await response.json()) as { artifacts: ArtifactRecord[] };
  return data.artifacts;
}

export async function fetchArtifactContent(artifactId: string): Promise<Blob> {
  const response = await apiFetch(`${apiBase}/api/artifacts/${encodeURIComponent(artifactId)}/content`);
  if (!response.ok) throw new Error(`异常现场暂时无法读取: ${response.status}`);
  return response.blob();
}

export async function fetchQualityChecks(): Promise<PriceQualityRecord[]> {
  const response = await apiFetch(`${apiBase}/api/quality-checks`);
  if (!response.ok) throw new Error(`failed to fetch quality checks: ${response.status}`);
  const data = (await response.json()) as { qualityChecks: PriceQualityRecord[] };
  return data.qualityChecks;
}

export async function fetchOperationEvents(): Promise<OperationEventRecord[]> {
  const response = await apiFetch(`${apiBase}/api/operation-events?limit=200`);
  if (!response.ok) throw new Error(`failed to fetch operation events: ${response.status}`);
  const data = (await response.json()) as { operationEvents: OperationEventRecord[] };
  return data.operationEvents;
}

export async function fetchProductSnapshotSummary(filters: { runId?: string; taskId?: string; storeId?: string; scope?: "current_valid" } = {}): Promise<ProductSnapshotSummary> {
  const url = new URL(`${apiBase}/api/product-snapshots/summary`);
  for (const [key, value] of Object.entries(filters)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`failed to fetch product summary: ${response.status}`);
  const data = (await response.json()) as { summary: ProductSnapshotSummary };
  return data.summary;
}

export async function fetchProductDataQualityGate(filters: {
  runId?: string;
  taskId?: string;
  storeId?: string;
  scope?: "current_valid";
  minUserFinalPriceCoverage?: number;
} = {}): Promise<ProductDataQualityGate> {
  const url = new URL(`${apiBase}/api/product-snapshots/quality-gate`);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`failed to fetch product quality gate: ${response.status}`);
  const data = (await response.json()) as { qualityGate: ProductDataQualityGate };
  return data.qualityGate;
}

export async function fetchProductionReadiness(options: {
  expectedWorkerIds?: string[];
  expectedAccountCount?: number;
  expectedCdpCount?: number;
} = {}): Promise<ProductionReadinessReport> {
  const url = new URL(`${apiBase}/api/production-readiness`);
  if (options.expectedWorkerIds?.length) url.searchParams.set("expectedWorkerIds", options.expectedWorkerIds.join(","));
  if (options.expectedAccountCount !== undefined) url.searchParams.set("expectedAccountCount", String(options.expectedAccountCount));
  if (options.expectedCdpCount !== undefined) url.searchParams.set("expectedCdpCount", String(options.expectedCdpCount));
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`failed to fetch production readiness: ${response.status}`);
  const data = (await response.json()) as { report: ProductionReadinessReport };
  return data.report;
}

export async function createCdpCommand(input: CreateCdpCommandInput): Promise<CdpCommandRecord> {
  const response = await apiFetch(`${apiBase}/api/cdp-commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`failed to create cdp command: ${response.status}`);
  const data = (await response.json()) as { command: CdpCommandRecord };
  return data.command;
}

export async function updateAccountStatus(accountId: string, update: AccountStatusUpdate): Promise<AccountRegistryRow> {
  const response = await apiFetch(`${apiBase}/api/accounts/${accountId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update account: ${response.status}`);
  const data = (await response.json()) as { account: AccountRegistryRow };
  return data.account;
}

export async function updateProfileStatus(profileId: string, update: ProfileStatusUpdate): Promise<ProfileRegistryRow> {
  const response = await apiFetch(`${apiBase}/api/profiles/${profileId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update profile: ${response.status}`);
  const data = (await response.json()) as { profile: ProfileRegistryRow };
  return data.profile;
}

export async function updateTask(taskId: string, update: UpdateCategoryTaskInput): Promise<CategoryTaskRecord> {
  const response = await apiFetch(`${apiBase}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update task: ${response.status}`);
  const data = (await response.json()) as { task: CategoryTaskRecord };
  return data.task;
}

export async function triggerTaskAction(taskId: string, input: TaskActionInput): Promise<CategoryTaskRecord> {
  const response = await apiFetch(`${apiBase}/api/tasks/${taskId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(`failed to trigger task action: ${response.status}`);
  const data = (await response.json()) as { task: CategoryTaskRecord };
  return data.task;
}

export async function updateRiskStatus(
  riskId: string,
  status: RiskEventRecord["status"]
): Promise<RiskEventRecord> {
  const response = await apiFetch(`${apiBase}/api/risk-events/${riskId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error(`failed to update risk: ${response.status}`);
  const data = (await response.json()) as { risk: RiskEventRecord };
  return data.risk;
}

export function connectDashboard(
  onMessage: (message: DashboardMessage) => void,
  onState: (state: DashboardConnectionState) => void = () => undefined
): RealtimeConnection {
  return connectRealtime("/ws/dashboard", onMessage, onState);
}

export function connectBusiness(onMessage: (message: BusinessRealtimeMessage) => void): RealtimeConnection {
  return connectRealtime("/ws/business", onMessage, () => undefined);
}

function connectRealtime<T>(
  path: string,
  onMessage: (message: T) => void,
  onState: (state: DashboardConnectionState) => void
): RealtimeConnection {
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempt = 0;
  let closedByClient = false;

  const scheduleReconnect = () => {
    if (closedByClient || reconnectTimer !== undefined) return;
    const baseDelay = Math.min(15_000, 750 * 2 ** reconnectAttempt);
    const jitter = Math.round(baseDelay * 0.2 * Math.random());
    reconnectAttempt++;
    onState("connecting");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, baseDelay + jitter);
  };

  const connect = () => {
    if (closedByClient) return;
    onState("connecting");
    const url = new URL(path, apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url, buildOperatorWebSocketProtocols());
    socket.onopen = () => {
      reconnectAttempt = 0;
      onState("live");
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as T);
      } catch {
        onState("ws-error");
      }
    };
    socket.onerror = () => onState("ws-error");
    socket.onclose = () => {
      socket = undefined;
      if (closedByClient) return;
      onState("disconnected");
      scheduleReconnect();
    };
  };

  connect();
  return {
    close() {
      closedByClient = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    }
  };
}

export function buildOperatorWebSocketProtocols(): string[] {
  return ["retail-dashboard-v1"];
}
