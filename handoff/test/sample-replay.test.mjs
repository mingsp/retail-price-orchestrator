import assert from "node:assert/strict";
import test from "node:test";
import { auditSample } from "../lib/sample.mjs";

test("auditSample reconciles raw SPU, nested SKU, prices, checkpoint, and risk", () => {
  const rawRows = [
    row("cat-a", "spu-1", [
      { id: "sku-1", unify_price: { activity_info: { activity_price: 0.01 } } },
      { id: "sku-2", price: 12.5 }
    ]),
    row("cat-a", "spu-1", [
      { id: "sku-1", unify_price: { activity_info: { activity_price: 0.01 } } },
      { id: "sku-2", price: 12.5 }
    ]),
    row("cat-a", "spu-2", [{ id: "sku-3", price: 8.8 }]),
    row("cat-b", "spu-3", [{ id: "sku-4", min_price: 6.6 }])
  ];

  const audit = auditSample({
    rawRows,
    checkpoint: {
      completedCategories: [{ tag: "cat-a", completedAt: "2026-07-31T00:00:00.000Z" }]
    },
    riskEvents: [{ type: "http_418", status: "manual_required" }]
  });

  assert.deepEqual(audit, {
    rawRows: 4,
    uniqueSpu: 3,
    uniqueSku: 4,
    categoryProductRelations: 3,
    categories: 2,
    pricedSku: 4,
    frontDisplayPriceCoverage: 1,
    riskEvents: 1,
    checkpointCompletedCategories: 1
  });
});

function row(categoryTag, spuId, skus) {
  return {
    category: { tag: categoryTag, parentName: categoryTag },
    productRaw: { id: spuId, name: spuId, skus }
  };
}
