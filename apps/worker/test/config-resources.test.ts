import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfiguredAccounts } from "../src/config.js";

test("worker does not invent an account or CDP resource when none is configured", () => {
  assert.deepEqual(resolveConfiguredAccounts({}), []);
});

test("worker reports only explicitly configured accounts", () => {
  const accounts = [{
    accountId: "account-01",
    displayName: "采集账号 01",
    status: "safe",
    riskLevel: "normal",
    profileId: "profile-01",
    profileStatus: "safe",
    profilePath: "profiles/profile-01",
    cdpPort: 9421
  }];
  assert.deepEqual(resolveConfiguredAccounts({
    WORKER_ACCOUNTS_JSON: JSON.stringify(accounts)
  }), accounts);
});
