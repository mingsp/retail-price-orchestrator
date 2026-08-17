import {
  taskOperatorActions,
  type CategoryTaskRecord,
  type MigrateTaskInput,
  type TaskActionInput,
  type TaskOperatorAction,
  type UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { getTask, updateTaskWithRevokedLease } from "../repositories/tasks.js";
import { operatorActor } from "./operation-events.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";
import { migrateTaskToBrowserSlot } from "../repositories/task-migration.js";
import { operatorWriteGuard } from "../operator-auth.js";

export function buildTaskActionUpdate(
  task: Pick<
    CategoryTaskRecord,
    "assignedWorkerId" | "assignedAccountId" | "assignedProfileId" | "assignedCdpEndpointId" | "cursor"
  >,
  action: TaskOperatorAction,
  now: Date = new Date()
): UpdateCategoryTaskInput {
  const nowIso = now.toISOString();
  const nextCursor: Record<string, unknown> = {
    ...(task.cursor || {}),
    lastOperatorAction: action,
    operatorActionAt: nowIso
  };

  if (action === "resume") {
    nextCursor.sleepRequestedAt = null;
    nextCursor.sleepUntil = null;
    nextCursor.wakeRequestedAt = nowIso;
    return {
      status: "pending",
      assignedWorkerId: task.assignedWorkerId ?? null,
      assignedAccountId: task.assignedAccountId ?? null,
      assignedProfileId: task.assignedProfileId ?? null,
      assignedCdpEndpointId: task.assignedCdpEndpointId ?? null,
      cursor: nextCursor,
      lastError: null
    };
  }

  if (action === "sleep_2h") {
    const wakeAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    nextCursor.sleepRequestedAt = nowIso;
    nextCursor.sleepUntil = wakeAt;
    nextCursor.wakeRequestedAt = wakeAt;
    nextCursor.fixedAssignmentPreserved = true;
    return {
      status: "paused",
      assignedWorkerId: task.assignedWorkerId ?? null,
      assignedAccountId: task.assignedAccountId ?? null,
      assignedProfileId: task.assignedProfileId ?? null,
      assignedCdpEndpointId: task.assignedCdpEndpointId ?? null,
      cursor: nextCursor,
      lastError: `operator requested sleep until ${wakeAt}`
    };
  }

  if (action === "requeue") {
    nextCursor.sleepRequestedAt = null;
    nextCursor.sleepUntil = null;
    nextCursor.wakeRequestedAt = nowIso;
    nextCursor.fixedAssignmentPreserved = true;
    return {
      status: "pending",
      assignedWorkerId: task.assignedWorkerId ?? null,
      assignedAccountId: task.assignedAccountId ?? null,
      assignedProfileId: task.assignedProfileId ?? null,
      assignedCdpEndpointId: task.assignedCdpEndpointId ?? null,
      cursor: nextCursor,
      lastError: null
    };
  }

  return {
    status: "manual_required",
    assignedWorkerId: task.assignedWorkerId ?? null,
    assignedAccountId: task.assignedAccountId ?? null,
    assignedProfileId: task.assignedProfileId ?? null,
    assignedCdpEndpointId: task.assignedCdpEndpointId ?? null,
    cursor: nextCursor
  };
}

export function registerTaskActionRoutes(app: FastifyInstance, db: Pool, dashboardEvents: DashboardEventBus, operatorToken?: string): void {
  app.post<{ Params: { taskId: string }; Body: TaskActionInput }>("/api/tasks/:taskId/actions", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    const { action } = request.body || {};
    if (!action || !taskOperatorActions.includes(action)) {
      return reply.code(400).send({ error: "invalid_action" });
    }

    const existing = await getTask(db, request.params.taskId);
    if (!existing) return reply.code(404).send({ error: "task_not_found" });

    const task = await updateTaskWithRevokedLease(
      db,
      request.params.taskId,
      (current) => buildTaskActionUpdate(current, action)
    );
    if (!task) return reply.code(404).send({ error: "task_not_found" });

    await insertOperationEvent(db, {
      actor: operatorActor(request),
      action: `task.${action}`,
      targetType: "task",
      targetId: task.taskId,
      taskId: task.taskId,
      workerId: existing.assignedWorkerId,
      accountId: existing.assignedAccountId,
      profileId: existing.assignedProfileId,
      cdpEndpointId: existing.assignedCdpEndpointId,
      storeId: task.storeId,
      detail: {
        beforeStatus: existing.status,
        afterStatus: task.status,
        categoryName: task.categoryName,
        runId: task.runId
      }
    });
    dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task });
    return { task };
  });

  app.post<{ Params: { taskId: string }; Body: MigrateTaskInput }>("/api/tasks/:taskId/migrate", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    if (!request.body?.targetSlotId) return reply.code(400).send({ error: "target_slot_required" });
    const before = await getTask(db, request.params.taskId);
    if (!before) return reply.code(404).send({ error: "task_not_found" });
    try {
      const task = await migrateTaskToBrowserSlot(db, request.params.taskId, request.body.targetSlotId, request.body.reason);
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: "task.migrate",
        targetType: "task",
        targetId: task.taskId,
        taskId: task.taskId,
        workerId: task.assignedWorkerId,
        accountId: task.assignedAccountId,
        profileId: task.assignedProfileId,
        cdpEndpointId: task.assignedCdpEndpointId,
        storeId: task.storeId,
        detail: { fromWorkerId: before.assignedWorkerId, targetSlotId: request.body.targetSlotId }
      });
      dashboardEvents.emit({ type: "task.updated", sentAt: new Date().toISOString(), task });
      return { task };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message.includes("not_found") ? 404 : 409).send({ error: message });
    }
  });
}
