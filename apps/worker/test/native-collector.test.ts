import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNativeRunIdentity,
  normalizeNativeSummaryStatus,
  resolveNativeFinalStatus,
  resolveNativeProgressStatus
} from "../src/native-collector.js";

test("resolveNativeFinalStatus preserves manual_required after a recovered risk event", () => {
  assert.equal(resolveNativeFinalStatus(0, true), "manual_required");
  assert.equal(resolveNativeFinalStatus(1, true), "manual_required");
});

test("resolveNativeFinalStatus follows the native exit code without risk events", () => {
  assert.equal(resolveNativeFinalStatus(0, false), "captured");
  assert.equal(resolveNativeFinalStatus(1, false), "failed");
});

test("resolveNativeFinalStatus never promotes an incomplete capture", () => {
  assert.equal(resolveNativeFinalStatus(0, false, "incomplete"), "failed");
});

test("native summary parser preserves the incomplete collector status", () => {
  assert.equal(normalizeNativeSummaryStatus("incomplete"), "incomplete");
  assert.equal(normalizeNativeSummaryStatus("completed"), "completed");
  assert.equal(normalizeNativeSummaryStatus("unexpected"), undefined);
});

test("category_done remains collecting until artifacts and quality are durable", () => {
  assert.equal(resolveNativeProgressStatus({ event: "category_done", completed: true }), "collecting");
  assert.equal(resolveNativeProgressStatus({ event: "task_progress" }), "collecting");
});

test("buildNativeRunIdentity separates business run id from capture id", () => {
  assert.deepEqual(buildNativeRunIdentity("run-uuid", "task-uuid", "mm-worker"), {
    runId: "run-uuid",
    captureId: "mm-worker-task-uuid"
  });
});

test("buildNativeRunIdentity isolates a corrective retry from contaminated output", () => {
  assert.deepEqual(buildNativeRunIdentity("run-uuid", "task-uuid", "mm-worker", "semantic-fix-20260713"), {
    runId: "run-uuid",
    captureId: "mm-worker-task-uuid-semantic-fix-20260713"
  });
});

test("buildNativeRunIdentity can preserve a prior worker capture for checkpoint migration", () => {
  assert.deepEqual(
    buildNativeRunIdentity("run-uuid", "task-uuid", "mm-worker", undefined, "jl-worker-task-uuid"),
    { runId: "run-uuid", captureId: "jl-worker-task-uuid" }
  );
});
