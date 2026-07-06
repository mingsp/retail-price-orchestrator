import type { RiskEventPayload, RiskEventRecord } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { notifyRiskEvent } from "../notifications.js";
import { insertRiskEvent, listRiskEvents, updateRiskEventStatus } from "../repositories/risk-events.js";
import { broadcastDashboard } from "../ws/dashboard-gateway.js";

export function registerRiskEventRoutes(app: FastifyInstance, db: Pool, dingtalkWebhookUrl?: string): void {
  app.get("/api/risk-events", async () => {
    return { riskEvents: await listRiskEvents(db) };
  });

  app.post<{ Body: RiskEventPayload["event"] }>("/api/risk-events", async (request) => {
    const risk = await insertRiskEvent(db, {
      type: "worker.risk_event",
      sentAt: new Date().toISOString(),
      event: request.body
    });
    broadcastDashboard({ type: "risk.created", sentAt: new Date().toISOString(), risk });
    notifyRiskEvent(dingtalkWebhookUrl, risk).catch((error) => {
      app.log.error({ error, riskId: risk.riskId }, "failed to send risk notification");
    });
    return { risk };
  });

  app.patch<{ Params: { riskId: string }; Body: { status: RiskEventRecord["status"] } }>(
    "/api/risk-events/:riskId/status",
    async (request, reply) => {
      if (!["open", "acknowledged", "resolved"].includes(request.body?.status)) {
        return reply.code(400).send({ error: "invalid_status" });
      }
      const risk = await updateRiskEventStatus(db, request.params.riskId, request.body.status);
      if (!risk) return reply.code(404).send({ error: "risk_event_not_found" });
      return { risk };
    }
  );
}
