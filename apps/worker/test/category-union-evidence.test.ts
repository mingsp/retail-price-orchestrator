import assert from "node:assert/strict";
import test from "node:test";
import { buildCategoryUnionCoverage } from "../../../scripts/lib/category-union-evidence.mjs";

test("category coverage uses the union across accounts instead of the largest account count", () => {
  const category = { tag: "god-price", displayName: "神券" };
  const events = [
    { event: "category_done", account: { accountId: "account-a" }, category, evidence: { observedAllSpuIds: ["1", "2", "3"] } },
    { event: "category_done", account: { accountId: "account-b" }, category, evidence: { observedAllSpuIds: ["2", "3", "4"] } }
  ];
  const products = ["1", "2", "3", "4"].map((id) => ({ category, productRaw: { id } }));

  const [coverage] = buildCategoryUnionCoverage(events, products);

  assert.equal(coverage.observedSpuIds.length, 4);
  assert.deepEqual(new Set(coverage.observedSpuIds), new Set(["1", "2", "3", "4"]));
  assert.deepEqual(new Set(coverage.accountIds), new Set(["account-a", "account-b"]));
  assert.equal(coverage.completed, true);
});

test("category coverage reports a product missing from raw category relations", () => {
  const category = { tag: "god-price", displayName: "神券" };
  const [coverage] = buildCategoryUnionCoverage(
    [{ event: "category_done", category, evidence: { accountId: "account-a", observedAllSpuIds: ["1", "2", "3"] } }],
    ["1", "2"].map((id) => ({ category, productRaw: { id } }))
  );

  assert.deepEqual(coverage.missingSpuIds, ["3"]);
  assert.equal(coverage.completed, false);
});

test("the same product under two categories remains two independent relations", () => {
  const events = [
    { event: "category_done", category: { tag: "a", displayName: "类目A" }, evidence: { observedAllSpuIds: ["1"] } },
    { event: "category_done", category: { tag: "b", displayName: "类目B" }, evidence: { observedAllSpuIds: ["1"] } }
  ];
  const products = [
    { category: { tag: "a", displayName: "类目A" }, productRaw: { id: "1" } },
    { category: { tag: "b", displayName: "类目B" }, productRaw: { id: "1" } }
  ];

  const coverage = buildCategoryUnionCoverage(events, products);
  assert.equal(coverage.length, 2);
  assert.equal(coverage.every((item) => item.completed), true);
});
