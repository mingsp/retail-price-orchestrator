import assert from "node:assert/strict";
import test from "node:test";
import { classifyMeituanPageState } from "../src/cdp-identity.js";

test("verification page is never reported as ready", () => {
  assert.deepEqual(classifyMeituanPageState("验证中心", "请完成身份验证"), {
    status: "manual_required",
    note: "页面需要人工验证"
  });
});

test("login and risk pages are classified explicitly", () => {
  assert.equal(classifyMeituanPageState("登录", "请输入手机号").status, "login_required");
  assert.equal(classifyMeituanPageState("超市便利 外卖到家", "发现异常，请登录后再试").status, "login_required");
  assert.equal(classifyMeituanPageState("门店", "请求失败 418").status, "manual_required");
});

test("visible store products are reported ready", () => {
  assert.equal(classifyMeituanPageState("乐购达超市", "搜索店内商品 月售100+ 选规格").status, "ready");
});
