import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  listNotificationAttentionItems,
  notificationDeliverySummary
} from "../repositories/notification-outbox.js";

export function registerNotificationDeliveryRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/notification-deliveries/status", async () => ({
    summary: await notificationDeliverySummary(db),
    attention: await listNotificationAttentionItems(db)
  }));
}
