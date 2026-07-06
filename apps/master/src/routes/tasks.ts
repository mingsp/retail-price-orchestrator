import type { CreateCategoryTaskInput, CreateRunInput, CreateStoreInput, UpdateCategoryTaskInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  createCategoryTasks,
  createRun,
  getRun,
  getTask,
  listRuns,
  listStores,
  listTasks,
  updateTask,
  upsertStore
} from "../repositories/tasks.js";

export function registerTaskRoutes(app: FastifyInstance, db: Pool): void {
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

  app.post<{ Params: { runId: string }; Body: { tasks: CreateCategoryTaskInput[] } }>(
    "/api/runs/:runId/tasks",
    async (request, reply) => {
      const tasks = await createCategoryTasks(db, request.params.runId, request.body?.tasks || []);
      if (!tasks.length && !(await getRun(db, request.params.runId))) {
        return reply.code(404).send({ error: "run_not_found" });
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
    async (request, reply) => {
      const task = await updateTask(db, request.params.taskId, request.body || {});
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      return { task };
    }
  );
}
