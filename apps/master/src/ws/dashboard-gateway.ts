import type { DashboardMessage } from "@retail-orchestrator/shared";
import type { WebSocket } from "ws";

const dashboardClients = new Set<WebSocket>();

export function addDashboardClient(socket: WebSocket): void {
  dashboardClients.add(socket);
  socket.on("close", () => dashboardClients.delete(socket));
  socket.on("error", () => dashboardClients.delete(socket));
}

export function broadcastDashboard(message: DashboardMessage): void {
  const payload = JSON.stringify(message);
  for (const client of dashboardClients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

