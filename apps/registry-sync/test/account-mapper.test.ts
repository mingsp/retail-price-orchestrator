import assert from "node:assert/strict";
import test from "node:test";
import { mapAccountRecord } from "../src/account-mapper.js";

const hmacKey = "unit-test-only-hmac-key-with-sufficient-length";

test("账号映射只输出脱敏手机号和不可逆指纹", () => {
  const phone = "13800138000";
  const result = mapAccountRecord({ phone, owner: "运营A", displayName: "账号A" }, hmacKey);
  assert.equal(result.maskedLogin, "138****8000");
  assert.equal(result.phoneFingerprint.length, 64);
  assert.equal(result.operatorOwner, "运营A");
  assert.equal(JSON.stringify(result).includes(phone), false);
});

test("指纹在同一密钥下稳定且随密钥变化", () => {
  const input = { phone: "13800138000", owner: "运营A", displayName: "账号A" };
  const first = mapAccountRecord(input, hmacKey);
  const second = mapAccountRecord(input, hmacKey);
  const third = mapAccountRecord(input, `${hmacKey}-rotated`);
  assert.equal(first.phoneFingerprint, second.phoneFingerprint);
  assert.notEqual(first.phoneFingerprint, third.phoneFingerprint);
});

test("拒绝非法手机号且错误信息不回显原文", () => {
  const invalid = "not-a-phone";
  assert.throws(
    () => mapAccountRecord({ phone: invalid, owner: "运营A", displayName: "账号A" }, hmacKey),
    (error: unknown) => error instanceof Error && error.message === "invalid_account_phone" && !error.message.includes(invalid)
  );
});
