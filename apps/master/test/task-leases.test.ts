import assert from "node:assert/strict";
import test from "node:test";
import { isLeaseGuardValid } from "../src/repositories/task-leases.js";

test("lease guard rejects a stale worker generation", () => {
  assert.equal(isLeaseGuardValid("mm-worker", 8, "mm-worker", 7), false);
  assert.equal(isLeaseGuardValid("mm-worker", 8, "mm-worker", 8), true);
  assert.equal(isLeaseGuardValid("jl-worker", 8, "mm-worker", 8), false);
});
