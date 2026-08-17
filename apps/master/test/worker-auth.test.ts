import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWorkerIdentity,
  authenticateWorkerBearer,
  isLegacyWorkerTokenAllowed
} from "../src/worker-auth.js";
import { hashSecret } from "../src/repositories/worker-enrollment.js";

test("an individual bearer token resolves to exactly one worker", async () => {
  const token = "rwk_worker-a-secret";
  const auth = await authenticateWorkerBearer(token, {
    allowLegacySharedToken: false,
    legacySharedToken: "legacy-secret",
    findWorkerByTokenHash: async (tokenHash) => tokenHash === hashSecret(token) ? "worker-a" : undefined
  });

  assert.deepEqual(auth, { workerId: "worker-a", legacy: false });
  assert.doesNotThrow(() => assertWorkerIdentity(auth, "worker-a"));
  assert.throws(() => assertWorkerIdentity(auth, "worker-b"), /worker_identity_mismatch/);
});

test("unknown individual credentials are rejected", async () => {
  const auth = await authenticateWorkerBearer("rwk_unknown", {
    allowLegacySharedToken: false,
    legacySharedToken: "legacy-secret",
    findWorkerByTokenHash: async () => undefined
  });

  assert.equal(auth, undefined);
});

test("legacy shared token requires an explicit migration switch", async () => {
  const lookup = async () => undefined;
  assert.equal(isLegacyWorkerTokenAllowed("legacy-secret", "legacy-secret", true), true);
  assert.equal(isLegacyWorkerTokenAllowed("legacy-secret", "legacy-secret", false), false);
  assert.equal(isLegacyWorkerTokenAllowed("change-me", "change-me", true), false);

  assert.deepEqual(await authenticateWorkerBearer("legacy-secret", {
    allowLegacySharedToken: true,
    legacySharedToken: "legacy-secret",
    findWorkerByTokenHash: lookup
  }), { legacy: true });
});
