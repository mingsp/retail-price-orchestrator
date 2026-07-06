import type {
  AccountRegistryRow,
  AccountStatusUpdate,
  ArtifactRecord,
  CategoryTaskRecord,
  DashboardMessage,
  ProfileRegistryRow,
  ProfileStatusUpdate,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  UpdateCategoryTaskInput,
  WorkerStatusRow
} from "@retail-orchestrator/shared";

const apiBase = import.meta.env.VITE_MASTER_BASE_URL || "http://127.0.0.1:17890";

export async function fetchWorkers(): Promise<WorkerStatusRow[]> {
  const response = await fetch(`${apiBase}/api/workers`);
  if (!response.ok) throw new Error(`failed to fetch workers: ${response.status}`);
  const data = (await response.json()) as { workers: WorkerStatusRow[] };
  return data.workers;
}

export async function fetchAccounts(): Promise<AccountRegistryRow[]> {
  const response = await fetch(`${apiBase}/api/accounts`);
  if (!response.ok) throw new Error(`failed to fetch accounts: ${response.status}`);
  const data = (await response.json()) as { accounts: AccountRegistryRow[] };
  return data.accounts;
}

export async function fetchProfiles(): Promise<ProfileRegistryRow[]> {
  const response = await fetch(`${apiBase}/api/profiles`);
  if (!response.ok) throw new Error(`failed to fetch profiles: ${response.status}`);
  const data = (await response.json()) as { profiles: ProfileRegistryRow[] };
  return data.profiles;
}

export async function fetchRiskEvents(): Promise<RiskEventRecord[]> {
  const response = await fetch(`${apiBase}/api/risk-events`);
  if (!response.ok) throw new Error(`failed to fetch risk events: ${response.status}`);
  const data = (await response.json()) as { riskEvents: RiskEventRecord[] };
  return data.riskEvents;
}

export async function fetchStores(): Promise<StoreRecord[]> {
  const response = await fetch(`${apiBase}/api/stores`);
  if (!response.ok) throw new Error(`failed to fetch stores: ${response.status}`);
  const data = (await response.json()) as { stores: StoreRecord[] };
  return data.stores;
}

export async function fetchRuns(): Promise<StoreRunRecord[]> {
  const response = await fetch(`${apiBase}/api/runs`);
  if (!response.ok) throw new Error(`failed to fetch runs: ${response.status}`);
  const data = (await response.json()) as { runs: StoreRunRecord[] };
  return data.runs;
}

export async function fetchTasks(): Promise<CategoryTaskRecord[]> {
  const response = await fetch(`${apiBase}/api/tasks`);
  if (!response.ok) throw new Error(`failed to fetch tasks: ${response.status}`);
  const data = (await response.json()) as { tasks: CategoryTaskRecord[] };
  return data.tasks;
}

export async function fetchArtifacts(): Promise<ArtifactRecord[]> {
  const response = await fetch(`${apiBase}/api/artifacts`);
  if (!response.ok) throw new Error(`failed to fetch artifacts: ${response.status}`);
  const data = (await response.json()) as { artifacts: ArtifactRecord[] };
  return data.artifacts;
}

export async function updateAccountStatus(accountId: string, update: AccountStatusUpdate): Promise<AccountRegistryRow> {
  const response = await fetch(`${apiBase}/api/accounts/${accountId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update account: ${response.status}`);
  const data = (await response.json()) as { account: AccountRegistryRow };
  return data.account;
}

export async function updateProfileStatus(profileId: string, update: ProfileStatusUpdate): Promise<ProfileRegistryRow> {
  const response = await fetch(`${apiBase}/api/profiles/${profileId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update profile: ${response.status}`);
  const data = (await response.json()) as { profile: ProfileRegistryRow };
  return data.profile;
}

export async function updateTask(taskId: string, update: UpdateCategoryTaskInput): Promise<CategoryTaskRecord> {
  const response = await fetch(`${apiBase}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) throw new Error(`failed to update task: ${response.status}`);
  const data = (await response.json()) as { task: CategoryTaskRecord };
  return data.task;
}

export async function updateRiskStatus(
  riskId: string,
  status: RiskEventRecord["status"]
): Promise<RiskEventRecord> {
  const response = await fetch(`${apiBase}/api/risk-events/${riskId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error(`failed to update risk: ${response.status}`);
  const data = (await response.json()) as { risk: RiskEventRecord };
  return data.risk;
}

export function connectDashboard(onMessage: (message: DashboardMessage) => void): WebSocket {
  const url = new URL("/ws/dashboard", apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.onmessage = (event) => onMessage(JSON.parse(event.data) as DashboardMessage);
  return ws;
}
