import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { replayProgressFile } from "../src/progress-reporter.js";

test("replayProgressFile only replays progress lines not already seen", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "retail-progress-"));
  const file = path.join(dir, "task.progress.jsonl");
  const first = JSON.stringify({ event: "started", taskId: "task-1" });
  const second = JSON.stringify({ event: "task_progress", taskId: "task-1", collectedItems: 12 });
  await fs.writeFile(file, `${first}\n\n${second}\n`, "utf8");

  const replayed: string[] = [];
  const result = await replayProgressFile(file, {
    seenLines: new Set([first]),
    onLine: async (line) => {
      replayed.push(line);
    }
  });

  assert.deepEqual(replayed, [second]);
  assert.deepEqual(result, { replayed: 1, skipped: 1 });
});

test("replayProgressFile skips missing progress files", async () => {
  const result = await replayProgressFile(path.join(os.tmpdir(), "missing-progress-file.jsonl"), {
    seenLines: new Set(),
    onLine: async () => {
      throw new Error("missing file should not replay lines");
    }
  });

  assert.deepEqual(result, { replayed: 0, skipped: 0 });
});
