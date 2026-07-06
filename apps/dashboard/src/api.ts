import type { DashboardMessage, WorkerStatusRow } from "@retail-orchestrator/shared";

const apiBase = import.meta.env.VITE_MASTER_BASE_URL || "http://127.0.0.1:17890";

export async function fetchWorkers(): Promise<WorkerStatusRow[]> {
  const response = await fetch(`${apiBase}/api/workers`);
  if (!response.ok) throw new Error(`failed to fetch workers: ${response.status}`);
  const data = (await response.json()) as { workers: WorkerStatusRow[] };
  return data.workers;
}

export function connectDashboard(onMessage: (message: DashboardMessage) => void): WebSocket {
  const url = new URL("/ws/dashboard", apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.onmessage = (event) => onMessage(JSON.parse(event.data) as DashboardMessage);
  return ws;
}

