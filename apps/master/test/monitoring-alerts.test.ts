import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  buildMonitoringNotifications,
  isMonitoringAlertAuthorized
} from "../src/monitoring-alerts.js";

test("monitoring receiver requires the configured bearer token", () => {
  assert.equal(bearerToken("Bearer secret-token"), "secret-token");
  assert.equal(bearerToken("Basic abc"), undefined);
  assert.equal(isMonitoringAlertAuthorized("secret-token", "secret-token"), true);
  assert.equal(isMonitoringAlertAuthorized("wrong", "secret-token"), false);
  assert.equal(isMonitoringAlertAuthorized(undefined, "secret-token"), false);
  assert.equal(isMonitoringAlertAuthorized("secret-token", undefined), false);
});

test("monitoring alerts create concise deduplicated DingTalk drafts", () => {
  const [draft] = buildMonitoringNotifications({
    status: "firing",
    commonLabels: { severity: "critical" },
    alerts: [{
      status: "firing",
      fingerprint: "abc123",
      labels: { alertname: "RetailRadarWorkerHeartbeatStale", worker_id: "worker-66" },
      annotations: { summary: "采集设备状态超过 2 分钟未更新" },
      startsAt: "2026-08-17T10:00:00.000Z"
    }]
  });

  assert.equal(draft.dedupeKey, "monitoring:abc123:firing");
  assert.equal(draft.eventType, "monitoring.alert.firing");
  assert.match(draft.message, /worker-66/);
  assert.match(draft.message, /需要关注/);
});

test("resolved alert uses a separate dedupe key", () => {
  const [draft] = buildMonitoringNotifications({
    status: "resolved",
    alerts: [{ status: "resolved", fingerprint: "abc123", labels: { alertname: "Example" } }]
  });
  assert.equal(draft.dedupeKey, "monitoring:abc123:resolved");
  assert.match(draft.message, /已恢复/);
});

test("monitoring payload without alerts is rejected", () => {
  assert.throws(() => buildMonitoringNotifications({ alerts: [] }), /monitoring_alerts_required/);
});
