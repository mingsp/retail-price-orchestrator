import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveVisibleCdpEndpointStatus,
  resolveAuthoritativeBinding,
  resolveAuthoritativeSlotStatus
} from "../src/repositories/cdp-endpoints.js";

test("a bound Browser Slot overrides an omitted heartbeat identity", () => {
  assert.equal(resolveAuthoritativeBinding("account", "account-fixed", undefined), "account-fixed");
  assert.equal(resolveAuthoritativeBinding("profile", "profile-fixed", undefined), "profile-fixed");
  assert.equal(resolveAuthoritativeBinding("store", "store-fixed", undefined), "store-fixed");
});

test("a heartbeat cannot replace a Browser Slot fixed identity", () => {
  assert.throws(
    () => resolveAuthoritativeBinding("account", "account-fixed", "account-reported"),
    /slot_account_mismatch/
  );
  assert.throws(
    () => resolveAuthoritativeBinding("profile", "profile-fixed", "profile-reported"),
    /slot_profile_mismatch/
  );
  assert.throws(
    () => resolveAuthoritativeBinding("store", "store-fixed", "store-reported"),
    /slot_store_mismatch/
  );
});

test("an unbound Browser Slot can report identity for operator discovery", () => {
  assert.equal(resolveAuthoritativeBinding("account", null, "account-observed"), "account-observed");
  assert.equal(resolveAuthoritativeBinding("profile", null, "profile-observed"), "profile-observed");
  assert.equal(resolveAuthoritativeBinding("store", null, "store-observed"), "store-observed");
});

test("a retired Browser Slot cannot be reactivated by heartbeat status", () => {
  assert.equal(resolveAuthoritativeSlotStatus("retired", "ready"), "retired");
  assert.equal(resolveAuthoritativeSlotStatus("retired", "running"), "retired");
  assert.equal(resolveAuthoritativeSlotStatus("idle", "ready"), "ready");
});

test("a stale observed CDP can never remain visibly ready", () => {
  const now = new Date("2026-08-11T10:00:00.000Z");

  assert.equal(deriveVisibleCdpEndpointStatus("ready", "2026-08-11T09:59:30.000Z", now), "ready");
  assert.equal(deriveVisibleCdpEndpointStatus("ready", "2026-08-11T09:55:00.000Z", now), "unknown");
  assert.equal(deriveVisibleCdpEndpointStatus("running", "invalid", now), "unknown");
  assert.equal(deriveVisibleCdpEndpointStatus("idle", "2026-08-11T09:55:00.000Z", now), "idle");
  assert.equal(deriveVisibleCdpEndpointStatus("manual_required", "2026-08-11T09:55:00.000Z", now), "manual_required");
  assert.equal(deriveVisibleCdpEndpointStatus("profile_risk", "2026-08-11T09:55:00.000Z", now), "profile_risk");
  assert.equal(deriveVisibleCdpEndpointStatus("retired", "2026-08-11T09:55:00.000Z", now), "retired");
});
