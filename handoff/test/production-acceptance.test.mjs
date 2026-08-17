import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/verify-production-acceptance.mjs");

test("production acceptance rejects unchecked gates and accepts complete evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "retail-acceptance-"));
  const file = path.join(root, "acceptance.json");
  const record = {
    release: { tag: "v0.2.0", commit: "a".repeat(40), schemaVersion: "2026-08-17-p0.1" },
    operator: "交接操作员",
    reviewer: "生产负责人",
    level: "L4",
    completedAt: "2026-08-17T08:00:00.000Z",
    gates: {
      offlineVerification: true,
      bindingVerified: true,
      canaryCompleted: true,
      riskInterventionCompleted: true,
      checkpointResumeCompleted: true,
      fullStoreRunCompleted: true,
      rawArtifactTraceability: true,
      databaseAndExcelTraceability: true,
      rollbackTargetVerified: false
    },
    evidence: [{ id: "run-1", type: "run_report", reference: "internal:run-1", sha256: "b".repeat(64) }]
  };
  await writeFile(file, JSON.stringify(record));
  const rejected = spawnSync(process.execPath, [script, "--file", file], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /rollbackTargetVerified/);

  record.gates.rollbackTargetVerified = true;
  await writeFile(file, JSON.stringify(record));
  const accepted = spawnSync(process.execPath, [script, "--file", file], { encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).status, "pass");
});
