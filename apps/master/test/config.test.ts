import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDingTalkWebhookUrl } from "../src/config.js";

test("钉钉机器人占位值按未配置处理", () => {
  assert.equal(
    normalizeDingTalkWebhookUrl("https://oapi.dingtalk.com/robot/send?access_token=REPLACE_BEFORE_GO_LIVE"),
    undefined
  );
});

test("钉钉机器人只允许官方 HTTPS Webhook", () => {
  assert.equal(
    normalizeDingTalkWebhookUrl("https://oapi.dingtalk.com/robot/send?access_token=example-token"),
    "https://oapi.dingtalk.com/robot/send?access_token=example-token"
  );
  assert.throws(() => normalizeDingTalkWebhookUrl("http://oapi.dingtalk.com/robot/send?access_token=x"), /invalid_dingtalk_webhook/);
  assert.throws(() => normalizeDingTalkWebhookUrl("https://example.com/robot/send?access_token=x"), /invalid_dingtalk_webhook/);
});
