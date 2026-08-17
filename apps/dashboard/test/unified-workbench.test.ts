import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isBlockedTask, isCompletedTask, isRunningTask } from "../src/command-center.js";

test("production task states are grouped consistently on the command center", () => {
  assert.equal(isCompletedTask("completed_valid"), true);
  assert.equal(isRunningTask("collecting"), true);
  assert.equal(isRunningTask("validating"), true);
  assert.equal(isBlockedTask("needs_review"), true);
  assert.equal(isCompletedTask("needs_review"), false);
});

test("dashboard exposes one unified workbench instead of a persisted mode switch", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /retail-radar-workbench/);
  assert.doesNotMatch(source, /<BusinessWorkbench/);
  assert.match(source, /调度总览/);
  assert.doesNotMatch(source, /作战指挥大盘/);
  assert.match(source, /采集设备/);
  assert.match(source, /风险处理/);
  assert.match(source, /数据结果/);
  assert.match(source, /实时采集进度/);
  assert.doesNotMatch(source, /Master: 17890/);
  assert.doesNotMatch(source, /返回采集工作台/);
});

test("command center leads with deduplicated products instead of sku variants", async () => {
  const source = await readFile(new URL("../src/command-center.tsx", import.meta.url), "utf8");

  assert.match(source, /label="当前有效商品"/);
  assert.match(source, /value=\{formatNumber\(productSummary\.productCount\)\}/);
  assert.match(source, /SKU 规格/);
  assert.doesNotMatch(source, /label="当前有效 SKU"/);
});
