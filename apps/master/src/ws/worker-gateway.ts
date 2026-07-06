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
import type { WebSocket } from "ws";
import { insertRiskEvent } from "../repositories/risk-events.js";
import { getWorker, upsertWorkerSnapshot } from "../repositories/workers.js";
import { broadcastDashboard } from "./dashboard-gateway.js";

interface WorkerGatewayDeps {
  db: Pool;
  redis: Redis;
  workerSharedToken: string;
}

export function registerWorkerGateway(app: FastifyInstance, deps: WorkerGatewayDeps): void {
  app.get("/ws/worker", { websocket: true }, (socket, request) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token !== deps.workerSharedToken) {
      send(socket, { type: "master.error", receivedAt: new Date().toISOString(), message: "unauthorized" });
      socket.close();
      return;
    }

    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw)) as WorkerToMasterMessage;
        if (message.type === "worker.register" || message.type === "worker.heartbeat") {
          await handleHeartbeat(deps, message);
          send(socket, {
            type: message.type === "worker.register" ? "master.register_ack" : "master.heartbeat_ack",
            receivedAt: new Date().toISOString(),
            workerId: message.worker.workerId
          });
          const worker = await getWorker(deps.db, message.worker.workerId);
          if (worker) {
            broadcastDashboard({ type: "worker.updated", sentAt: new Date().toISOString(), worker });
          }
          return;
        }

        if (message.type === "worker.risk_event") {
          const risk = await handleRiskEvent(deps, message);
          broadcastDashboard({ type: "risk.created", sentAt: new Date().toISOString(), risk });
        }
      } catch (error) {
        app.log.error({ error }, "failed to handle worker websocket message");
        send(socket, {
          type: "master.error",
          receivedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "unknown error"
        });
      }
    });
  });
}

async function handleHeartbeat(
  deps: WorkerGatewayDeps,
  message: WorkerHeartbeatPayload | WorkerRegisterPayload
): Promise<void> {
  const heartbeat: WorkerHeartbeatPayload = {
    type: "worker.heartbeat",
    sentAt: message.sentAt,
    worker: message.worker,
    accounts: message.accounts
  };
  await upsertWorkerSnapshot(deps.db, heartbeat);
  await deps.redis.set(
    `presence:worker:${message.worker.workerId}`,
    JSON.stringify({ workerId: message.worker.workerId, seenAt: new Date().toISOString() }),
    "EX",
    45
  );
  await deps.redis.set(`worker:last_snapshot:${message.worker.workerId}`, JSON.stringify(message), "EX", 3600);
  await deps.redis.publish("events:worker", JSON.stringify(message));
}

async function handleRiskEvent(deps: WorkerGatewayDeps, message: RiskEventPayload) {
  const risk = await insertRiskEvent(deps.db, message);
  await deps.redis.publish("events:risk", JSON.stringify(message));
  return risk;
}

function send(socket: WebSocket, message: MasterToWorkerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
