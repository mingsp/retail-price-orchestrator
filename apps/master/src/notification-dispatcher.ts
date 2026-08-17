import type { FastifyBaseLogger } from "fastify";
import {
  dispatchNextNotification,
  type DingTalkResponse,
  type NotificationDelivery,
  type NotificationDeliveryStore
} from "./notification-outbox.js";

export function createDingTalkTransport(
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): (delivery: NotificationDelivery) => Promise<DingTalkResponse> {
  return async (delivery) => {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: delivery.message } }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = { errmsg: `钉钉返回非 JSON 响应，HTTP ${response.status}` };
    }
    return { statusCode: response.status, body };
  };
}

export function startNotificationDispatcher(options: {
  store: NotificationDeliveryStore;
  transport: (delivery: NotificationDelivery) => Promise<DingTalkResponse>;
  logger: Pick<FastifyBaseLogger, "info" | "error">;
  intervalMs?: number;
  batchSize?: number;
}): () => void {
  let running = false;
  const intervalMs = options.intervalMs || 5_000;
  const batchSize = options.batchSize || 20;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (let index = 0; index < batchSize; index += 1) {
        const processed = await dispatchNextNotification(options.store, options.transport);
        if (!processed) break;
      }
    } catch (error) {
      options.logger.error({ error }, "notification outbox dispatch failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  options.logger.info("notification outbox dispatcher started");
  return () => clearInterval(timer);
}
