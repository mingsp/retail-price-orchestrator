import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCdpPageActionUrl,
  buildIdentityExpression,
  buildLoginExpression,
  selectCdpPages,
  validatePrivateConfig
} from "../windows/prefill-cdp-login-phone.mjs";

const assignment = {
  port: 10921,
  profileId: "worker-109-profile-01",
  account: "账号甲",
  phone: ["138", "0013", "8000"].join(""),
  owner: "账号甲",
  store: "示例门店"
};

test("private CDP prefill accepts full phones and rejects masked or duplicate assignments", () => {
  const config = validatePrivateConfig({ workerLabel: "示例 Worker", assignments: [assignment] });
  assert.equal(config.assignments[0].phone, assignment.phone);

  assert.throws(
    () => validatePrivateConfig({ workerLabel: "示例 Worker", assignments: [{ ...assignment, phone: "138****8000" }] }),
    /full mainland mobile number/i
  );
  assert.throws(
    () => validatePrivateConfig({ workerLabel: "示例 Worker", assignments: [assignment, { ...assignment, phone: ["139", "0013", "9000"].join("") }] }),
    /duplicate CDP port/i
  );
});

test("page selection requires the local identity page and an exact Meituan login page", () => {
  const pages = [
    { id: "store", type: "page", title: "门店", url: "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant" },
    { id: "login", type: "page", title: "登录", url: "https://h5.waimai.meituan.com/login", webSocketDebuggerUrl: "ws://127.0.0.1/login" },
    { id: "identity", type: "page", title: "Retail-Radar CDP Identity", url: "file:///profile/retail-radar-identity.html", webSocketDebuggerUrl: "ws://127.0.0.1/identity" }
  ];

  const selected = selectCdpPages(pages);
  assert.equal(selected.identity.id, "identity");
  assert.equal(selected.login.id, "login");
  assert.equal(buildCdpPageActionUrl(10921, "activate", "identity"), "http://127.0.0.1:10921/json/activate/identity");
});

test("prefill expressions verify the Profile, persist the full local identity, and never submit login", () => {
  const identityExpression = buildIdentityExpression(assignment);
  const loginExpression = buildLoginExpression(assignment);

  assert.match(identityExpression, /worker-109-profile-01/);
  assert.match(identityExpression, /retail-radar-identity:/);
  assert.match(loginExpression, /手机号|phone|mobile/i);
  assert.doesNotMatch(loginExpression, /\.click\s*\(|requestSubmit|\.submit\s*\(/);
});
