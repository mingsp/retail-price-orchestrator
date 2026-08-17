import type {
  MasterToWorkerMessage,
  RiskEventPayload,
  WorkerHeartbeatPayload,
  WorkerRegisterPayload,
  WorkerToMasterMessage
} from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import type { RawData, WebSocket } from "ws";
import { queueRiskEventNotification } from "../notifications.js";
import { insertRiskEvent } from "../repositories/risk-events.js";
import { getWorker, upsertWorkerSnapshot } from "../repositories/workers.js";
import { runBestEffort } from "../resilience.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";
import { authenticateWorkerBearer, assertWorkerIdentity } from "../worker-auth.js";
import { findActiveWorkerByTokenHash } from "../repositories/worker-enrollment.js";

const activeWorkerSockets = new Set<WebSocket>();
const MAX_PRE_AUTH_MESSAGES = 32;

export function getActiveWorkerSocketCount(): number {
  return activeWorkerSockets.size;
}

interface WorkerGatewayDeps {
  db: Pool;
  redis: Redis;
  workerSharedToken: string;
  allowLegacyWorkerSharedToken: boolean;
  dingtalkWebhookUrl?: string;
  dashboardEvents: DashboardEventBus;
}

export function registerWorkerGateway(app: FastifyInstance, deps: WorkerGatewayDeps): void {
  app.get<{ Querystring: { workerId?: string } }>("/ws/worker", { websocket: true }, async (socket, request) => {
    const pendingMessages: RawData[] = [];
    let enqueueMessage: ((raw: RawData) => void) | undefined;
    socket.on("message", (raw) => {
      if (enqueueMessage) enqueueMessage(raw);
      else if (pendingMessages.length < MAX_PRE_AUTH_MESSAGES) pendingMessages.push(raw);
      else socket.close(1009, "too_many_messages_before_auth");
    });

    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const authentication = await authenticateWorkerBearer(token, {
      allowLegacySharedToken: deps.allowLegacyWorkerSharedToken,
      legacySharedToken: deps.workerSharedToken,
      findWorkerByTokenHash: (tokenHash) => findActiveWorkerByTokenHash(deps.db, tokenHash)
    });
    if (!authentication) {
      send(socket, { type: "master.error", receivedAt: new Date().toISOString(), message: "unauthorized" });
      socket.close();
      return;
    }
    try {
      if (!request.query.workerId) throw new Error("worker_id_required");
      assertWorkerIdentity(authentication, request.query.workerId);
    } catch (error) {
      send(socket, {
        type: "master.error",
        receivedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "worker_identity_mismatch"
      });
      socket.close();
      return;
    }

    activeWorkerSockets.add(socket);
    let responsive = true;
    socket.on("pong", () => { responsive = true; });
    const livenessTimer = setInterval(() => {
      if (!responsive) {
        socket.terminate();
        return;
      }
      responsive = false;
      socket.ping();
    }, 30_000);
    livenessTimer.unref();
    const cleanup = () => {
      clearInterval(livenessTimer);
      activeWorkerSockets.delete(socket);
    };
    socket.once("close", cleanup);
    socket.once("error", cleanup);

    let messageQueue = Promise.resolve();
    enqueueMessage = (raw) => {
      messageQueue = messageQueue.then(async () => {
        try {
          const message = JSON.parse(String(raw)) as WorkerToMasterMessage;
          if (message.type === "worker.register" || message.type === "worker.heartbeat") {
            assertWorkerIdentity(authentication, message.worker.workerId);
            if (message.worker.workerId !== request.query.workerId) throw new Error("worker_identity_mismatch");
            await handleHeartbeat(app, deps, message);
            send(socket, {
              type: message.type === "worker.register" ? "master.register_ack" : "master.heartbeat_ack",
              receivedAt: new Date().toISOString(),
              workerId: message.worker.workerId
            });
            const worker = await getWorker(deps.db, message.worker.workerId);
            if (worker) {
              deps.dashboardEvents.emit({ type: "worker.updated", sentAt: new Date().toISOString(), worker });
            }
            return;
          }

          if (message.type === "worker.risk_event") {
            assertWorkerIdentity(authentication, message.event.workerId);
            if (message.event.workerId !== request.query.workerId) throw new Error("worker_identity_mismatch");
            const risk = await handleRiskEvent(app, deps, message);
            deps.dashboardEvents.emit({ type: "risk.created", sentAt: new Date().toISOString(), risk });
            await queueRiskEventNotification(deps.db, Boolean(deps.dingtalkWebhookUrl), risk);
          }
        } catch (error) {
          app.log.error(
            { err: error, errorMessage: error instanceof Error ? error.message : String(error) },
            "failed to handle worker websocket message"
          );
          send(socket, {
            type: "master.error",
            receivedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : "unknown error"
          });
        }
      });
    };
    for (const raw of pendingMessages.splice(0)) enqueueMessage(raw);
  });
}

async function handleHeartbeat(
  app: FastifyInstance,
  deps: WorkerGatewayDeps,
  message: WorkerHeartbeatPayload | WorkerRegisterPayload
): Promise<void> {
  const heartbeat: WorkerHeartbeatPayload = {
    type: "worker.heartbeat",
    sentAt: message.sentAt,
    worker: message.worker,
    accounts: message.accounts,
    cdpEndpoints: message.cdpEndpoints,
    execution: message.execution,
    latestLogSummary: message.latestLogSummary
  };
  await upsertWorkerSnapshot(deps.db, heartbeat);
  await runBestEffort(
    "worker heartbeat redis fanout",
    () => Promise.all([
      deps.redis.set(
        `presence:worker:${message.worker.workerId}`,
        JSON.stringify({ workerId: message.worker.workerId, seenAt: new Date().toISOString() }),
        "EX",
        45
      ),
      deps.redis.set(`worker:last_snapshot:${message.worker.workerId}`, JSON.stringify(message), "EX", 3600),
      deps.redis.publish("events:worker", JSON.stringify(message))
    ]),
    (error) => app.log.warn({ error, workerId: message.worker.workerId }, "redis fanout degraded after durable heartbeat")
  );
}

async function handleRiskEvent(app: FastifyInstance, deps: WorkerGatewayDeps, message: RiskEventPayload) {
  const risk = await insertRiskEvent(deps.db, message);
  await runBestEffort(
    "risk event redis fanout",
    () => deps.redis.publish("events:risk", JSON.stringify(message)),
    (error) => app.log.warn({ error, riskId: risk.riskId }, "redis fanout degraded after durable risk event")
  );
  return risk;
}

function send(socket: WebSocket, message: MasterToWorkerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
