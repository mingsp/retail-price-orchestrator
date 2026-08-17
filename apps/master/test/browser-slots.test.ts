import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountChangeNotice,
  validateBrowserSlotBinding,
  validateRemoteDesktopTarget
} from "../src/repositories/browser-slots.js";

const slot = { workerId: "worker-mm", targetStoreId: "store-a", status: "ready" };
const account = { accountId: "account-a", workerId: "worker-mm", profileId: "profile-a", status: "safe", riskLevel: "normal" };
const profile = { profileId: "profile-a", workerId: "worker-mm", status: "safe" };
const store = { storeId: "store-a", status: "active" };

test("a healthy account profile and fixed store can bind to its worker slot", () => {
  assert.doesNotThrow(() => validateBrowserSlotBinding(slot, account, profile, store));
});

test("a slot rejects account or profile ownership from another worker", () => {
  assert.throws(
    () => validateBrowserSlotBinding(slot, { ...account, workerId: "worker-jl" }, profile, store),
    /slot_worker_mismatch/
  );
  assert.throws(
    () => validateBrowserSlotBinding(slot, account, { ...profile, workerId: "worker-jl" }, store),
    /slot_worker_mismatch/
  );
});

test("a slot rejects risky accounts and polluted profiles", () => {
  assert.throws(
    () => validateBrowserSlotBinding(slot, { ...account, status: "account_blocked" }, profile, store),
    /account_not_bindable/
  );
  assert.throws(
    () => validateBrowserSlotBinding(slot, account, { ...profile, status: "profile_risk" }, store),
    /profile_not_bindable/
  );
});

test("an already targeted slot cannot silently switch stores", () => {
  assert.throws(
    () => validateBrowserSlotBinding(slot, account, profile, { ...store, storeId: "store-b" }),
    /slot_store_mismatch/
  );
});

test("remote desktop targets reject urls paths and query parameters", () => {
  assert.equal(validateRemoteDesktopTarget("mm-worker_01:21118"), "mm-worker_01:21118");
  assert.throws(() => validateRemoteDesktopTarget("https://host/path?token=secret"), /invalid_remote_desktop_target/);
  assert.throws(() => validateRemoteDesktopTarget("C:\\Users\\operator"), /invalid_remote_desktop_target/);
});

test("account replacement notice identifies the new phone owner and requires local identity update", () => {
  const notice = buildAccountChangeNotice({
    previousAccountId: "account-old",
    accountId: "account-new",
    accountDisplayName: "备用账号02",
    maskedLogin: "139****1234",
    operatorOwner: "运营同事02"
  });
  assert.equal(notice.changed, true);
  assert.equal(notice.maskedLogin, "139****1234");
  assert.equal(notice.operatorOwner, "运营同事02");
  assert.equal(notice.localIdentityPageRequired, true);
  assert.match(notice.message, /当前账号：139\*\*\*\*1234/);
  assert.match(notice.message, /所属人：运营同事02/);
  assert.match(notice.message, /本机 CDP 标识页/);
});
