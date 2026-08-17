import type { RiskEventPayload, RiskEventRecord } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { queueRiskEventNotification } from "../notifications.js";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { insertRiskEvent, listRiskClusters, listRiskEvents, updateRiskEventStatus } from "../repositories/risk-events.js";
import { operatorActor } from "./operation-events.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";

export function registerRiskEventRoutes(app: FastifyInstance, db: Pool, dashboardEvents: DashboardEventBus, dingtalkWebhookUrl?: string): void {
  app.get("/api/risk-events", async () => {
    return { riskEvents: await listRiskEvents(db) };
  });

  app.get("/api/risk-clusters", async () => {
    return { riskClusters: await listRiskClusters(db) };
  });

  app.post<{ Body: RiskEventPayload["event"] }>("/api/risk-events", async (request) => {
    const risk = await insertRiskEvent(db, {
      type: "worker.risk_event",
      sentAt: new Date().toISOString(),
      event: request.body
    });
    dashboardEvents.emit({ type: "risk.created", sentAt: new Date().toISOString(), risk });
    await queueRiskEventNotification(db, Boolean(dingtalkWebhookUrl), risk);
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
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: `risk.${request.body.status}`,
        targetType: "risk",
        targetId: risk.riskId,
        riskId: risk.riskId,
        workerId: risk.workerId,
        accountId: risk.accountId,
        profileId: risk.profileId,
        storeId: risk.storeId,
        detail: {
          riskType: risk.riskType,
          severity: risk.severity,
          status: risk.status
        }
      });
      return { risk };
    }
  );
}
