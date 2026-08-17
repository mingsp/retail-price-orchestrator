import assert from "node:assert/strict";
import test from "node:test";
import { selectTaskCategories } from "../../../scripts/lib/category-selection.mjs";

const plan = [
  { i: 45, j: 0, parentName: "节庆用品", name: "全部", tag: "918841024_27" },
  { i: 46, j: 0, parentName: "糖巧蜜饯", name: "全部", tag: "918790503_27" }
];

test("semantic category tag wins when a stored index has drifted", () => {
  const selected = selectTaskCategories(plan, {
    categoryNames: ["节庆用品"],
    categoryTag: "918841024_27",
    categoryI: 46,
    categoryJ: 0,
    skipCategoryIs: new Set()
  });
  assert.deepEqual(selected.map((category: { i: number; tag: string }) => [category.i, category.tag]), [
    [45, "918841024_27"]
  ]);
});

test("a stale semantic identity never falls through to a different indexed category", () => {
  const selected = selectTaskCategories(plan, {
    categoryNames: ["不存在的类目"],
    categoryTag: "missing-tag",
    categoryI: 46,
    categoryJ: 0,
    skipCategoryIs: new Set()
  });
  assert.deepEqual(selected, []);
});

test("index selection remains available for tasks without semantic identity", () => {
  const selected = selectTaskCategories(plan, {
    categoryNames: [],
    categoryI: 46,
    categoryJ: 0,
    skipCategoryIs: new Set()
  });
  assert.equal(selected[0]?.parentName, "糖巧蜜饯");
});

test("top-level category range keeps every expanded child within the assigned range", () => {
  const expandedPlan = [
    { i: 3, j: 0, parentName: "夏日必备", name: "冰镇专区", tag: "1583712662" },
    { i: 3, j: 1, parentName: "夏日必备", name: "解暑凉品", tag: "1521166378" },
    { i: 4, j: 0, parentName: "饮料专区", name: "碳酸饮料", tag: "1259011001" },
    { i: 25, j: 0, parentName: "日用百货", name: "全部", tag: "1258934709_27" }
  ];
  const selected = selectTaskCategories(expandedPlan, {
    categoryNames: [],
    captureAllCategories: true,
    startCategoryI: 3,
    endCategoryI: 24,
    skipCategoryIs: new Set()
  });
  assert.deepEqual(selected.map((category: { i: number; j: number }) => [category.i, category.j]), [
    [3, 0],
    [3, 1],
    [4, 0]
  ]);
});

test("stable category tags survive index drift and select a semantic batch", () => {
  const driftedPlan = [
    { i: 12, j: 0, tag: "tag-a", name: "A" },
    { i: 26, j: 0, tag: "tag-b", name: "B" },
    { i: 40, j: 0, tag: "tag-c", name: "C" }
  ];
  const selected = selectTaskCategories(driftedPlan, {
    categoryTags: ["tag-b", "tag-c"],
    startCategoryI: 48,
    endCategoryI: 59,
    skipCategoryIs: new Set()
  });
  assert.deepEqual(selected.map((category: { tag: string }) => category.tag), ["tag-b", "tag-c"]);
});
