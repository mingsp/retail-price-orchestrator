import assert from "node:assert/strict";
import test from "node:test";
import { buildRawArtifactCoverageBlockers } from "../src/repositories/deliveries.js";

test("delivery freeze requires a raw JSONL artifact for every effective category", () => {
  const blockers = buildRawArtifactCoverageBlockers([
    { taskId: "task-food", categoryName: "食品", artifactId: "artifact-food" },
    { taskId: "task-drink", categoryName: "饮料" }
  ]);

  assert.deepEqual(blockers, ["有效类目「饮料」缺少对应的原始 JSONL 产物（task-drink）。"]);
});

test("excluded categories are absent from the effective category artifact gate", () => {
  assert.deepEqual(buildRawArtifactCoverageBlockers([
    { taskId: "task-food", categoryName: "食品", artifactId: "artifact-food" }
  ]), []);
});
