import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { getWorker, listWorkers } from "../repositories/workers.js";

export function registerWorkerRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/workers", async () => {
    return { workers: await listWorkers(db) };
  });

  app.get<{ Params: { workerId: string } }>("/api/workers/:workerId", async (request, reply) => {
    const worker = await getWorker(db, request.params.workerId);
    if (!worker) return reply.code(404).send({ error: "worker_not_found" });
    return { worker };
  });
}

