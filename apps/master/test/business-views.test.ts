import assert from "node:assert/strict";
import test from "node:test";
import { containsTechnicalField, toBusinessActivity, toBusinessIssue } from "../src/repositories/business-views.js";

test("business activity translates task state without leaking infrastructure fields", () => {
  const activity = toBusinessActivity({
    task_id: "task-1",
    store_name: "乐购达景耀店",
    category_name: "饮料",
    status: "collecting",
    collected_items: 320,
    updated_at: new Date("2026-07-10T01:00:00.000Z"),
    assigned_worker_id: "mm-worker",
    assigned_profile_id: "profile-secret",
    assigned_cdp_endpoint_id: "mm:9256"
  });

  assert.match(activity.message, /乐购达景耀店/);
  assert.match(activity.message, /饮料/);
  assert.match(activity.message, /320/);
  assert.equal(containsTechnicalField(activity), false);
});

test("business issue gives an operator action without raw errors or account identity", () => {
  const issue = toBusinessIssue({
    risk_id: "risk-1",
    store_name: "呱呱超市莲湖店",
    category_name: "乳品",
    risk_type: "identity_check",
    severity: "high",
    observed: "raw 403 payload with internal endpoint",
    account_id: "secret-account",
    profile_id: "secret-profile",
    created_at: new Date("2026-07-10T01:00:00.000Z")
  });

  assert.equal(issue.message, "该门店当前需要人工确认，已保留采集断点。");
  assert.equal(issue.actionLabel, "去处理");
  assert.equal(containsTechnicalField(issue), false);
});
