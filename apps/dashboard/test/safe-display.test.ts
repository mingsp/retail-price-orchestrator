import assert from "node:assert/strict";
import test from "node:test";
import { artifactDisplayName, safeOperationalText } from "../src/safe-display.js";

test("operational text hides local paths urls and internal request codes", () => {
  const input = "resume=F:\\work\\capture\\risk-resume.ok url=https://example.test/store request_code=abc123";
  const output = safeOperationalText(input);
  assert.doesNotMatch(output, /F:\\work/);
  assert.doesNotMatch(output, /https:\/\//);
  assert.doesNotMatch(output, /abc123/);
  assert.match(output, /本地文件已保留/);
});

test("artifacts use business names instead of object keys", () => {
  assert.equal(artifactDisplayName("raw_jsonl"), "商品原始数据");
  assert.equal(artifactDisplayName("screenshot"), "异常现场截图");
});
