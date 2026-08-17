import assert from "node:assert/strict";
import test from "node:test";
import {
  maskLoginIdentifier,
  normalizeCreateAccountPoolInput,
  normalizeUpdateAccountPoolInput
} from "../src/repositories/account-pool.js";

test("account pool masks a complete phone identifier before persistence", () => {
  assert.equal(maskLoginIdentifier("13800138000"), "138****8000");
  assert.equal(maskLoginIdentifier("138****8000"), "138****8000");
});

test("account pool requires an alias masked login and owner", () => {
  assert.deepEqual(normalizeCreateAccountPoolInput({
    displayName: "账号 A01",
    maskedLogin: "138****8000",
    operatorOwner: "运营一组"
  }), {
    displayName: "账号 A01",
    maskedLogin: "138****8000",
    operatorOwner: "运营一组",
    note: undefined
  });
  assert.throws(() => normalizeCreateAccountPoolInput({
    displayName: "",
    maskedLogin: "138****8000",
    operatorOwner: "运营一组"
  }), /display_name_required/);
});

test("account pool accepts only production lifecycle states and valid cooldown timestamps", () => {
  assert.deepEqual(normalizeUpdateAccountPoolInput({
    status: "cooldown",
    riskLevel: "watch",
    availableAfter: "2026-08-12T04:00:00.000Z"
  }), {
    status: "cooldown",
    riskLevel: "watch",
    availableAfter: "2026-08-12T04:00:00.000Z"
  });
  assert.throws(() => normalizeUpdateAccountPoolInput({ status: "debug" as any }), /invalid_account_pool_status/);
  assert.throws(() => normalizeUpdateAccountPoolInput({ availableAfter: "not-a-date" }), /invalid_available_after/);
});
