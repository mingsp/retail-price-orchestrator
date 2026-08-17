import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  bearerToken,
  buildMonitoringNotifications,
  isMonitoringAlertAuthorized,
  type AlertmanagerWebhook
} from "../monitoring-alerts.js";
import { enqueueNotification } from "../repositories/notification-outbox.js";

export function registerMonitoringAlertRoutes(app: FastifyInstance, db: Pool, configuredToken?: string): void {
  app.post<{ Body: AlertmanagerWebhook }>("/internal/monitoring/alerts", async (request, reply) => {
    if (!configuredToken) return reply.code(503).send({ error: "monitoring_alert_receiver_not_configured" });
    if (!isMonitoringAlertAuthorized(bearerToken(request.headers.authorization), configuredToken)) {
      return reply.code(401).send({ error: "monitoring_alert_auth_failed" });
    }

    let drafts;
    try {
      drafts = buildMonitoringNotifications(request.body || {});
    } catch {
      return reply.code(400).send({ error: "monitoring_alert_payload_invalid" });
    }

    const results = await Promise.all(drafts.map((draft) => enqueueNotification(db, draft)));
    return reply.code(202).send({
      accepted: results.length,
      inserted: results.filter((result) => result.inserted).length
    });
  });
}
