import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTaskQuality } from "../src/repositories/quality-evaluator.js";

const completeFacts = {
  taskStatus: "validating" as const,
  artifactVerified: true,
  rawRows: 120,
  uniqueSpuCount: 118,
  skuRows: 145,
  frontDisplayPricePresent: 120,
  categoryComplete: true
};

test("master passes a complete category backed by a verified raw artifact", () => {
  assert.deepEqual(evaluateTaskQuality(completeFacts), { status: "pass", reasons: [] });
});

test("worker-declared pass cannot hide incomplete price facts", () => {
  const result = evaluateTaskQuality({ ...completeFacts, frontDisplayPricePresent: 119 });
  assert.equal(result.status, "warn");
  assert.deepEqual(result.reasons, ["front_display_price_incomplete"]);
});

test("missing raw evidence or terminal category evidence is a hard failure", () => {
  assert.equal(evaluateTaskQuality({ ...completeFacts, artifactVerified: false }).status, "fail");
  assert.equal(evaluateTaskQuality({ ...completeFacts, categoryComplete: false }).status, "fail");
  assert.equal(evaluateTaskQuality({ ...completeFacts, rawRows: 0 }).status, "fail");
});

test("stale expected item count creates review instead of a fake 100 percent", () => {
  const result = evaluateTaskQuality({ ...completeFacts, expectedItems: 130 });
  assert.equal(result.status, "warn");
  assert.ok(result.reasons.includes("expected_item_shortfall"));
});
