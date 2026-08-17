import assert from "node:assert/strict";
import test from "node:test";
import { readActualLocation } from "../src/task-client.js";

test("worker reads the actual business location from the H5 page URL", () => {
  assert.deepEqual(
    readActualLocation("https://example.invalid/store?actualLat=34.256637&actualLng=108.932898"),
    { latitude: 34.256637, longitude: 108.932898 }
  );
});

test("worker normalizes microdegree coordinates and rejects incomplete locations", () => {
  assert.deepEqual(
    readActualLocation("https://example.invalid/store?actualLat=34256637&actualLng=108932898"),
    { latitude: 34.256637, longitude: 108.932898 }
  );
  assert.deepEqual(
    readActualLocation("https://example.invalid/store?actualLat=34.256637"),
    {}
  );
});
