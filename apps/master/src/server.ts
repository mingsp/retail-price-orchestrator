import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import type { Client } from "minio";
import type { Pool } from "pg";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerRiskEventRoutes } from "./routes/risk-events.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerWorkerRoutes } from "./routes/workers.js";
import { ensureBuckets } from "./s3.js";
import { addDashboardClient, broadcastDashboard } from "./ws/dashboard-gateway.js";
import { registerWorkerGateway } from "./ws/worker-gateway.js";
import { listWorkers } from "./repositories/workers.js";

export interface ServerDeps {
  db: Pool;
  redis: Redis;
  s3: Client;
  workerSharedToken: string;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.get("/ready", async () => {
    await deps.db.query("SELECT 1");
    await deps.redis.ping();
    await ensureBuckets(deps.s3);
    return { ok: true, postgres: "ok", redis: "ok", s3: "ok" };
  });

  app.get("/ws/dashboard", { websocket: true }, async (socket) => {
    addDashboardClient(socket);
    socket.send(
      JSON.stringify({
        type: "dashboard.snapshot",
        sentAt: new Date().toISOString(),
        workers: await listWorkers(deps.db)
      })
    );
  });

  registerWorkerGateway(app, deps);
  registerWorkerRoutes(app, deps.db);
  registerAccountRoutes(app, deps.db);
  registerRiskEventRoutes(app, deps.db);
  registerTaskRoutes(app, deps.db);
  registerArtifactRoutes(app, deps.db, deps.s3);

  return app;
}
