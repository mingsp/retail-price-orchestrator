import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildArtifactObjectKey, buildNativeArtifactUploadPlan, hashFile } from "../src/artifact-uploader.js";

test("buildArtifactObjectKey prefixes store run task and native run id", () => {
  const objectKey = buildArtifactObjectKey(
    { storeId: "store-1", runId: "run-1", taskId: "task-1" },
    "worker-1-task-1",
    path.join("tmp", "worker-1-task-1.summary.json")
  );

  assert.equal(objectKey, "store-1/run-1/task-1/worker-1-task-1-worker-1-task-1.summary.json");
});

test("buildNativeArtifactUploadPlan keeps native artifact kinds stable", () => {
  const plan = buildNativeArtifactUploadPlan(
    { storeId: "store-1", runId: "run-1", taskId: "task-1" },
    "worker-1-task-1",
    {
      raw: "capture.products.raw.jsonl",
      progress: "capture.progress.jsonl",
      checkpoint: "capture.checkpoint.json",
      summary: "capture.summary.json",
      categories: "capture.categories.jsonl"
    }
  );

  assert.deepEqual(
    plan.map((item) => [item.artifactPart, item.kind, item.contentType]),
    [
      ["raw", "raw_jsonl", "application/jsonl"],
      ["progress", "log", "application/jsonl"],
      ["checkpoint", "log", "application/json"],
      ["summary", "log", "application/json"],
      ["categories", "log", "application/jsonl"]
    ]
  );
  assert.equal(plan[0]?.metadata.sourceFile, "capture.products.raw.jsonl");
});

test("hashFile computes a streaming SHA-256 without changing the file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retail-artifact-hash-"));
  const file = path.join(root, "raw.jsonl");
  const content = Buffer.from("first\nsecond\n", "utf8");
  await writeFile(file, content);
  assert.equal(await hashFile(file), createHash("sha256").update(content).digest("hex"));
});
