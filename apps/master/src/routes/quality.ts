import type { RegisterPriceQualityInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { listPriceQuality, registerPriceQuality } from "../repositories/quality.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";
import { assertActiveTaskWriteLease } from "../repositories/task-write-guard.js";
import { updateTask } from "../repositories/tasks.js";

export function registerQualityRoutes(app: FastifyInstance, db: Pool, dashboardEvents: DashboardEventBus): void {
  app.get<{ Querystring: { taskId?: string; runId?: string; storeId?: string } }>("/api/quality-checks", async (request) => {
    return { qualityChecks: await listPriceQuality(db, request.query) };
  });

  app.post<{ Body: RegisterPriceQualityInput }>("/api/quality-checks", async (request, reply) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const transaction = client as unknown as Pool;
      await assertActiveTaskWriteLease(transaction, request.body);
      const quality = await registerPriceQuality(transaction, request.body);
      const task = await updateTask(transaction, request.body.taskId!, {
        status: quality.completenessStatus === "pass" ? "completed_valid" : "needs_review",
        lastError: quality.completenessStatus === "pass"
          ? null
          : `master_quality_${quality.completenessStatus}`,
        expectedLeaseOwner: request.body.leaseOwner,
        expectedLeaseGeneration: request.body.leaseGeneration
      });
      if (!task) throw new Error("quality_task_transition_conflict");
      await client.query("COMMIT");
      dashboardEvents.emit({ type: "quality.created", sentAt: new Date().toISOString(), quality });
      return { quality };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
  });
}
