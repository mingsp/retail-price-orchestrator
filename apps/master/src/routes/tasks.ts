import type {
  CreateCategoryTaskInput,
  CreateRunInput,
  CreateStoreInput,
  CategoryTaskRecord,
  TaskClaimInput,
  UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { queueRunMilestoneNotification, queueRiskEventNotification } from "../notifications.js";
import { getCdpEndpoint } from "../repositories/cdp-endpoints.js";
import { insertRiskEvent } from "../repositories/risk-events.js";
import { requeueExpiredLeases } from "../repositories/task-leases.js";
import { renewTaskLease } from "../repositories/task-leases.js";
import { getWorkerAuthentication, type WorkerAuthentication } from "../worker-auth.js";
import {
  createCategoryTasks,
  createRun,
  getRun,
  getTask,
  claimNextTask,
  listRuns,
  listStores,
  listTasks,
  markNextPreflightTaskManualRequired,
  updateTask,
  upsertStore
} from "../repositories/tasks.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";

export interface TaskRouteDeps {
  db: Pool;
  dashboardEvents: DashboardEventBus;
  dingtalkWebhookUrl?: string;
}

export function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): void {
  const { db } = deps;
  app.get("/api/stores", async () => {
    return { stores: await listStores(db) };
  });

  app.post<{ Body: CreateStoreInput }>("/api/stores", async (request) => {
    return { store: await upsertStore(db, request.body) };
  });

  app.get("/api/runs", async () => {
    return { runs: await listRuns(db) };
  });

  app.post<{ Body: CreateRunInput }>("/api/runs", async (request) => {
    return { run: await createRun(db, request.body) };
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", async (request, reply) => {
    const run = await getRun(db, request.params.runId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return { run };
  });

  app.get<{ Querystring: { runId?: string } }>("/api/tasks", async (request) => {
    return { tasks: await listTasks(db, request.query.runId) };
  });

  app.post<{ Body: TaskClaimInput }>("/api/tasks/claim", async (request) => {
    const requeued = await requeueExpiredLeases(db);
    if (requeued > 0) app.log.info({ requeued }, "requeued expired leases or completed sleeps before claim");
    const result = await claimNextTask(db, request.body);
    if (result.reason === "store_mismatch" || result.reason === "location_not_confirmed" || result.reason === "page_not_ready") {
      await reportClaimPreflightRisk(app, deps, request.body, result.reason);
      const blockedTask = await markNextPreflightTaskManualRequired(db, request.body, result.reason);
      if (blockedTask) {
        deps.dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task: blockedTask });
      }
    }
    if (result.task) {
      deps.dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task: result.task });
    }
    return result;
  });

  app.post<{ Params: { runId: string }; Body: { tasks: CreateCategoryTaskInput[] } }>(
    "/api/runs/:runId/tasks",
    async (request, reply) => {
      const tasks = await createCategoryTasks(db, request.params.runId, request.body?.tasks || []);
      if (!tasks.length && !(await getRun(db, request.params.runId))) {
        return reply.code(404).send({ error: "run_not_found" });
      }
      for (const task of tasks) {
        deps.dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task });
      }
      return { tasks };
    }
  );

  app.get<{ Params: { taskId: string } }>("/api/tasks/:taskId", async (request, reply) => {
    const task = await getTask(db, request.params.taskId);
    if (!task) return reply.code(404).send({ error: "task_not_found" });
    return { task };
  });

  app.patch<{ Params: { taskId: string }; Body: UpdateCategoryTaskInput }>(
    "/api/tasks/:taskId",
    updateTaskHandler(app, deps)
  );

  app.patch<{ Params: { taskId: string }; Body: UpdateCategoryTaskInput }>(
    "/api/worker/tasks/:taskId",
    workerUpdateTaskHandler(app, deps)
  );

  app.post<{
    Params: { taskId: string };
    Body: { expectedLeaseOwner?: string; expectedLeaseGeneration?: number; seconds?: number };
  }>("/api/worker/tasks/:taskId/lease/renew", async (request, reply) => {
    const authentication = getWorkerAuthentication(request);
    const update = request.body || {};
    try {
      validateWorkerTaskUpdate(authentication, update);
    } catch (error) {
      return reply.code(403).send({ error: error instanceof Error ? error.message : String(error) });
    }
    const seconds = Math.min(600, Math.max(30, Math.trunc(update.seconds || 120)));
    const renewed = await renewTaskLease(
      db,
      request.params.taskId,
      update.expectedLeaseOwner!,
      update.expectedLeaseGeneration!,
      seconds
    );
    if (!renewed) return reply.code(409).send({ error: "stale_task_lease" });
    const task = await getTask(db, request.params.taskId);
    return task ? { task } : reply.code(404).send({ error: "task_not_found" });
  });
}

export function validateWorkerTaskUpdate(
  authentication: WorkerAuthentication | undefined,
  update: Pick<UpdateCategoryTaskInput, "expectedLeaseOwner" | "expectedLeaseGeneration" | "assignedWorkerId" | "assignedAccountId" | "assignedProfileId" | "assignedCdpEndpointId" | "leaseOwner" | "leaseUntil">
): void {
  if (!authentication || !update.expectedLeaseOwner || update.expectedLeaseGeneration === undefined) {
    throw new Error("task_write_lease_required");
  }
  if (!Number.isInteger(update.expectedLeaseGeneration) || update.expectedLeaseGeneration < 1) {
    throw new Error("invalid_task_lease_generation");
  }
  if (!authentication.legacy && authentication.workerId !== update.expectedLeaseOwner) {
    throw new Error("worker_identity_mismatch");
  }
  if (
    "assignedWorkerId" in update ||
    "assignedAccountId" in update ||
    "assignedProfileId" in update ||
    "assignedCdpEndpointId" in update ||
    "leaseOwner" in update ||
    "leaseUntil" in update
  ) throw new Error("worker_task_assignment_forbidden");
}

async function reportClaimPreflightRisk(
  app: FastifyInstance,
  deps: TaskRouteDeps,
  input: TaskClaimInput,
  reason: "store_mismatch" | "location_not_confirmed" | "page_not_ready"
): Promise<void> {
  const endpoint = input.cdpEndpointId ? await getCdpEndpoint(deps.db, input.cdpEndpointId) : null;
  const riskType = reason === "store_mismatch"
    ? "store_mismatch"
    : reason === "location_not_confirmed"
      ? "store_location_mismatch"
    : input.observedPageState === "login_required" ? "login_required" : "identity_check";
  const duplicate = await deps.db.query(`
    SELECT risk_id FROM risk_events
    WHERE worker_id = $1 AND account_id = $2 AND risk_type = $3 AND status <> 'resolved'
      AND created_at > now() - interval '15 minutes'
    LIMIT 1
  `, [input.workerId, input.accountId, riskType]);
  if (duplicate.rows[0]) return;
  const risk = await insertRiskEvent(deps.db, {
    type: "worker.risk_event",
    sentAt: new Date().toISOString(),
    event: {
      severity: "high",
      riskType,
      workerId: input.workerId,
      accountId: input.accountId,
      profileId: input.profileId,
      cdpPort: endpoint?.port,
      storeId: endpoint?.targetStoreId,
      storeName: endpoint?.targetStoreName,
      phase: "task_preflight",
      observed: reason === "store_mismatch"
        ? "当前页面门店与任务目标门店不一致"
        : reason === "location_not_confirmed"
          ? "当前页面配送位置尚未确认在目标门店服务区域附近"
          : "当前门店页面尚未达到可采集状态",
      recommendedAction: reason === "location_not_confirmed"
        ? "请在当前 H5 页面使用地址选择器定位到目标门店附近，确认城市、地址和门店 ID 后再恢复任务"
        : "请定位到对应设备和浏览器席位，确认账号、门店页面和验证状态后再恢复任务"
    }
  });
  deps.dashboardEvents.emit({ type: "risk.created", sentAt: new Date().toISOString(), risk });
  await queueRiskEventNotification(deps.db, Boolean(deps.dingtalkWebhookUrl), risk);
}

function updateTaskHandler(app: FastifyInstance, deps: TaskRouteDeps) {
  return async (request: any, reply: any) => {
    const task = await updateTask(deps.db, request.params.taskId, request.body || {});
      if (!task && (request.body?.expectedLeaseOwner || request.body?.expectedLeaseGeneration !== undefined)) {
        return reply.code(409).send({ error: "stale_task_lease" });
      }
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      deps.dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task });
      await maybeNotifyRunProgress(app, deps, task);
      return { task };
  };
}

function workerUpdateTaskHandler(app: FastifyInstance, deps: TaskRouteDeps) {
  return async (request: any, reply: any) => {
    try {
      validateWorkerTaskUpdate(getWorkerAuthentication(request), request.body || {});
    } catch (error) {
      return reply.code(403).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return updateTaskHandler(app, deps)(request, reply);
  };
}

async function maybeNotifyRunProgress(
  app: FastifyInstance,
  deps: TaskRouteDeps,
  changedTask: CategoryTaskRecord
): Promise<void> {
  if (!deps.dingtalkWebhookUrl) return;
  const tasks = await listTasks(deps.db, changedTask.runId);
  if (!tasks.length) return;
  const progress = calculateValidatedMilestones(tasks);

  for (const threshold of progress.thresholds) {
    const queued = await queueRunMilestoneNotification(deps.db, true, {
      threshold,
      storeId: changedTask.storeId,
      storeName: changedTask.storeName,
      runId: changedTask.runId,
      recordedItems: progress.recordedItems,
      validatedCategories: progress.validatedCategories,
      totalCategories: progress.totalCategories
    });
    if (queued.inserted) {
      app.log.info({ runId: changedTask.runId, threshold }, "queued run milestone notification");
    }
  }
}

export function calculateValidatedMilestones(
  tasks: Array<Pick<CategoryTaskRecord, "status" | "collectedItems">>
): {
  recordedItems: number;
  validatedCategories: number;
  totalCategories: number;
  percent: number;
  thresholds: Array<50 | 100>;
} {
  const totalCategories = tasks.length;
  const validatedCategories = tasks.filter((task) => task.status === "completed_valid").length;
  const recordedItems = tasks.reduce((sum, task) => sum + Math.max(0, task.collectedItems || 0), 0);
  const percent = totalCategories > 0
    ? Math.floor((validatedCategories / totalCategories) * 100)
    : 0;
  const thresholds: Array<50 | 100> = [];

  if (percent >= 50) thresholds.push(50);
  if (totalCategories > 0 && validatedCategories === totalCategories) thresholds.push(100);

  return { recordedItems, validatedCategories, totalCategories, percent, thresholds };
}
