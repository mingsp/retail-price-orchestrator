import assert from "node:assert/strict";
import test from "node:test";
import { applyScopeGate, calculateRunProgress } from "../src/repositories/run-progress.js";

test("a run cannot be deliverable without a frozen and matching scope", () => {
  const complete = calculateRunProgress([
    { status: "completed_valid", collectedItems: 10, qualityStatus: "pass" }
  ]);

  assert.equal(complete.isDeliverable, true);
  assert.equal(applyScopeGate(complete, false, false).isDeliverable, false);
  assert.equal(applyScopeGate(complete, true, false).isDeliverable, false);
  assert.equal(applyScopeGate(complete, true, true).isDeliverable, true);
});

test("run stays running until every category passes durable validation", () => {
  const progress = calculateRunProgress([
    { status: "completed_valid", collectedItems: 120, expectedItems: 120, qualityStatus: "pass" },
    { status: "collecting", collectedItems: 60, expectedItems: 100 },
    { status: "needs_review", collectedItems: 30, expectedItems: 40, qualityStatus: "fail" }
  ]);

  assert.equal(progress.status, "running");
  assert.equal(progress.completedCategories, 1);
  assert.equal(progress.attentionCategories, 1);
  assert.equal(progress.categoryCompletionPercent, 33);
  assert.equal(progress.isDeliverable, false);
});

test("unknown estimates never become a false 100 percent before validation", () => {
  const progress = calculateRunProgress([
    { status: "collecting", collectedItems: 280 },
    { status: "captured", collectedItems: 220 }
  ]);

  assert.equal(progress.expectedItemsKnown, false);
  assert.equal(progress.itemProgressPercent, undefined);
  assert.equal(progress.categoryCompletionPercent, 0);
  assert.equal(progress.isDeliverable, false);
});

test("run completes only when all categories are completed_valid", () => {
  const progress = calculateRunProgress([
    { status: "completed_valid", collectedItems: 120, qualityStatus: "pass" },
    { status: "completed_valid", collectedItems: 220, qualityStatus: "warn" }
  ]);

  assert.equal(progress.status, "completed");
  assert.equal(progress.categoryCompletionPercent, 100);
  assert.equal(progress.isDeliverable, true);
  assert.equal(progress.collectedItems, 340);
  assert.equal(progress.itemProgressPercent, undefined);
});

test("zero or missing estimates never become a product 100 percent", () => {
  const progress = calculateRunProgress([
    { status: "completed_valid", collectedItems: 12, expectedItems: 0, qualityStatus: "pass" }
  ]);

  assert.equal(progress.categoryCompletionPercent, 100);
  assert.equal(progress.expectedItemsKnown, false);
  assert.equal(progress.itemProgressPercent, undefined);
});

test("an evidenced non-product entry resolves the run without fabricating product validation", () => {
  const progress = calculateRunProgress([
    { status: "completed_valid", collectedItems: 120, qualityStatus: "pass" },
    { status: "skipped", collectedItems: 0, exclusionEvidence: true }
  ]);

  assert.equal(progress.status, "completed");
  assert.equal(progress.completedCategories, 2);
  assert.equal(progress.validatedCategories, 1);
  assert.equal(progress.excludedCategories, 1);
  assert.equal(progress.categoryCompletionPercent, 100);
  assert.equal(progress.isDeliverable, true);
});

test("a skipped category without evidence never completes a run", () => {
  const progress = calculateRunProgress([
    { status: "completed_valid", collectedItems: 120, qualityStatus: "pass" },
    { status: "skipped", collectedItems: 0 }
  ]);

  assert.equal(progress.completedCategories, 1);
  assert.equal(progress.excludedCategories, 0);
  assert.equal(progress.isDeliverable, false);
});
