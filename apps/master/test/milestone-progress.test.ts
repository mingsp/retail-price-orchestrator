import assert from "node:assert/strict";
import test from "node:test";
import { calculateValidatedMilestones } from "../src/routes/tasks.js";

test("legacy completed tasks never trigger a 100 percent milestone", () => {
  const result = calculateValidatedMilestones([
    { status: "completed", collectedItems: 100 },
    { status: "completed", collectedItems: 120 }
  ]);

  assert.equal(result.percent, 0);
  assert.deepEqual(result.thresholds, []);
});

test("100 percent milestone requires every category completed_valid", () => {
  const result = calculateValidatedMilestones([
    { status: "completed_valid", collectedItems: 100 },
    { status: "completed_valid", collectedItems: 120 }
  ]);

  assert.equal(result.percent, 100);
  assert.deepEqual(result.thresholds, [50, 100]);
});
