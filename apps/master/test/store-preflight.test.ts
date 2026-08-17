import assert from "node:assert/strict";
import test from "node:test";
import { matchesObservedLocation, matchesObservedStore } from "../src/repositories/tasks.js";

test("store preflight prefers the immutable poi id over a similar title", () => {
  assert.equal(matchesObservedStore("poi-a", "呱呱超市（莲湖店）", "poi-a", "任意页面标题"), true);
  assert.equal(matchesObservedStore("poi-a", "呱呱超市（莲湖店）", "poi-b", "呱呱超市（莲湖店）"), false);
});

test("store preflight can use a normalized title only when poi id is unavailable", () => {
  assert.equal(matchesObservedStore(undefined, "乐购达超市（景耀店）", undefined, "乐购达超市 景耀店 - 美团外卖"), true);
  assert.equal(matchesObservedStore(undefined, "乐购达超市（景耀店）", undefined, "乐购达超市 高新店"), false);
});

test("location preflight blocks missing or distant delivery locations when required", () => {
  const policy = {
    locationPreflight: {
      required: true,
      latitude: 34.256637,
      longitude: 108.932898,
      maxDistanceMeters: 3_000
    }
  };
  assert.equal(matchesObservedLocation(policy, undefined, undefined), false);
  assert.equal(matchesObservedLocation(policy, 34.260000, 108.930000), true);
  assert.equal(matchesObservedLocation(policy, 31.230416, 121.473701), false);
});

test("location preflight is backward compatible until a store explicitly enables it", () => {
  assert.equal(matchesObservedLocation({}, undefined, undefined), true);
  assert.equal(matchesObservedLocation({ locationPreflight: { required: false } }, undefined, undefined), true);
});
