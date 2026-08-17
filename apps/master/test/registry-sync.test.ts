import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRegistryBatchIdempotencyKey,
  containsRestrictedRegistryValue,
  validateRegistryBatch,
  type RegistrySyncBatchInput
} from "../src/repositories/registry-sync.js";
import { isRegistrySyncAuthorized } from "../src/routes/registry-sync.js";

const validBatch: RegistrySyncBatchInput = {
  provider: "dingtalk_aitable",
  sourceBaseId: "base-production",
  schemaHash: "a".repeat(64),
  readComplete: true,
  records: [
    {
      sourceTableId: "table-stores",
      sourceRecordId: "record-store-1",
      sourceVersion: 1,
      entityType: "store",
      entityId: "store-poi-1",
      contentHash: "b".repeat(64),
      payload: {
        name: "生产门店",
        platform: "meituan_h5",
        poiIdStr: "poi-1",
        canonicalUrl: "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=poi-1",
        status: "draft"
      }
    }
  ]
};

test("registry batch accepts complete normalized records", () => {
  const result = validateRegistryBatch(validBatch, validBatch.schemaHash);
  assert.deepEqual(result, { valid: true, issues: [] });
  assert.match(computeRegistryBatchIdempotencyKey(validBatch), /^[a-f0-9]{64}$/);
});

test("registry batch rejects incomplete reads, schema drift and duplicate source records", () => {
  const result = validateRegistryBatch({
    ...validBatch,
    readComplete: false,
    records: [...validBatch.records, validBatch.records[0]]
  }, "c".repeat(64));

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), [
    "duplicate_source_record",
    "incomplete_source_read",
    "schema_hash_mismatch"
  ]);
});

test("registry payload rejects plaintext phone numbers and source cells", () => {
  assert.equal(containsRestrictedRegistryValue({ maskedLogin: "138****8000" }), false);
  assert.equal(containsRestrictedRegistryValue({ fullPhone: "13800138000" }), true);
  assert.equal(containsRestrictedRegistryValue({ nested: { cells: { any: "value" } } }), true);

  const result = validateRegistryBatch({
    ...validBatch,
    records: [{
      ...validBatch.records[0],
      payload: { ...validBatch.records[0].payload, fullPhone: "13800138000" }
    }]
  }, validBatch.schemaHash);
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "restricted_payload");
});

test("registry idempotency key is stable across record order", () => {
  const another = {
    ...validBatch.records[0],
    sourceRecordId: "record-store-2",
    entityId: "store-poi-2",
    contentHash: "c".repeat(64)
  };
  const left = { ...validBatch, records: [validBatch.records[0], another] };
  const right = { ...validBatch, records: [another, validBatch.records[0]] };
  assert.equal(computeRegistryBatchIdempotencyKey(left), computeRegistryBatchIdempotencyKey(right));
});

test("registry API requires its dedicated token and never falls open", () => {
  assert.equal(isRegistrySyncAuthorized("sync-secret", "sync-secret"), true);
  assert.equal(isRegistrySyncAuthorized("operator-secret", "sync-secret"), false);
  assert.equal(isRegistrySyncAuthorized(undefined, "sync-secret"), false);
  assert.equal(isRegistrySyncAuthorized(undefined, undefined), false);
});
