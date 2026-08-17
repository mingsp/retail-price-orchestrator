import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { listRiskEvents } from "../repositories/risk-events.js";
import { buildProductionReadinessReport } from "../repositories/production-readiness.js";
import { listRuns, listStores, listTasks } from "../repositories/tasks.js";
import { listWorkers } from "../repositories/workers.js";

export function registerProductionReadinessRoutes(
  app: FastifyInstance,
  db: Pool,
  workerSharedToken: string,
  dingtalkNotificationConfigured: boolean
): void {
  app.get<{
    Querystring: {
      expectedWorkerIds?: string;
      expectedAccountCount?: string;
      expectedCdpCount?: string;
      minimumWorkerVersion?: string;
    };
  }>("/api/production-readiness", async (request) => {
    const [workers, stores, runs, tasks, risks] = await Promise.all([
      listWorkers(db),
      listStores(db),
      listRuns(db),
      listTasks(db),
      listRiskEvents(db)
    ]);
    return {
      report: buildProductionReadinessReport({
        workers,
        stores,
        runs,
        tasks,
        risks,
        workerSharedTokenIsDefault: !workerSharedToken || workerSharedToken === "change-me",
        dingtalkNotificationConfigured,
        options: {
          expectedWorkerIds: parseCsv(request.query.expectedWorkerIds),
          expectedAccountCount: parseOptionalInt(request.query.expectedAccountCount),
          expectedCdpCount: parseOptionalInt(request.query.expectedCdpCount),
          minimumWorkerVersion: request.query.minimumWorkerVersion || undefined
        }
      })
    };
  });
}

function parseCsv(value?: string): string[] | undefined {
  const rows = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return rows.length ? rows : undefined;
}

function parseOptionalInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
