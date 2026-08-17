import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  getBusinessOverview,
  listBusinessActivities,
  listBusinessDeliveries,
  listBusinessIssues
} from "../repositories/business-views.js";
import { listRunProgress } from "../repositories/run-progress.js";

interface PageQuery { before?: string; limit?: string }

export function registerBusinessRoutes(app: FastifyInstance, db: Pool): void {
  app.get<{ Querystring: { date?: string } }>("/api/business/v1/overview", async (request) => ({
    overview: await getBusinessOverview(db, request.query.date || shanghaiDate())
  }));
  app.get("/api/business/v1/runs", async () => ({ runs: (await listRunProgress(db)).filter((run) => run.status !== "cancelled") }));
  app.get<{ Querystring: PageQuery }>("/api/business/v1/activities", async (request) => {
    const activities = await listBusinessActivities(db, pageOptions(request.query));
    return { activities, nextCursor: activities.at(-1)?.occurredAt };
  });
  app.get<{ Querystring: PageQuery }>("/api/business/v1/issues", async (request) => {
    const issues = await listBusinessIssues(db, pageOptions(request.query));
    return { issues, nextCursor: issues.at(-1)?.occurredAt };
  });
  app.get("/api/business/v1/deliveries", async () => ({ deliveries: await listBusinessDeliveries(db) }));
}

function pageOptions(query: PageQuery): { before?: string; limit?: number } {
  return { before: query.before, limit: query.limit ? Number(query.limit) : undefined };
}

function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}
