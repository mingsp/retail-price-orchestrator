import assert from "node:assert/strict";
import test from "node:test";
import { chunkFields, toDwsField } from "../src/schema-provisioner.js";

test("将逻辑字段类型转换为 DWS 字段配置", () => {
  assert.deepEqual(toDwsField({ key: "status", name: "状态", type: "single_select", owner: "business", sensitivity: "internal", syncToMaster: true, options: ["启用", "暂停"] }), {
    fieldName: "状态",
    type: "singleSelect",
    config: { options: [{ name: "启用" }, { name: "暂停" }] }
  });
  assert.deepEqual(toDwsField({ key: "owner", name: "负责人", type: "person", owner: "business", sensitivity: "internal", syncToMaster: true }), {
    fieldName: "负责人",
    type: "user",
    config: { multiple: false }
  });
  assert.deepEqual(toDwsField({ key: "time", name: "同步时间", type: "date_time", owner: "master", sensitivity: "internal", syncToMaster: false }), {
    fieldName: "同步时间",
    type: "date",
    config: { formatter: "YYYY-MM-DD HH:mm:ss" }
  });
});

test("字段创建批次永不超过 DWS 的十五字段上限", () => {
  const fields = Array.from({ length: 31 }, (_, index) => ({
    fieldName: `字段${index + 1}`,
    type: "text"
  }));
  const chunks = chunkFields(fields);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [15, 15, 1]);
});
