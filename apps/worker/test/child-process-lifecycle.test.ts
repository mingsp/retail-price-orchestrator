import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { collectorProcessGroupOptions, terminateChildProcessTree, waitForChildClose } from "../src/child-process-lifecycle.js";

test("collector process tree is terminated and close remains observable", async () => {
  const script = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "console.log(child.pid);",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], {
    ...collectorProcessGroupOptions(),
    stdio: ["ignore", "pipe", "ignore"]
  });
  const closed = waitForChildClose(child);
  const grandchildPid = await new Promise<number>((resolve, reject) => {
    child.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    child.once("error", reject);
  });

  await terminateChildProcessTree(child, 50);
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(isProcessRunning(child.pid), false);
  assert.equal(isProcessRunning(grandchildPid), false);
});

function isProcessRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
