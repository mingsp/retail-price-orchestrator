import assert from "node:assert/strict";
import test from "node:test";
import type { InternalRegistryRecord, RuntimeTableState } from "../src/record-mapper.js";
import { buildPublishedRecordUpdates, buildSyncIssueRecord } from "../src/registry-writeback.js";

const table = (key: string, fields: Array<[string, string]>): RuntimeTableState => ({
  key,
  name: key,
  tableId: `table-${key}`,
  fields: fields.map(([fieldKey, fieldId]) => ({ fieldId, key: fieldKey, fieldName: fieldKey, type: "text" }))
});

test("账号发布回写只包含脱敏标识和同步状态", () => {
  const accounts = table("accounts", [
    ["masked_phone", "fld-masked"],
    ["phone_fingerprint", "fld-fingerprint"],
    ["master_account_id", "fld-master"],
    ["sync_version", "fld-version"],
    ["sync_status", "fld-status"],
    ["last_synced_at", "fld-time"]
  ]);
  const record: InternalRegistryRecord = {
    sourceTableId: accounts.tableId,
    sourceRecordId: "rec-account-1",
    sourceVersion: 2,
    entityType: "account",
    entityId: "account-abc",
    contentHash: "a".repeat(64),
    payload: { maskedLogin: "138****8000", phoneFingerprint: "f".repeat(64) }
  };

  const updates = buildPublishedRecordUpdates([record], [accounts], "2026-08-06T13:00:00.000Z");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    tableId: accounts.tableId,
    records: [{
      recordId: "rec-account-1",
      cells: {
        "fld-masked": "138****8000",
        "fld-fingerprint": "f".repeat(64),
        "fld-master": "account-abc",
        "fld-version": 2,
        "fld-status": "已同步",
        "fld-time": "2026-08-06T13:00:00.000Z"
      }
    }]
  });
  assert.doesNotMatch(JSON.stringify(updates), /13800138000/);
});

test("精简后的门店台账无需链接校验状态字段也能生成安全回写", () => {
  const stores = table("stores", [
    ["poi_id_str", "fld-poi"],
    ["canonical_url", "fld-url"],
    ["last_validated_at", "fld-validated"],
    ["master_store_id", "fld-master"],
    ["sync_version", "fld-version"],
    ["sync_status", "fld-status"],
    ["last_synced_at", "fld-synced"]
  ]);
  const record: InternalRegistryRecord = {
    sourceTableId: stores.tableId,
    sourceRecordId: "rec-store-1",
    sourceVersion: 3,
    entityType: "store",
    entityId: "store-abc",
    contentHash: "b".repeat(64),
    payload: { poiIdStr: "poi-1", canonicalUrl: "https://example.test/store" }
  };

  const updates = buildPublishedRecordUpdates([record], [stores], "2026-08-11T10:00:00.000Z");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].records[0].cells["fld-poi"], "poi-1");
  assert.equal(updates[0].records[0].cells["fld-status"], "已同步");
  assert.equal(Object.keys(updates[0].records[0].cells).length, 7);
});

test("同步异常记录使用稳定编号和业务化说明", () => {
  const issues = table("sync_issues", [
    ["issue_number", "fld-number"],
    ["source_table", "fld-table"],
    ["source_record_id", "fld-record"],
    ["field_name", "fld-field"],
    ["issue_type", "fld-type"],
    ["business_message", "fld-message"],
    ["suggested_fix", "fld-fix"],
    ["first_seen_at", "fld-first"],
    ["last_seen_at", "fld-last"],
    ["status", "fld-status"]
  ]);
  const record = buildSyncIssueRecord({
    code: "schema_hash_mismatch",
    message: "钉钉台账结构与 Master 预期不一致",
    sourceTableId: "table-stores",
    sourceRecordId: "rec-store-1"
  }, issues, "2026-08-06T13:00:00.000Z");

  assert.equal(record.cells["fld-type"], "Schema变化");
  assert.equal(record.cells["fld-status"], "待处理");
  assert.match(String(record.cells["fld-number"]), /^SYNC-[A-F0-9]{12}$/);
  assert.doesNotMatch(JSON.stringify(record), /access_token|C:\\Users/i);
});
