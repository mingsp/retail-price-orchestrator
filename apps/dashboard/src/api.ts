import type {
  AccountRegistryRow,
  ArtifactRecord,
  CategoryTaskRecord,
  DashboardMessage,
  ProfileRegistryRow,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
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

export function connectDashboard(onMessage: (message: DashboardMessage) => void): WebSocket {
  const url = new URL("/ws/dashboard", apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.onmessage = (event) => onMessage(JSON.parse(event.data) as DashboardMessage);
  return ws;
}
