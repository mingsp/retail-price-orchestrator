import assert from "node:assert/strict";
import test from "node:test";
import { DATABASE_SCHEMA_VERSION, readReleaseInfo } from "../src/release-info.js";

test("release identity exposes immutable build and schema coordinates", () => {
  assert.deepEqual(readReleaseInfo({
    RETAIL_RADAR_VERSION: "1.2.3",
    RETAIL_RADAR_GIT_SHA: "abc123",
    RETAIL_RADAR_BUILT_AT: "2026-08-17T00:00:00.000Z",
    RETAIL_RADAR_SCHEMA_VERSION: "schema-7"
  }), {
    service: "retail-radar-master",
    version: "1.2.3",
    gitSha: "abc123",
    builtAt: "2026-08-17T00:00:00.000Z",
    schemaVersion: "schema-7"
  });
  assert.equal(readReleaseInfo({}).schemaVersion, DATABASE_SCHEMA_VERSION);
});
