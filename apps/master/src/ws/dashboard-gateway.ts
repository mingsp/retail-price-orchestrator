import type { BusinessRealtimeMessage, DashboardMessage } from "@retail-orchestrator/shared";
import type { WebSocket } from "ws";

const dashboardClients = new Set<WebSocket>();
const businessClients = new Set<WebSocket>();
const responsiveClients = new WeakSet<WebSocket>();

export function addDashboardClient(socket: WebSocket): void {
  dashboardClients.add(socket);
  registerLiveness(socket);
  socket.on("close", () => dashboardClients.delete(socket));
  socket.on("error", () => dashboardClients.delete(socket));
}

export function addBusinessClient(socket: WebSocket): void {
  businessClients.add(socket);
  registerLiveness(socket);
  socket.on("close", () => businessClients.delete(socket));
  socket.on("error", () => businessClients.delete(socket));
}

export function getDashboardGatewayMetrics(): { dashboardClients: number; businessClients: number } {
  return { dashboardClients: dashboardClients.size, businessClients: businessClients.size };
}

export function startDashboardGatewayHeartbeat(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    const clients = new Set([...dashboardClients, ...businessClients]);
    for (const client of clients) {
      if (!responsiveClients.has(client)) {
        dashboardClients.delete(client);
        businessClients.delete(client);
        client.terminate();
        continue;
      }
      responsiveClients.delete(client);
      client.ping();
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function registerLiveness(socket: WebSocket): void {
  responsiveClients.add(socket);
  socket.on("pong", () => responsiveClients.add(socket));
}

export function broadcastDashboard(message: DashboardMessage): void {
  const payload = JSON.stringify(message);
  for (const client of dashboardClients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
  const domains = businessDomains(message.type);
  if (!domains.length) return;
  const businessPayload = JSON.stringify({
    type: "business.refresh",
    sentAt: message.sentAt,
    domains
  } satisfies BusinessRealtimeMessage);
  for (const client of businessClients) {
    if (client.readyState === client.OPEN) client.send(businessPayload);
  }
}

function businessDomains(type: DashboardMessage["type"]): BusinessRealtimeMessage["domains"] {
  if (type === "task.updated") return ["overview", "runs", "activities", "deliveries"];
  if (type === "risk.created") return ["overview", "activities", "issues"];
  if (type === "artifact.created" || type === "quality.created") return ["overview", "runs", "deliveries"];
  return [];
}
