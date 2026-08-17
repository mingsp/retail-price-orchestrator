import type { DashboardMessage } from "@retail-orchestrator/shared";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { runBestEffort } from "./resilience.js";
import { broadcastDashboard } from "./ws/dashboard-gateway.js";

const channel = "retail-orchestrator:dashboard-events";

export interface DashboardEventBus {
  emit(message: DashboardMessage): void;
  close(): void;
}

export function createDashboardEventBus(
  redis: Redis,
  log: { warn: (obj: unknown, message?: string) => void }
): DashboardEventBus {
  const instanceId = randomUUID();
  // A dedicated subscriber may still be connecting during Master startup. Its subscription
  // command must be queued without changing the command client's fail-fast behavior.
  const subscriber = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  let subscribed = false;
  let subscribing = false;

  const ensureSubscribed = async () => {
    if (subscribed || subscribing) return;
    subscribing = true;
    try {
      subscribed = await runBestEffort(
        "dashboard event subscription",
        async () => { await subscriber.subscribe(channel); },
        (error) => log.warn({ error }, "dashboard event bus subscription degraded")
      );
    } finally {
      subscribing = false;
    }
  };

  subscriber.on("message", (receivedChannel, raw) => {
    if (receivedChannel !== channel) return;
    try {
      const envelope = JSON.parse(raw) as { instanceId: string; message: DashboardMessage };
      if (envelope.instanceId !== instanceId) broadcastDashboard(envelope.message);
    } catch (error) {
      log.warn({ error }, "invalid dashboard event envelope ignored");
    }
  });
  subscriber.on("end", () => { subscribed = false; });
  subscriber.on("error", (error) => log.warn({ error }, "dashboard event subscriber degraded"));
  void ensureSubscribed();
  const retryTimer = setInterval(() => void ensureSubscribed(), 10_000);
  retryTimer.unref();

  return {
    emit(message) {
      broadcastDashboard(message);
      void runBestEffort(
        "dashboard event publish",
        () => redis.publish(channel, JSON.stringify({ instanceId, message })),
        (error) => log.warn({ error, eventType: message.type }, "dashboard event cross-master fanout degraded")
      );
    },
    close() {
      clearInterval(retryTimer);
      subscriber.disconnect();
    }
  };
}
