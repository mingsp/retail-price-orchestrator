import assert from "node:assert/strict";
import test from "node:test";
import { createDwsClient, parseDwsJson, redactSensitiveText, resolveDwsInvocation, type DwsExecutor } from "../src/dws-client.js";

test("全量查询始终使用稳定 ID、自动翻页和 JSON 输出", async () => {
  const calls: string[][] = [];
  const execute: DwsExecutor = async (args) => {
    calls.push(args);
    return { data: { records: [{ recordId: "rec-1", cells: {} }], hasMore: false, nextCursor: "" } };
  };
  const client = createDwsClient(execute);
  const records = await client.queryAllRecords("base-1", "table-1");
  assert.equal(records.length, 1);
  assert.deepEqual(calls[0], [
    "aitable", "record", "query",
    "--base-id", "base-1",
    "--table-id", "table-1",
    "--all", "--page-limit", "0",
    "--format", "json"
  ]);
});

test("任意 partial 或未翻完标志都会拒绝整批", async () => {
  const partial = createDwsClient(async () => ({ partial: true, data: { records: [] } }));
  const hasMore = createDwsClient(async () => ({ data: { records: [], hasMore: true, nextCursor: "cursor-2" } }));
  await assert.rejects(() => partial.queryAllRecords("base-1", "table-1"), /dws_partial_result/);
  await assert.rejects(() => hasMore.queryAllRecords("base-1", "table-1"), /dws_incomplete_pagination/);
});

test("钉钉空表返回 records=null 时按完整空集处理", async () => {
  const empty = createDwsClient(async () => ({ data: { records: null, totalCount: 0, hasMore: false } }));
  assert.deepEqual(await empty.queryAllRecords("base-1", "table-1"), []);
});

test("字段结构使用真实 ID 回读且 partial 时拒绝", async () => {
  const client = createDwsClient(async (args) => {
    assert.equal(args[1], "field");
    return { data: { fields: [{ fieldId: "fld-1", fieldName: "门店名称", type: "text" }] } };
  });
  assert.equal((await client.queryFields("base-1", "table-1"))[0]?.fieldId, "fld-1");
  const partial = createDwsClient(async () => ({ partial: true, data: { fields: [] } }));
  await assert.rejects(() => partial.queryFields("base-1", "table-1"), /dws_partial_result/);
});

test("账号所属人通过通讯录批量解析为可读姓名", async () => {
  const calls: string[][] = [];
  const client = createDwsClient(async (args) => {
    calls.push(args);
    return {
      result: [{
        orgEmployeeModel: {
          orgUserId: "staff-1",
          orgUserName: "运营A",
          depts: [{ deptPathName: "运营中心-门店" }]
        }
      }]
    };
  });

  assert.deepEqual(await client.queryUsers(["staff-1"]), [{
    userId: "staff-1",
    displayName: "运营A",
    department: "运营中心-门店"
  }]);
  assert.deepEqual(calls[0], [
    "contact", "user", "get",
    "--ids", "staff-1",
    "--format", "json"
  ]);
});

test("拒绝非 JSON 输出且错误信息脱敏", () => {
  assert.throws(() => parseDwsJson("not-json"), /dws_invalid_json/);
  const redacted = redactSensitiveText("手机号 13800138000 access_token=secret-value");
  assert.equal(redacted.includes("13800138000"), false);
  assert.equal(redacted.includes("secret-value"), false);
});

test("Windows 上可通过明确的 PowerShell shim 调用 DWS", () => {
  const invocation = resolveDwsInvocation("win32", "C:\\Tools\\dws.ps1", ["auth", "status"]);
  assert.equal(invocation.executable, "powershell.exe");
  assert.deepEqual(invocation.args, [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\dws.ps1", "auth", "status"
  ]);
});

test("记录写入始终使用字段 ID、JSON 输出且单批不超过 30 条", async () => {
  const calls: string[][] = [];
  const client = createDwsClient(async (args) => {
    calls.push(args);
    return { data: { newRecordIds: ["rec-new-1"] } };
  });
  const created = await client.createRecords("base-1", "table-1", [{ cells: { "fld-1": "值" } }]);
  assert.deepEqual(created, ["rec-new-1"]);
  assert.deepEqual(calls[0], [
    "aitable", "record", "create",
    "--base-id", "base-1",
    "--table-id", "table-1",
    "--records", JSON.stringify([{ cells: { "fld-1": "值" } }]),
    "--format", "json"
  ]);
  await assert.rejects(
    () => client.createRecords("base-1", "table-1", Array.from({ length: 31 }, () => ({ cells: {} }))),
    /dws_record_batch_limit/
  );
});

test("记录更新必须携带真实 recordId", async () => {
  const calls: string[][] = [];
  const client = createDwsClient(async (args) => {
    calls.push(args);
    return { data: { success: true } };
  });
  await client.updateRecords("base-1", "table-1", [{ recordId: "rec-1", cells: { "fld-2": "已同步" } }]);
  assert.equal(calls[0]?.[2], "update");
  await assert.rejects(
    () => client.updateRecords("base-1", "table-1", [{ recordId: "", cells: {} }]),
    /dws_record_id_required/
  );
});
