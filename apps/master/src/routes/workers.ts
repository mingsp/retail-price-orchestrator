import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { getWorker, listWorkers } from "../repositories/workers.js";
import { getWorkerAuthentication } from "../worker-auth.js";

export function registerWorkerRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/workers", async () => {
    return { workers: await listWorkers(db) };
  });

  app.get<{ Params: { workerId: string } }>("/api/workers/:workerId", async (request, reply) => {
    const worker = await getWorker(db, request.params.workerId);
    if (!worker) return reply.code(404).send({ error: "worker_not_found" });
    return { worker };
  });

  app.get("/api/worker/self", async (request, reply) => {
    const authentication = getWorkerAuthentication(request);
    if (!authentication?.workerId || authentication.legacy) {
      return reply.code(403).send({ error: "individual_worker_identity_required" });
    }
    const worker = await getWorker(db, authentication.workerId);
    if (!worker) return reply.code(404).send({ error: "worker_not_found" });
    return { worker };
  });
}
