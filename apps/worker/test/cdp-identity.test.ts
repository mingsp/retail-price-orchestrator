import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateCdpRequestId,
  classifyMeituanPageState,
  findForbiddenMerchantCookieDomains,
  normalizeCdpWebSocketUrl
} from "../src/cdp-identity.js";

test("CDP request ids stay within Chrome protocol integer range", () => {
  const first = allocateCdpRequestId();
  const second = allocateCdpRequestId();

  assert.ok(Number.isSafeInteger(first));
  assert.ok(first > 0 && first <= 2_000_000_000);
  assert.equal(second, first + 1);
});

test("CDP websocket URL follows the configured tunnel endpoint", () => {
  assert.equal(
    normalizeCdpWebSocketUrl(
      "ws://127.0.0.1:9421/devtools/page/page-id",
      "http://127.0.0.1:29621"
    ),
    "ws://127.0.0.1:29621/devtools/page/page-id"
  );
});

test("a bare Meituan login page title is sufficient to require login", () => {
  assert.deepEqual(classifyMeituanPageState("登录", ""), {
    status: "login_required",
    note: "页面需要登录账号"
  });
});

test("pure collector audit rejects merchant-side Meituan cookie domains", () => {
  assert.deepEqual(
    findForbiddenMerchantCookieDomains([
      ".meituan.com",
      "passport.meituan.com",
      ".shangoue.meituan.com",
      "waimaie.meituan.com",
      ".epassport.meituan.com",
      ".SHANGOUE.MEITUAN.COM"
    ]),
    ["epassport.meituan.com", "shangoue.meituan.com", "waimaie.meituan.com"]
  );
});

test("pure collector audit accepts consumer-side Meituan cookie domains", () => {
  assert.deepEqual(
    findForbiddenMerchantCookieDomains([
      ".meituan.com",
      "passport.meituan.com",
      "cactivityapi-sc.waimai.meituan.com",
      "appsec-mobile.meituan.com"
    ]),
    []
  );
});
