import type { RegisterPriceQualityInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { listPriceQuality, registerPriceQuality } from "../repositories/quality.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";
import { assertActiveTaskWriteLease } from "../repositories/task-write-guard.js";

export function registerQualityRoutes(app: FastifyInstance, db: Pool, dashboardEvents: DashboardEventBus): void {
  app.get<{ Querystring: { taskId?: string; runId?: string; storeId?: string } }>("/api/quality-checks", async (request) => {
    return { qualityChecks: await listPriceQuality(db, request.query) };
  });

  app.post<{ Body: RegisterPriceQualityInput }>("/api/quality-checks", async (request, reply) => {
    try {
      await assertActiveTaskWriteLease(db, request.body);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    const quality = await registerPriceQuality(db, request.body);
    dashboardEvents.emit({ type: "quality.created", sentAt: new Date().toISOString(), quality });
    return { quality };
  });
}
