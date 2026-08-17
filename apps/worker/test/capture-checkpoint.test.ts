import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryCompletionFromEvidence,
  categoryDurableProductIdsFromSeenKeys,
  durableProductIdsFromSeenKeys,
  isDurablyCompletedCategoryEvent,
  mergeCheckpointState,
  missingDurableProductIds,
  requiresPageFallback,
  remainingCategoriesFromCheckpoint
} from "../../../scripts/lib/capture-checkpoint.mjs";

test("legacy category completion without observed ids is not trusted", () => {
  assert.equal(isDurablyCompletedCategoryEvent({
    event: "category_done",
    final: { completed: true, finalSpus: 80, finalAll: 80 },
    category: { tag: "god-price" }
  }), false);
});

test("category completion requires all observed ids to be durable", () => {
  assert.equal(isDurablyCompletedCategoryEvent({
    event: "category_done",
    final: { completed: true, finalSpus: 80, finalAll: 80 },
    category: { tag: "god-price" },
    evidence: { observedAllSpuIds: ["1", "2"], missingSpuIds: [] }
  }), true);
  assert.equal(isDurablyCompletedCategoryEvent({
    event: "category_done",
    final: { completed: true, finalSpus: 79, finalAll: 80 },
    category: { tag: "god-price" },
    evidence: { observedAllSpuIds: ["1", "2"], missingSpuIds: ["2"] }
  }), false);
  assert.equal(isDurablyCompletedCategoryEvent({
    event: "category_done",
    final: { completed: true, finalSpus: 20, finalAll: 20, expected: 20 },
    category: { tag: "activity", product_count: 21 },
    evidence: { observedAllSpuIds: Array.from({ length: 20 }, (_, index) => String(index + 1)), missingSpuIds: [] }
  }), false);
});

test("category durability does not borrow products captured under another category", () => {
  const seenKeys = ["0:-1:1001", "1:0:1001", "1:0:1002", "2:0:1003"];
  const ids = categoryDurableProductIdsFromSeenKeys(seenKeys, { i: 1, j: 0 });

  assert.deepEqual([...ids], ["1001", "1002"]);
  assert.deepEqual(missingDurableProductIds([1001, 1002, 1003], ids), ["1003"]);
});

test("category without an id manifest stays incomplete when page total exceeds captured rows", () => {
  assert.deepEqual(
    categoryCompletionFromEvidence({
      observedAllSpuIds: [],
      durableCapturedSpuIds: Array.from({ length: 20 }, (_, index) => String(index + 1)),
      expected: 26
    }),
    {
      finalAll: 0,
      target: 26,
      finalSpus: 20,
      missingSpuIds: [],
      missingCount: 6,
      completed: false
    }
  );
});

test("page fallback is reserved for categories without an id manifest", () => {
  assert.equal(requiresPageFallback({ allIds: [], expected: 26, durableCount: 20 }), true);
  assert.equal(requiresPageFallback({ allIds: [], expected: 20, durableCount: 20 }), false);
  assert.equal(requiresPageFallback({ allIds: ["1", "2"], expected: 2, durableCount: 1 }), false);
});

test("category completion uses the largest observed total instead of trusting a shorter id manifest", () => {
  assert.deepEqual(
    categoryCompletionFromEvidence({
      observedAllSpuIds: Array.from({ length: 20 }, (_, index) => String(index + 1)),
      durableCapturedSpuIds: Array.from({ length: 20 }, (_, index) => String(index + 1)),
      expected: 21
    }),
    {
      finalAll: 20,
      target: 21,
      finalSpus: 20,
      missingSpuIds: [],
      missingCount: 1,
      completed: false
    }
  );
  assert.equal(requiresPageFallback({
    allIds: Array.from({ length: 20 }, (_, index) => String(index + 1)),
    expected: 21,
    durableCount: 20
  }), false);
});

test("durable product ids survive category index drift", () => {
  const ids = durableProductIdsFromSeenKeys(["44:0:1001", "44:0:1002"]);
  assert.deepEqual([...ids], ["1001", "1002"]);
  assert.deepEqual(missingDurableProductIds([1001, 1002, 1003], ids), ["1003"]);
});

test("cached products and checkpoint products form one missing-id set", () => {
  const ids = durableProductIdsFromSeenKeys(["31:0:2001"]);
  assert.deepEqual(missingDurableProductIds([2001, 2002, 2003], ids, [2002]), ["2003"]);
});

test("resume keeps the incomplete checkpoint category and skips earlier categories", () => {
  const categories = [
    { i: 37, j: 0 },
    { i: 46, j: 0 },
    { i: 47, j: 0 }
  ];

  assert.deepEqual(
    remainingCategoriesFromCheckpoint(categories, { i: 46, j: 0 }, false),
    [
      { i: 46, j: 0 },
      { i: 47, j: 0 }
    ]
  );
});

test("resume skips the checkpoint category when it is already complete", () => {
  const categories = [
    { i: 45, j: 0 },
    { i: 46, j: 0 },
    { i: 47, j: 0 }
  ];

  assert.deepEqual(
    remainingCategoriesFromCheckpoint(categories, { i: 46, j: 0 }, true),
    [{ i: 47, j: 0 }]
  );
});

test("resume anchors to the stable category tag after index drift", () => {
  const categories = [
    { i: 60, j: 0, tag: "oral" },
    { i: 63, j: 0, tag: "automotive" },
    { i: 64, j: 0, tag: "nutrition" }
  ];

  assert.deepEqual(
    remainingCategoriesFromCheckpoint(
      categories,
      { i: 61, j: 0, tag: "automotive" },
      false
    ),
    [
      { i: 63, j: 0, tag: "automotive" },
      { i: 64, j: 0, tag: "nutrition" }
    ]
  );
});

test("checkpoint status updates preserve the current category", () => {
  assert.deepEqual(
    mergeCheckpointState(
      {
        currentCategory: { i: 46, j: 0, displayName: "家纺布艺/全部" },
        remainingMissing: 127
      },
      { stopped: true }
    ),
    {
      currentCategory: { i: 46, j: 0, displayName: "家纺布艺/全部" },
      remainingMissing: 127,
      stopped: true
    }
  );
});

test("starting a new category clears completion inherited from the previous category", () => {
  assert.deepEqual(
    mergeCheckpointState(
      {
        currentCategory: { tag: "previous" },
        categoryCompleted: true,
        remainingMissing: 0
      },
      {
        currentCategory: { tag: "next" },
        categoryCompleted: false,
        remainingMissing: null
      }
    ),
    {
      currentCategory: { tag: "next" },
      categoryCompleted: false,
      remainingMissing: null
    }
  );
});
