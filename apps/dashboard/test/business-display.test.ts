import assert from "node:assert/strict";
import test from "node:test";
import { businessRunStatus, deliveryStatus } from "../src/business-display.js";

test("business labels never fall back to technical status names", () => {
  assert.equal(businessRunStatus("running"), "采集中");
  assert.equal(businessRunStatus("paused"), "等待处理");
  assert.equal(deliveryStatus("checking"), "完整性核对中");
  assert.equal(deliveryStatus("attention"), "需要处理");
});
