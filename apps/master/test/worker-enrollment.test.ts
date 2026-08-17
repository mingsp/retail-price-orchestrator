import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpaqueToken,
  evaluateEnrollmentToken,
  hashSecret,
  secretMatchesHash
} from "../src/repositories/worker-enrollment.js";

test("worker and enrollment tokens are opaque and use different prefixes", () => {
  const enrollmentToken = createOpaqueToken("enr");
  const workerToken = createOpaqueToken("rwk");

  assert.match(enrollmentToken, /^enr_[A-Za-z0-9_-]{40,}$/);
  assert.match(workerToken, /^rwk_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(enrollmentToken, workerToken);
});

test("only a deterministic hash is persisted for a worker secret", () => {
  const secret = "rwk_example-secret-that-must-not-be-stored";
  const hash = hashSecret(secret);

  assert.equal(hash.length, 64);
  assert.doesNotMatch(hash, /example-secret/);
  assert.equal(secretMatchesHash(secret, hash), true);
  assert.equal(secretMatchesHash(`${secret}-wrong`, hash), false);
});

test("an unused unexpired enrollment token is eligible", () => {
  const result = evaluateEnrollmentToken({
    expiresAt: new Date("2026-07-15T12:00:00.000Z"),
    maxUses: 1,
    usedCount: 0,
    revokedAt: null
  }, new Date("2026-07-15T11:59:59.000Z"));

  assert.deepEqual(result, { eligible: true });
});

test("expired revoked and exhausted enrollment tokens are rejected explicitly", () => {
  assert.deepEqual(evaluateEnrollmentToken({
    expiresAt: new Date("2026-07-15T11:00:00.000Z"), maxUses: 1, usedCount: 0, revokedAt: null
  }, new Date("2026-07-15T11:00:00.000Z")), { eligible: false, reason: "expired" });

  assert.deepEqual(evaluateEnrollmentToken({
    expiresAt: new Date("2026-07-15T12:00:00.000Z"), maxUses: 1, usedCount: 0,
    revokedAt: new Date("2026-07-15T10:00:00.000Z")
  }, new Date("2026-07-15T11:00:00.000Z")), { eligible: false, reason: "revoked" });

  assert.deepEqual(evaluateEnrollmentToken({
    expiresAt: new Date("2026-07-15T12:00:00.000Z"), maxUses: 1, usedCount: 1, revokedAt: null
  }, new Date("2026-07-15T11:00:00.000Z")), { eligible: false, reason: "exhausted" });
});
