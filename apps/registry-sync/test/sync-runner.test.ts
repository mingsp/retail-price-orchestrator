import assert from "node:assert/strict";
import test from "node:test";
import type { DwsField, DwsRecord } from "../src/dws-client.js";
import type { RegistryBatchRequest } from "../src/master-client.js";
import type { RuntimeTableState } from "../src/record-mapper.js";
import { assertTableSchema, runRegistrySync } from "../src/sync-runner.js";

const table = (key: string, fields: RuntimeTableState["fields"]): RuntimeTableState => ({
  key,
  name: key,
  tableId: `table-${key}`,
  fields
});
const stores = table("stores", [
  { key: "store_name", fieldId: "name", fieldName: "门店名称", type: "text" },
  { key: "submitted_url", fieldId: "url", fieldName: "原始门店链接", type: "url" },
  { key: "sync_version", fieldId: "version", fieldName: "同步版本", type: "number" }
]);
const accounts = table("accounts", [
  { key: "account_number", fieldId: "phone", fieldName: "完整手机号", type: "text" },
  { key: "operator_owner", fieldId: "owner", fieldName: "账号所属人", type: "user" }
]);
const workers = table("workers", [{ key: "device_name", fieldId: "device", fieldName: "设备名称", type: "text" }]);
const plans = table("collection_plans", [{ key: "store_reference", fieldId: "store", fieldName: "关联门店", type: "text" }]);
const issues = table("sync_issues", [{ key: "issue_number", fieldId: "issue", fieldName: "异常编号", type: "text" }]);

test("dry-run 全量读取并预检，但绝不调用发布", async () => {
  const records = new Map<string, DwsRecord[]>([
    [stores.tableId, [{ recordId: "store-1", cells: {
      name: "生产门店",
      url: "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=poi-one",
      version: 1
    } }]],
    [accounts.tableId, [{ recordId: "blank-account", cells: {} }]],
    [workers.tableId, [{ recordId: "blank-worker", cells: { device: "  " } }]],
    [plans.tableId, [{ recordId: "blank-plan", cells: { store: null } }]]
  ]);
  let preflightBatch: RegistryBatchRequest | undefined;
  let publishCalls = 0;
  const result = await runRegistrySync({
    runtimeState: { baseId: "base-production", schemaHash: "a".repeat(64), tables: [stores, accounts, workers, plans, issues] },
    hmacKey: "h".repeat(64),
    mode: "dry_run"
  }, {
    queryFields: async (_baseId, tableId) => tableId === issues.tableId ? [] :
      [stores, accounts, workers, plans].find((item) => item.tableId === tableId)!.fields as DwsField[],
    queryAllRecords: async (_baseId, tableId) => records.get(tableId) || []
  }, {
    preflight: async (batch) => { preflightBatch = batch; return { valid: true }; },
    publish: async () => { publishCalls += 1; return {}; }
  });

  assert.equal(result.recordCount, 1);
  assert.equal(preflightBatch?.records[0]?.entityType, "store");
  assert.equal(publishCalls, 0);
});

test("账号人员字段先解析姓名，再以脱敏账号发布到 Master 预检", async () => {
  const accountRecord: DwsRecord = {
    recordId: "account-1",
    cells: {
      phone: "13800138000",
      owner: [{ userId: "staff-1", corpId: "corp-1" }]
    }
  };
  let preflightBatch: RegistryBatchRequest | undefined;
  let queriedUserIds: string[] = [];

  const result = await runRegistrySync({
    runtimeState: { baseId: "base-production", schemaHash: "a".repeat(64), tables: [stores, accounts, workers, plans, issues] },
    hmacKey: "h".repeat(64),
    mode: "dry_run"
  }, {
    queryFields: async (_baseId, tableId) => [stores, accounts, workers, plans]
      .find((item) => item.tableId === tableId)!.fields as DwsField[],
    queryAllRecords: async (_baseId, tableId) => tableId === accounts.tableId ? [accountRecord] : [],
    queryUsers: async (userIds) => {
      queriedUserIds = userIds;
      return [{ userId: "staff-1", displayName: "运营A", department: "运营中心-门店" }];
    }
  }, {
    preflight: async (batch) => { preflightBatch = batch; return { valid: true }; },
    publish: async () => ({})
  });

  assert.deepEqual(queriedUserIds, ["staff-1"]);
  assert.equal(result.entityCounts.account, 1);
  const account = preflightBatch?.records.find((record) => record.entityType === "account");
  assert.equal(account?.payload.operatorOwner, "运营A");
  assert.equal(account?.payload.displayName, "运营A");
  assert.equal(JSON.stringify(account).includes("13800138000"), false);
});

test("账号人员 ID 无法解析时整批阻断", async () => {
  await assert.rejects(() => runRegistrySync({
    runtimeState: { baseId: "base-production", schemaHash: "a".repeat(64), tables: [stores, accounts, workers, plans, issues] },
    hmacKey: "h".repeat(64),
    mode: "dry_run"
  }, {
    queryFields: async (_baseId, tableId) => [stores, accounts, workers, plans]
      .find((item) => item.tableId === tableId)!.fields as DwsField[],
    queryAllRecords: async (_baseId, tableId) => tableId === accounts.tableId ? [{
      recordId: "account-1",
      cells: { phone: "13800138000", owner: [{ userId: "staff-missing", corpId: "corp-1" }] }
    }] : [],
    queryUsers: async () => []
  }, {
    preflight: async () => ({ valid: true }),
    publish: async () => ({})
  }), /registry_account_owner_unresolved/);
});

test("字段 ID、名称或类型变化立即阻断同步", () => {
  assert.throws(() => assertTableSchema(stores, [{ fieldId: "name", fieldName: "门店名称已改", type: "text" }]), /registry_schema_drift/);
});

test("DWS 物理字段类型与台账逻辑类型使用等价映射", () => {
  const logical = table("stores", [
    { key: "owner", fieldId: "owner", fieldName: "业务负责人", type: "person" },
    { key: "updated", fieldId: "updated", fieldName: "更新时间", type: "date_time" },
    { key: "status", fieldId: "status", fieldName: "状态", type: "single_select" },
    { key: "tags", fieldId: "tags", fieldName: "标签", type: "multi_select" }
  ]);

  assert.doesNotThrow(() => assertTableSchema(logical, [
    { fieldId: "owner", fieldName: "业务负责人", type: "user" },
    { fieldId: "updated", fieldName: "更新时间", type: "date" },
    { fieldId: "status", fieldName: "状态", type: "singleSelect" },
    { fieldId: "tags", fieldName: "标签", type: "multipleSelect" }
  ]));
});

test("publish 成功后用真实 recordId 回写 Master 标识并读回核对", async () => {
  const publishStores = table("stores", [
    ...stores.fields,
    { key: "poi_id_str", fieldId: "poi", fieldName: "poi_id_str", type: "text" },
    { key: "canonical_url", fieldId: "canonical", fieldName: "标准门店链接", type: "url" },
    { key: "validation_status", fieldId: "validation", fieldName: "链接校验状态", type: "single_select" },
    { key: "last_validated_at", fieldId: "validated_at", fieldName: "最近校验时间", type: "date_time" },
    { key: "master_store_id", fieldId: "master_id", fieldName: "Master门店ID", type: "text" },
    { key: "sync_status", fieldId: "sync_status", fieldName: "同步状态", type: "single_select" },
    { key: "last_synced_at", fieldId: "synced_at", fieldName: "最近同步时间", type: "date_time" }
  ]);
  const issueTable = table("sync_issues", [
    { key: "issue_number", fieldId: "issue_number", fieldName: "异常编号", type: "text" },
    { key: "source_table", fieldId: "source_table", fieldName: "来源表", type: "text" },
    { key: "source_record_id", fieldId: "source_record", fieldName: "来源记录ID", type: "text" },
    { key: "field_name", fieldId: "field", fieldName: "字段", type: "text" },
    { key: "issue_type", fieldId: "issue_type", fieldName: "异常类型", type: "single_select" },
    { key: "business_message", fieldId: "message", fieldName: "业务说明", type: "text" },
    { key: "suggested_fix", fieldId: "fix", fieldName: "建议修复", type: "text" },
    { key: "first_seen_at", fieldId: "first_seen", fieldName: "首次发现时间", type: "date_time" },
    { key: "last_seen_at", fieldId: "last_seen", fieldName: "最近发现时间", type: "date_time" },
    { key: "status", fieldId: "issue_status", fieldName: "状态", type: "single_select" }
  ]);
  const record: DwsRecord = { recordId: "store-1", cells: {
    name: "生产门店",
    url: "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=poi-one",
    version: 1
  } };
  let publishCalls = 0;

  await runRegistrySync({
    runtimeState: { baseId: "base-production", schemaHash: "a".repeat(64), tables: [publishStores, accounts, workers, plans, issueTable] },
    hmacKey: "h".repeat(64),
    mode: "publish",
    writebackEnabled: true
  }, {
    queryFields: async (_baseId, tableId) => [publishStores, accounts, workers, plans, issueTable]
      .find((item) => item.tableId === tableId)!.fields as DwsField[],
    queryAllRecords: async (_baseId, tableId) => tableId === publishStores.tableId ? [record] : [],
    createRecords: async () => [],
    updateRecords: async (_baseId, tableId, writes) => {
      assert.equal(tableId, publishStores.tableId);
      Object.assign(record.cells, writes[0]?.cells);
    }
  }, {
    preflight: async () => ({ valid: true, issues: [] }),
    publish: async () => { publishCalls += 1; return { status: "published" }; }
  });

  assert.equal(publishCalls, 1);
  assert.equal(record.cells.sync_status, "已同步");
  assert.match(String(record.cells.master_id), /^store-/);
});
