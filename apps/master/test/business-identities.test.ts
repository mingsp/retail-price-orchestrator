import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalCategoryKey,
  buildRunBusinessKey
} from "../src/repositories/business-identities.js";

test("run business key is stable for the same store schedule and scope", () => {
  const first = buildRunBusinessKey({
    channel: "meituan_h5",
    storeId: "store-a",
    scheduleWindow: "2026-W34",
    scopeVersion: "scope-v3"
  });
  const repeated = buildRunBusinessKey({
    scopeVersion: "scope-v3",
    scheduleWindow: "2026-W34",
    storeId: "store-a",
    channel: "meituan_h5"
  });

  assert.equal(first, repeated);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("run business key changes when the schedule or frozen scope changes", () => {
  const base = {
    channel: "meituan_h5",
    storeId: "store-a",
    scheduleWindow: "2026-W34",
    scopeVersion: "scope-v3"
  } as const;

  assert.notEqual(buildRunBusinessKey(base), buildRunBusinessKey({ ...base, scheduleWindow: "2026-W35" }));
  assert.notEqual(buildRunBusinessKey(base), buildRunBusinessKey({ ...base, scopeVersion: "scope-v4" }));
});

test("canonical category key prefers the platform tag over a mutable display name", () => {
  assert.equal(
    buildCanonicalCategoryKey({ categoryName: "饮料/全部", categoryTag: "1208650622_27", categoryType: 27 }),
    "tag:27:1208650622_27"
  );
  assert.equal(
    buildCanonicalCategoryKey({ categoryName: "饮料专区", categoryTag: "1208650622_27", categoryType: 27 }),
    "tag:27:1208650622_27"
  );
});

test("canonical category key normalizes names when a stable tag is unavailable", () => {
  assert.equal(
    buildCanonicalCategoryKey({ parentName: "  女性护理 ", categoryName: " 全 部 " }),
    "name:女性护理/全部"
  );
});
