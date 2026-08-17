import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { getRunProgress, listRunProgress } from "../repositories/run-progress.js";

export function registerRunProgressRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/run-progress", async () => ({ runs: await listRunProgress(db) }));
  app.get<{ Params: { runId: string } }>("/api/runs/:runId/progress", async (request, reply) => {
    const run = await getRunProgress(db, request.params.runId);
    if (!run) return reply.code(404).send({ error: "run_not_found" });
    return { run };
  });
}
