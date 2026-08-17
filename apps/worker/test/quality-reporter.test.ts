import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findQualityManifestPath, normalizeQualityManifest } from "../src/quality-reporter.js";

test("normalizeQualityManifest accepts plain quality payload and fills defaults", () => {
  const payload = normalizeQualityManifest(
    {
      rawRows: 12,
      uniqueSpuCount: 10,
      skuRows: 14,
      frontDisplayPricePresent: 12,
      skuFrontDisplayPricePresent: 13,
      completenessStatus: "pass",
      metadata: { source: "local" }
    },
    { taskId: "task-1", runId: "run-1", artifactId: "artifact-1" }
  );

  assert.equal(payload.taskId, "task-1");
  assert.equal(payload.runId, "run-1");
  assert.equal(payload.artifactId, "artifact-1");
  assert.equal(payload.rawRows, 12);
  assert.deepEqual(payload.metadata, { source: "local" });
});

test("normalizeQualityManifest unwraps embedded quality objects", () => {
  const payload = normalizeQualityManifest({
    quality: {
      rawRows: 20,
      uniqueSpuCount: 18,
      skuRows: 24,
      frontDisplayPricePresent: 20,
      skuFrontDisplayPricePresent: 24,
      actualPriceInfoPresent: 18,
      completenessStatus: "warn"
    }
  });

  assert.equal(payload.completenessStatus, "warn");
  assert.equal(payload.actualPriceInfoPresent, 18);
});

test("findQualityManifestPath prefers explicit summary metadata path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "retail-quality-"));
  const qualityPath = path.join(dir, "export.quality.json");
  const summaryPath = path.join(dir, "capture.summary.json");
  await fs.writeFile(qualityPath, JSON.stringify({ rawRows: 1, uniqueSpuCount: 1, skuRows: 1, frontDisplayPricePresent: 1, skuFrontDisplayPricePresent: 1, completenessStatus: "pass" }), "utf8");
  await fs.writeFile(summaryPath, JSON.stringify({ metadata: { qualityPath: "./export.quality.json" } }), "utf8");

  assert.equal(await findQualityManifestPath(summaryPath), qualityPath);
});

test("findQualityManifestPath falls back to summary file when it already contains quality payload", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "retail-quality-summary-"));
  const summaryPath = path.join(dir, "capture.summary.json");
  await fs.writeFile(
    summaryPath,
    JSON.stringify({
      quality: {
        rawRows: 2,
        uniqueSpuCount: 2,
        skuRows: 2,
        frontDisplayPricePresent: 2,
        skuFrontDisplayPricePresent: 2,
        completenessStatus: "pass"
      }
    }),
    "utf8"
  );

  assert.equal(await findQualityManifestPath(summaryPath), summaryPath);
});
