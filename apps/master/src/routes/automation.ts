import type { GenerateRunPlanInput, TaskOperatorAction } from "@retail-orchestrator/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { getAutomationAudit } from "../repositories/automation-audit.js";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { getRunProgress } from "../repositories/run-progress.js";
import { buildTaskActionUpdate } from "./task-actions.js";
import { createRun, getTask, listTasks, updateTaskWithRevokedLease } from "../repositories/tasks.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";

export function registerAutomationRoutes(
  app: FastifyInstance,
  db: Pool,
  dashboardEvents: DashboardEventBus,
  automationToken?: string
): void {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/automation/v1/")) return;
    if (!automationToken) return reply.code(503).send({ error: "automation_not_configured" });
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token !== automationToken) return reply.code(401).send({ error: "automation_unauthorized" });
  });

  app.get("/api/automation/v1/audit", async () => ({ audit: await getAutomationAudit(db) }));
  app.get<{ Params: { runId: string } }>("/api/automation/v1/runs/:runId/diagnostic", async (request, reply) => {
    const progress = await getRunProgress(db, request.params.runId);
    if (!progress) return reply.code(404).send({ error: "run_not_found" });
    return { progress, tasks: await listTasks(db, request.params.runId) };
  });
  app.get<{ Params: { workerId: string } }>("/api/automation/v1/workers/:workerId/active-tasks", async (request) => ({
    tasks: (await listTasks(db)).filter((task) =>
      task.assignedWorkerId === request.params.workerId
      && ["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"].includes(task.status)
    )
  }));

  app.post<{ Params: { taskId: string } }>("/api/automation/v1/tasks/:taskId/pause", async (request, reply) => {
    return automateTaskAction(db, dashboardEvents, request, reply, "sleep_2h");
  });
  app.post<{ Params: { taskId: string } }>("/api/automation/v1/tasks/:taskId/resume", async (request, reply) => {
    return automateTaskAction(db, dashboardEvents, request, reply, "resume");
  });

  app.post<{ Params: { workerId: string } }>("/api/automation/v1/workers/:workerId/diagnostic-bundle", async (request) => {
    const audit = await getAutomationAudit(db);
    const bundle = {
      generatedAt: audit.generatedAt,
      workerId: request.params.workerId,
      issues: audit.issues.filter((issue) => issue.workerId === request.params.workerId)
    };
    await insertOperationEvent(db, {
      actor: "codex_automation",
      action: "worker.diagnostic_bundle",
      targetType: "worker",
      targetId: request.params.workerId,
      workerId: request.params.workerId,
      detail: { issueCount: bundle.issues.length }
    });
    return { bundle };
  });

  app.post<{ Body: GenerateRunPlanInput }>("/api/automation/v1/weekly-runs/ensure", async (request, reply) => {
    const input = request.body;
    if (input.accountBudget < input.targetStores.length * input.accountsPerStore + input.spareAccounts) {
      return reply.code(400).send({ error: "account_budget_not_enough" });
    }
    const runIds: string[] = [];
    for (const target of input.targetStores) {
      const label = `${input.runLabel} / ${target.storeName}`;
      const existing = await db.query(`SELECT run_id FROM store_runs WHERE store_id = $1 AND run_label = $2 LIMIT 1`, [target.storeId, label]);
      if (existing.rows[0]) runIds.push(existing.rows[0].run_id);
      else runIds.push((await createRun(db, { storeId: target.storeId, runLabel: label, strategy: "category_split" })).runId);
    }
    await insertOperationEvent(db, {
      actor: "codex_automation",
      action: "weekly_runs.ensure",
      targetType: "run_plan",
      targetId: input.runLabel,
      detail: { runIds, targetCount: input.targetStores.length }
    });
    return { runIds, createdOrExisting: runIds.length };
  });
}

async function automateTaskAction(
  db: Pool,
  dashboardEvents: DashboardEventBus,
  request: FastifyRequest<{ Params: { taskId: string } }>,
  reply: any,
  action: TaskOperatorAction
) {
  const existing = await getTask(db, request.params.taskId);
  if (!existing) return reply.code(404).send({ error: "task_not_found" });
  const idempotent = action === "resume" ? existing.status === "pending" : existing.status === "paused";
  const task = await updateTaskWithRevokedLease(
    db,
    existing.taskId,
    (current) => buildTaskActionUpdate(current, action)
  );
  if (!task) return reply.code(409).send({ error: "task_action_conflict" });
  await insertOperationEvent(db, {
    actor: "codex_automation",
    action: `task.${action}`,
    targetType: "task",
    targetId: task.taskId,
    taskId: task.taskId,
    workerId: task.assignedWorkerId,
    storeId: task.storeId,
    detail: { idempotent, beforeStatus: existing.status, afterStatus: task.status }
  });
  dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task });
  return { task, idempotent };
}
