import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const doctorPath = fileURLToPath(new URL("../scripts/doctor.mjs", import.meta.url));

test("doctor detects Node when the executable path contains spaces", { skip: process.platform !== "win32" }, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "retail radar doctor "));
  const copiedNode = path.join(temporaryRoot, path.basename(process.execPath));
  try {
    await copyFile(process.execPath, copiedNode);
    const execution = spawnSync(copiedNode, [doctorPath, "--json"], {
      cwd: path.dirname(path.dirname(doctorPath)),
      encoding: "utf8",
      windowsHide: true
    });
    const report = JSON.parse(execution.stdout);
    const nodeCheck = report.checks.find((check) => check.id === "node");

    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(nodeCheck?.status, "pass");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
