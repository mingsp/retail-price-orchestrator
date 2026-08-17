import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRiskNotification,
  classifyDingTalkDelivery,
  deliverNotification,
  dispatchNextNotification,
  type NotificationDelivery
} from "../src/notification-outbox.js";

test("risk notification uses a stable dedupe key and removes restricted details", () => {
  const notification = buildRiskNotification({
    riskId: "risk-1",
    severity: "high",
    riskType: "verification_required",
    workerId: "worker-44",
    accountId: "account-13800138000",
    profileId: "C:\\Users\\ops\\profile-01",
    cdpPort: 9421,
    storeName: "测试门店",
    categoryName: "饮料",
    observed: "请打开 https://oapi.dingtalk.com/robot/send?access_token=secret 处理",
    recommendedAction: "人工处理",
    status: "open",
    createdAt: "2026-08-06T12:00:00.000Z"
  });

  assert.equal(notification.dedupeKey, "risk:risk-1:opened");
  assert.match(notification.message, /worker-44/);
  assert.match(notification.message, /138\*{4}8000/);
  assert.doesNotMatch(notification.message, /13800138000/);
  assert.doesNotMatch(notification.message, /C:\\Users/);
  assert.doesNotMatch(notification.message, /access_token/);
});

test("DingTalk HTTP 200 is successful only when errcode is zero", () => {
  assert.deepEqual(classifyDingTalkDelivery(200, { errcode: 0, errmsg: "ok" }), {
    status: "sent",
    providerCode: "0",
    providerMessage: "ok"
  });
  assert.deepEqual(classifyDingTalkDelivery(200, { errcode: 310000, errmsg: "keywords not in content" }), {
    status: "retryable_failure",
    providerCode: "310000",
    providerMessage: "keywords not in content"
  });
});

test("network timeout becomes outcome_unknown and is never treated as retryable", async () => {
  const delivery: NotificationDelivery = {
    notificationId: "notification-1",
    dedupeKey: "risk:risk-1:opened",
    channel: "dingtalk",
    eventType: "risk.opened",
    message: "商圈比价 风险提醒",
    attemptCount: 0
  };

  const result = await deliverNotification(delivery, async () => {
    const error = new Error("request timed out");
    error.name = "AbortError";
    throw error;
  });

  assert.equal(result.status, "outcome_unknown");
  assert.equal(result.retryable, false);
});

test("dispatcher records a timeout as outcome_unknown without scheduling retry", async () => {
  const calls: string[] = [];
  const delivery: NotificationDelivery = {
    notificationId: "notification-1",
    dedupeKey: "risk:risk-1:opened",
    channel: "dingtalk",
    eventType: "risk.opened",
    message: "商圈比价 风险提醒",
    attemptCount: 1
  };

  const processed = await dispatchNextNotification({
    claimNext: async () => delivery,
    markSent: async () => calls.push("sent"),
    markRetryableFailure: async () => calls.push("retry"),
    markOutcomeUnknown: async () => calls.push("unknown")
  }, async () => {
    throw new Error("socket closed after write");
  });

  assert.equal(processed, true);
  assert.deepEqual(calls, ["unknown"]);
});

test("dispatcher schedules a bounded retry for a confirmed provider rejection", async () => {
  const calls: string[] = [];
  const delivery: NotificationDelivery = {
    notificationId: "notification-2",
    dedupeKey: "risk:risk-2:opened",
    channel: "dingtalk",
    eventType: "risk.opened",
    message: "商圈比价 风险提醒",
    attemptCount: 1
  };

  await dispatchNextNotification({
    claimNext: async () => delivery,
    markSent: async () => calls.push("sent"),
    markRetryableFailure: async () => calls.push("retry"),
    markOutcomeUnknown: async () => calls.push("unknown")
  }, async () => ({ statusCode: 429, body: { errcode: 130101, errmsg: "too many requests" } }));

  assert.deepEqual(calls, ["retry"]);
});
