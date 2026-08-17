import assert from "node:assert/strict";
import test from "node:test";
import { isAccountPoolEligible } from "../src/repositories/account-claim-eligibility.js";

const now = new Date("2026-08-17T10:00:00.000Z");

test("available and correctly reserved accounts may claim", () => {
  assert.equal(isAccountPoolEligible({ status: "available", riskLevel: "normal" }, now), true);
  assert.equal(isAccountPoolEligible({ status: "reserved", riskLevel: "watch" }, now), true);
});

test("cooldown, risk, retired, future availability and missing registry block claim", () => {
  assert.equal(isAccountPoolEligible(undefined, now), false);
  assert.equal(isAccountPoolEligible({ status: "cooldown", riskLevel: "normal" }, now), false);
  assert.equal(isAccountPoolEligible({ status: "risk", riskLevel: "blocked" }, now), false);
  assert.equal(isAccountPoolEligible({ status: "retired", riskLevel: "normal" }, now), false);
  assert.equal(isAccountPoolEligible({
    status: "available",
    riskLevel: "normal",
    availableAfter: "2026-08-17T11:00:00.000Z"
  }, now), false);
});
