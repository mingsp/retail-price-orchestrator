import assert from "node:assert/strict";
import test from "node:test";
import { slicePage } from "../src/pagination.js";

test("large collections render one bounded page at a time", () => {
  const result = slicePage(Array.from({ length: 119 }, (_, index) => index + 1), 2, 30);

  assert.equal(result.items.length, 30);
  assert.equal(result.items[0], 31);
  assert.equal(result.items.at(-1), 60);
  assert.equal(result.pageCount, 4);
  assert.equal(result.start, 31);
  assert.equal(result.end, 60);
});

test("page selection is clamped after a collection shrinks", () => {
  const result = slicePage([1, 2, 3], 10, 30);

  assert.equal(result.page, 1);
  assert.deepEqual(result.items, [1, 2, 3]);
});
