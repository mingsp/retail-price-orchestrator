import assert from "node:assert/strict";
import test from "node:test";
import { mapAccountTableRecord, mapStoreTableRecord, mapWorkerTableRecord, type RuntimeTableState } from "../src/record-mapper.js";

const storeTable: RuntimeTableState = {
  key: "stores",
  name: "门店台账",
  tableId: "table-stores",
  fields: [
    { fieldId: "fld-name", fieldName: "门店名称", type: "text", key: "store_name" },
    { fieldId: "fld-url", fieldName: "原始门店链接", type: "url", key: "submitted_url" },
    { fieldId: "fld-city", fieldName: "城市", type: "text", key: "city" },
    { fieldId: "fld-status", fieldName: "启用状态", type: "singleSelect", key: "enabled_status" },
    { fieldId: "fld-version", fieldName: "同步版本", type: "number", key: "sync_version" }
  ]
};

test("门店记录只向 Master 输出标准链接和业务字段", () => {
  const mapped = mapStoreTableRecord({
    recordId: "record-store-1",
    cells: {
      "fld-name": "小柴购（甘家寨店）",
      "fld-url": { link: "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=gN8C492bwzzgoOEEPtVobwI&response_code=temporary" },
      "fld-city": "西安",
      "fld-status": "待校验",
      "fld-version": 3
    }
  }, storeTable);

  assert.equal(mapped.sourceVersion, 3);
  assert.equal(mapped.entityType, "store");
  assert.equal(mapped.payload.name, "小柴购（甘家寨店）");
  assert.equal(String(mapped.payload.canonicalUrl).includes("response_code"), false);
  assert.equal(JSON.stringify(mapped).includes("cells"), false);
});

test("已关联 Master 门店 ID 时复用正式门店而不创建重复草稿", () => {
  const linkedTable: RuntimeTableState = {
    ...storeTable,
    fields: [
      ...storeTable.fields,
      { fieldId: "fld-master-id", fieldName: "Master门店ID", type: "text", key: "master_store_id" }
    ]
  };
  const mapped = mapStoreTableRecord({
    recordId: "record-store-linked",
    cells: {
      "fld-name": "呱呱超市（昆明路店）",
      "fld-url": "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?poi_id_str=poi-linked",
      "fld-status": "启用",
      "fld-master-id": "guagua-kunming-road"
    }
  }, linkedTable);

  assert.equal(mapped.entityId, "guagua-kunming-road");
  assert.equal(mapped.payload.status, "active");
});

test("账号记录进入 Master 前完成脱敏和不可逆指纹化", () => {
  const accountTable: RuntimeTableState = {
    key: "accounts",
    name: "账号池",
    tableId: "table-accounts",
    fields: [
      { fieldId: "fld-phone", fieldName: "完整手机号", type: "text", key: "account_number" },
      { fieldId: "fld-owner", fieldName: "账号所属人", type: "user", key: "operator_owner" }
    ]
  };
  const mapped = mapAccountTableRecord({
    recordId: "record-account-1",
    cells: {
      "fld-phone": "13800138000",
      "fld-owner": [{ name: "运营A" }]
    },
    updatedAt: "2026-08-07T11:00:00+08:00"
  }, accountTable, "h".repeat(64));

  const serialized = JSON.stringify(mapped);
  assert.equal(serialized.includes("13800138000"), false);
  assert.equal(mapped.payload.maskedLogin, "138****8000");
  assert.match(String(mapped.payload.phoneFingerprint), /^[a-f0-9]{64}$/);
  assert.equal(mapped.payload.operatorOwner, "运营A");
  assert.equal(mapped.payload.displayName, "运营A");
});

test("Worker 记录包含 Master 建立远程连接所需的身份信息", () => {
  const workerTable: RuntimeTableState = {
    key: "workers",
    name: "Worker设备台账",
    tableId: "table-workers",
    fields: [
      { fieldId: "fld-number", fieldName: "Worker编号", type: "text", key: "worker_number" },
      { fieldId: "fld-name", fieldName: "设备名称", type: "text", key: "device_name" },
      { fieldId: "fld-host", fieldName: "主机名", type: "text", key: "hostname" },
      { fieldId: "fld-ip", fieldName: "当前IP", type: "text", key: "current_ip" },
      { fieldId: "fld-mac", fieldName: "MAC地址", type: "text", key: "mac_address" },
      { fieldId: "fld-user", fieldName: "SSH用户名", type: "text", key: "ssh_username" },
      { fieldId: "fld-ssh-status", fieldName: "SSH状态", type: "singleSelect", key: "ssh_status" }
    ]
  };
  const mapped = mapWorkerTableRecord({
    recordId: "record-worker-1",
    cells: {
      "fld-number": "worker-01",
      "fld-name": "天兴电脑",
      "fld-host": "PF41F08Y",
      "fld-ip": "192.0.2.197",
      "fld-mac": "3C-E9-F7-EB-22-6F",
      "fld-user": "pc",
      "fld-ssh-status": "待验证"
    }
  }, workerTable);

  assert.equal(mapped.payload.hostname, "PF41F08Y");
  assert.equal(mapped.payload.currentIp, "192.0.2.197");
  assert.equal(mapped.payload.macAddress, "3C-E9-F7-EB-22-6F");
  assert.equal(mapped.payload.sshUsername, "pc");
  assert.equal(mapped.payload.sshStatus, "待验证");
});
