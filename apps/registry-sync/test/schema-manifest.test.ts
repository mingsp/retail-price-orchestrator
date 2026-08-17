import assert from "node:assert/strict";
import test from "node:test";
import { createSchemaHash, validateSchemaManifest } from "../src/schema-manifest.js";
import manifest from "../../../deploy/dingtalk/production-registry.schema.json" with { type: "json" };

test("生产台账包含五张稳定逻辑表", () => {
  const validated = validateSchemaManifest(manifest);
  assert.equal(validated.version, 4);
  assert.deepEqual(validated.tables.map((table) => table.key), [
    "stores",
    "accounts",
    "workers",
    "collection_plans",
    "sync_issues"
  ]);
});

test("精简门店台账不再要求已移除的可选字段", () => {
  const stores = validateSchemaManifest(manifest).tables.find((table) => table.key === "stores");
  assert.equal(stores?.fields.length, 21);
  assert.equal(stores?.fields.some((field) => ["business_owner", "validation_status", "note"].includes(field.key)), false);
});

test("账号池以完整手机号作为唯一人工录入主字段", () => {
  const validated = validateSchemaManifest(manifest);
  const accounts = validated.tables.find((table) => table.key === "accounts");
  const phone = accounts?.fields.find((field) => field.key === "account_number");
  assert.equal(accounts?.fields[0]?.key, "account_number");
  assert.equal(phone?.name, "完整手机号");
  assert.equal(phone?.sensitivity, "restricted");
  assert.equal(phone?.syncToMaster, false);
  assert.equal(accounts?.fields.some((field) => [
    "display_name",
    "phone",
    "requested_state",
    "current_status",
    "last_profile",
    "last_slot",
    "resolution_note"
  ].includes(field.key)), false);
});

test("身份证生日只保留在钉钉且不允许同步到 Master", () => {
  const validated = validateSchemaManifest(manifest);
  const accounts = validated.tables.find((table) => table.key === "accounts");
  const identityBirthday = accounts?.fields.find((field) => field.key === "identity_birthday_yyyymmdd");
  assert.equal(identityBirthday?.name, "身份证生日（8位）");
  assert.equal(identityBirthday?.sensitivity, "restricted");
  assert.equal(identityBirthday?.syncToMaster, false);
});

test("schema hash 对字段顺序和约束稳定敏感", () => {
  const validated = validateSchemaManifest(manifest);
  const hash = createSchemaHash(validated);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, createSchemaHash(validated));
});

test("Worker 台账包含远程接入所需的最小设备身份字段", () => {
  const validated = validateSchemaManifest(manifest);
  const workers = validated.tables.find((table) => table.key === "workers");
  assert.deepEqual(
    ["mac_address", "ssh_username", "ssh_status"].map((key) => workers?.fields.find((field) => field.key === key)?.name),
    ["MAC地址", "SSH用户名", "SSH状态"]
  );
});
