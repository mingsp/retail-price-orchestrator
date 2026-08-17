import { createHash, timingSafeEqual } from "node:crypto";
import { sanitizeNotificationText, type NotificationDraft } from "./notification-outbox.js";

export interface AlertmanagerAlert {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  fingerprint?: string;
}

export interface AlertmanagerWebhook {
  status?: string;
  receiver?: string;
  groupKey?: string;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  alerts?: AlertmanagerAlert[];
}

export function isMonitoringAlertAuthorized(presentedToken?: string, configuredToken?: string): boolean {
  if (!configuredToken || !presentedToken) return false;
  const presented = Buffer.from(presentedToken, "utf8");
  const configured = Buffer.from(configuredToken, "utf8");
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

export function bearerToken(value?: string): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function buildMonitoringNotifications(payload: AlertmanagerWebhook): NotificationDraft[] {
  if (!Array.isArray(payload.alerts) || payload.alerts.length === 0) {
    throw new Error("monitoring_alerts_required");
  }

  return payload.alerts.map((alert) => {
    const labels = { ...(payload.commonLabels || {}), ...(alert.labels || {}) };
    const annotations = { ...(payload.commonAnnotations || {}), ...(alert.annotations || {}) };
    const status = alert.status === "resolved" || payload.status === "resolved" ? "resolved" : "firing";
    const alertName = labels.alertname || "系统异常";
    const severity = labels.severity || "warning";
    const summary = annotations.summary || alertName;
    const fingerprint = alert.fingerprint || createHash("sha256")
      .update(JSON.stringify({ alertName, labels, startsAt: alert.startsAt, groupKey: payload.groupKey }))
      .digest("hex")
      .slice(0, 32);

    const message = sanitizeNotificationText([
      status === "resolved" ? "商圈比价 系统状态已恢复" : "商圈比价 系统提醒",
      `事项: ${summary}`,
      labels.worker_id ? `设备: ${labels.worker_id}` : "",
      labels.store_name ? `门店: ${labels.store_name}` : "",
      `级别: ${severity}`,
      `状态: ${status === "resolved" ? "已恢复" : "需要关注"}`
    ].filter(Boolean).join("\n"));

    return {
      dedupeKey: `monitoring:${fingerprint}:${status}`,
      channel: "dingtalk",
      eventType: `monitoring.alert.${status}`,
      message,
      payload: {
        alertName,
        severity,
        status,
        fingerprint,
        startsAt: alert.startsAt,
        endsAt: alert.endsAt
      }
    };
  });
}
