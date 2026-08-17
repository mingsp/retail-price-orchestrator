import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import type { Client } from "minio";
import type { Pool } from "pg";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAccountPoolRoutes } from "./routes/account-pool.js";
import { registerCdpEndpointRoutes } from "./routes/cdp-endpoints.js";
import { registerCdpCommandRoutes } from "./routes/cdp-commands.js";
import { registerRiskEventRoutes } from "./routes/risk-events.js";
import { registerQualityRoutes } from "./routes/quality.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerProductionReadinessRoutes } from "./routes/production-readiness.js";
import { registerOperationEventRoutes } from "./routes/operation-events.js";
import { registerRetailMartSyncRoutes } from "./routes/retailmart-sync.js";
import { registerStoreRunPlannerRoutes } from "./routes/store-run-planner.js";
import { registerTaskActionRoutes } from "./routes/task-actions.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerRunProgressRoutes } from "./routes/run-progress.js";
import { registerWorkerRoutes } from "./routes/workers.js";
import { registerNotificationDeliveryRoutes } from "./routes/notification-deliveries.js";
import { registerBusinessRoutes } from "./routes/business.js";
import { registerDeliveryRoutes } from "./routes/deliveries.js";
import { ensureBuckets } from "./s3.js";
import { registerWorkerHttpAuth } from "./worker-auth.js";
import { registerWorkerEnrollmentRoutes } from "./routes/worker-enrollment.js";
import { registerBrowserSlotRoutes } from "./routes/browser-slots.js";
import { registerAutomationRoutes } from "./routes/automation.js";
import { registerRegistrySyncRoutes } from "./routes/registry-sync.js";
import { registerScopeManifestRoutes } from "./routes/scope-manifests.js";
import { registerVersionRoutes } from "./routes/version.js";
import { registerMonitoringAlertRoutes } from "./routes/monitoring-alerts.js";
import { readReleaseInfo } from "./release-info.js";
import { addBusinessClient, addDashboardClient, broadcastDashboard, getDashboardGatewayMetrics, startDashboardGatewayHeartbeat } from "./ws/dashboard-gateway.js";
import { getActiveWorkerSocketCount, registerWorkerGateway } from "./ws/worker-gateway.js";
import { listWorkers } from "./repositories/workers.js";
import { requeueExpiredLeases } from "./repositories/task-leases.js";
import type { RetailMartDbConfig } from "./repositories/retailmart-sync.js";
import { registerObservability } from "./observability.js";
import { checkDependency } from "./resilience.js";
import { createDashboardEventBus } from "./dashboard-event-bus.js";
import { pruneWorkerHeartbeats } from "./repositories/workers.js";
import {
  isCorsOriginAllowed,
  isOperatorRequestAuthorized,
  operatorTokenFromHeader,
  operatorTokenFromWebSocketProtocols,
  registerOperatorMutationAuth
} from "./operator-auth.js";

export interface ServerDeps {
  db: Pool;
  redis: Redis;
  s3: Client;
  s3Public?: Client;
  masterPublicBaseUrl: string;
  workerSharedToken: string;
  allowLegacyWorkerSharedToken: boolean;
  automationToken?: string;
  operatorToken?: string;
  monitoringAlertToken?: string;
  registrySyncToken?: string;
  registrySchemaHash?: string;
  operatorAllowedOrigins?: string[];
  dingtalkWebhookUrl?: string;
  retailMart?: RetailMartDbConfig;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, isCorsOriginAllowed(origin, deps.operatorAllowedOrigins || [new URL(deps.masterPublicBaseUrl).origin]));
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-Retail-Operator-Token", "X-Retail-Registry-Sync-Token"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(websocket);
  const dashboardEvents = createDashboardEventBus(deps.redis, app.log);
  registerWorkerHttpAuth(app, {
    db: deps.db,
    workerSharedToken: deps.workerSharedToken,
    allowLegacyWorkerSharedToken: deps.allowLegacyWorkerSharedToken
  });
  registerOperatorMutationAuth(app, deps.operatorToken);
  registerObservability(app, deps.db, {
    dashboardConnections: () => getDashboardGatewayMetrics().dashboardClients,
    businessConnections: () => getDashboardGatewayMetrics().businessClients,
    workerConnections: getActiveWorkerSocketCount
  });

  app.get("/health", async () => ({ ok: true, ...readReleaseInfo() }));
  registerVersionRoutes(app);
  registerMonitoringAlertRoutes(app, deps.db, deps.monitoringAlertToken);

  app.get("/ready", async (_request, reply) => {
    const dependencies = await Promise.all([
      checkDependency("postgres", () => deps.db.query("SELECT 1")),
      checkDependency("redis", () => deps.redis.ping()),
      checkDependency("object_storage", () => ensureBuckets(deps.s3), 5_000)
    ]);
    const ok = dependencies.every((item) => item.ok);
    if (!ok) reply.code(503);
    return { ok, status: ok ? "ready" : "degraded", dependencies };
  });

  const dashboardWebSocketGuard = async (request: any, reply: any) => {
    const token = operatorTokenFromHeader(request.headers["x-retail-operator-token"])
      || operatorTokenFromWebSocketProtocols(request.headers["sec-websocket-protocol"]);
    if (!isOperatorRequestAuthorized(token, deps.operatorToken)) {
      await reply.code(401).send({ error: "操作台身份校验失败" });
    }
  };

  app.get("/ws/dashboard", { websocket: true, preValidation: dashboardWebSocketGuard }, async (socket) => {
    addDashboardClient(socket);
    socket.send(
      JSON.stringify({
        type: "dashboard.snapshot",
        sentAt: new Date().toISOString(),
        workers: await listWorkers(deps.db)
      })
    );
  });

  app.get("/ws/business", { websocket: true, preValidation: dashboardWebSocketGuard }, (socket) => {
    addBusinessClient(socket);
    socket.send(JSON.stringify({
      type: "business.refresh",
      sentAt: new Date().toISOString(),
      domains: ["overview", "runs", "activities", "issues", "deliveries"]
    }));
  });

  registerWorkerGateway(app, { ...deps, dashboardEvents });
  registerWorkerEnrollmentRoutes(app, deps.db, deps.masterPublicBaseUrl, deps.operatorToken);
  registerBrowserSlotRoutes(app, deps.db, deps.operatorToken);
  registerAutomationRoutes(app, deps.db, dashboardEvents, deps.automationToken);
  registerRegistrySyncRoutes(app, deps.db, deps.registrySchemaHash, deps.registrySyncToken);
  registerWorkerRoutes(app, deps.db);
  registerAccountRoutes(app, deps.db);
  registerAccountPoolRoutes(app, deps.db);
  registerCdpEndpointRoutes(app, deps.db);
  registerCdpCommandRoutes(app, deps.db, deps.operatorToken);
  registerRiskEventRoutes(app, deps.db, dashboardEvents, deps.dingtalkWebhookUrl);
  registerNotificationDeliveryRoutes(app, deps.db);
  registerStoreRunPlannerRoutes(app, deps.db);
  registerScopeManifestRoutes(app, deps.db);
  registerTaskRoutes(app, {
    db: deps.db,
    dashboardEvents,
    dingtalkWebhookUrl: deps.dingtalkWebhookUrl
  });
  registerRunProgressRoutes(app, deps.db);
  registerTaskActionRoutes(app, deps.db, dashboardEvents, deps.operatorToken);
  registerArtifactRoutes(app, deps.db, deps.s3, deps.s3Public || deps.s3, dashboardEvents);
  registerQualityRoutes(app, deps.db, dashboardEvents);
  registerProductRoutes(app, deps.db);
  registerRetailMartSyncRoutes(app, deps.db, deps.s3, deps.retailMart);
  registerProductionReadinessRoutes(
    app,
    deps.db,
    deps.workerSharedToken,
    Boolean(deps.dingtalkWebhookUrl),
    Boolean(deps.monitoringAlertToken)
  );
  registerOperationEventRoutes(app, deps.db);
  registerBusinessRoutes(app, deps.db);
  registerDeliveryRoutes(app, deps.db, deps.s3, deps.s3Public || deps.s3);

  const leaseRecoveryTimer = setInterval(() => {
    void requeueExpiredLeases(deps.db)
      .then((requeued) => {
        if (requeued > 0) app.log.warn({ requeued }, "recovered expired task leases or completed sleeps");
      })
      .catch((error) => app.log.error({ error }, "task lease recovery failed"));
  }, 30_000);
  leaseRecoveryTimer.unref();
  const heartbeatRetentionTimer = setInterval(() => {
    void pruneWorkerHeartbeats(deps.db, 14)
      .then((deleted) => {
        if (deleted > 0) app.log.info({ deleted }, "pruned worker heartbeat history");
      })
      .catch((error) => app.log.error({ error }, "worker heartbeat retention failed"));
  }, 60 * 60 * 1_000);
  heartbeatRetentionTimer.unref();
  const stopGatewayHeartbeat = startDashboardGatewayHeartbeat();
  app.addHook("onClose", async () => {
    clearInterval(leaseRecoveryTimer);
    clearInterval(heartbeatRetentionTimer);
    stopGatewayHeartbeat();
    dashboardEvents.close();
  });

  return app;
}
