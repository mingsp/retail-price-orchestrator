import assert from "node:assert/strict";
import test from "node:test";
import { buildProductIngestionRowsFromRawLine, buildProductSnapshotKey } from "../src/product-ingestion.js";

test("buildProductIngestionRowsFromRawLine preserves product name and extracts front display price", () => {
  const rawLine = JSON.stringify({
    ts: "2026-07-08T03:55:59.639Z",
    runId: "run-1",
    taskId: "task-1",
    source: "cache_before",
    worker: { workerId: "mm-worker" },
    account: {
      accountId: "account-1",
      accountLabel: "运营账号1",
      profileId: "profile-1",
      cdpPort: 9256
    },
    store: { storeId: "store-1", storeName: "犀牛百货（西门店）" },
    category: { i: 2, j: 1, parentName: "日用百货", name: "清洁工具", displayName: "日用百货 / 清洁工具", tag: "tag-clean" },
    productIndex: {
      spuId: 90000000001,
      name: "【加大加厚】大号商用垃圾袋加厚物业垃圾袋 酒店环卫黑色大垃圾袋搬家袋/个",
      minPrice: 0.01,
      originPrice: "",
      skus: [{ skuId: 90000000002, spec: "90*100cm", price: 0.01, originPrice: 0.6, stock: 534, status: 0 }]
    },
    productRaw: {
      id: 90000000001,
      name: "【加大加厚】大号商用垃圾袋加厚物业垃圾袋 酒店环卫黑色大垃圾袋搬家袋/个",
      min_price: 0.01,
      month_saled_content: "月售2000+",
      promotion_info: "0.17折 限1份",
      unify_price: {
        price: 0.6,
        price_str: "0.6",
        activity_info: {
          activity_price: 0.01,
          activity_price_str: "0.01",
          activity_price_suffix: "起",
          activity_price_source: 7
        },
        actual_price_info: {
          actual_price: 0.01,
          actual_price_str: "0.01"
        }
      },
      skus: [
        {
          id: 90000000002,
          spu_id: 90000000001,
          spec: "90*100cm",
          price: 0.01,
          origin_price: 0.6,
          stock: 534,
          promotion_info: "0.17折 限1份",
          unify_price: {
            price: 0.6,
            price_str: "0.6",
            activity_info: {
              activity_price: 0.01,
              activity_price_str: "0.01",
              activity_price_source: 7
            },
            actual_price_info: {
              actual_price: 0.01,
              actual_price_str: "0.01"
            }
          }
        }
      ]
    }
  });

  const rows = buildProductIngestionRowsFromRawLine(rawLine);

  assert.equal(rows.products.length, 1);
  assert.equal(rows.skus.length, 1);
  assert.equal(rows.products[0].productName, "【加大加厚】大号商用垃圾袋加厚物业垃圾袋 酒店环卫黑色大垃圾袋搬家袋/个");
  assert.equal(rows.products[0].frontDisplayPriceText, "0.01起");
  assert.equal(rows.products[0].frontDisplayPriceValue, 0.01);
  assert.equal(rows.products[0].userFinalPriceText, "0.01");
  assert.equal(rows.products[0].userFinalPriceValue, 0.01);
  assert.equal(rows.products[0].priceSourcePath, "productRaw.unify_price.activity_info.activity_price_str");
  assert.equal(rows.products[0].userFinalPriceSourcePath, "productRaw.unify_price.actual_price_info.actual_price_str");
  assert.equal(rows.products[0].priceSemantics, "actual_payable");
  assert.equal(rows.skus[0].skuId, "90000000002");
  assert.equal(rows.skus[0].frontDisplayPriceText, "0.01");
});

test("buildProductIngestionRowsFromRawLine never fabricates user final price from display price", () => {
  const rows = buildProductIngestionRowsFromRawLine(
    JSON.stringify({
      ts: "2026-07-10T00:00:00.000Z",
      runId: "run-1",
      taskId: "task-1",
      store: { storeId: "store-1", storeName: "门店A" },
      category: { name: "饮料", displayName: "饮料" },
      productRaw: {
        id: "spu-1",
        name: "测试饮料",
        unify_price: {
          price: 5.9,
          price_str: "5.9",
          activity_info: { activity_price: 4.9, activity_price_str: "4.9" }
        },
        skus: [
          {
            id: "sku-1",
            unify_price: {
              price: 5.9,
              price_str: "5.9",
              activity_info: { activity_price: 4.9, activity_price_str: "4.9" }
            }
          }
        ]
      }
    })
  );

  assert.equal(rows.products[0].frontDisplayPriceValue, 4.9);
  assert.equal(rows.products[0].userFinalPriceText, undefined);
  assert.equal(rows.products[0].userFinalPriceValue, undefined);
  assert.equal(rows.products[0].userFinalPriceSourcePath, undefined);
  assert.equal(rows.products[0].priceSemantics, "front_display_only");
  assert.equal(rows.skus[0].userFinalPriceValue, undefined);
  assert.equal(rows.skus[0].priceSemantics, "front_display_only");
});

test("zero actual price is quarantined while the visible page price is preserved", () => {
  const rows = buildProductIngestionRowsFromRawLine(JSON.stringify({
    ts: "2026-07-14T00:00:00.000Z",
    runId: "run-1",
    taskId: "task-1",
    store: { storeId: "store-1", storeName: "门店A" },
    category: { name: "啤酒", displayName: "啤酒" },
    productRaw: {
      id: "spu-1",
      name: "单罐啤酒",
      unify_price: {
        price: 8.5,
        price_str: "8.5",
        activity_info: { activity_price: 6.8, activity_price_str: "6.8" },
        actual_price_info: { actual_price: 0, actual_price_str: "0", actual_price_text: "到手价" }
      },
      skus: [{
        id: "sku-1",
        unify_price: {
          price: 8.5,
          price_str: "8.5",
          activity_info: { activity_price: 6.8, activity_price_str: "6.8" },
          actual_price_info: { actual_price: 0, actual_price_str: "0", actual_price_text: "到手价" }
        }
      }]
    }
  }));

  assert.equal(rows.products[0].frontDisplayPriceValue, 6.8);
  assert.equal(rows.products[0].userFinalPriceValue, undefined);
  assert.equal(rows.products[0].userFinalPriceText, undefined);
  assert.equal(rows.products[0].userFinalPriceSourcePath, undefined);
  assert.equal(rows.products[0].priceSemantics, "front_display_only");
  assert.equal(rows.skus[0].userFinalPriceValue, undefined);
  assert.equal(rows.skus[0].priceSemantics, "front_display_only");
});

test("buildProductIngestionRowsFromRawLine uses canonical task identity for legacy raw rows", () => {
  const rows = buildProductIngestionRowsFromRawLine(
    JSON.stringify({
      runId: "mm-worker-legacy-capture-id",
      taskId: "5f6b3d74-7dc4-4513-98af-7247c9eab3e6",
      store: { storeId: "legouda-jingyao-20260709" },
      category: { name: "开学季", displayName: "开学季/全部" },
      productRaw: { id: "spu-legacy", name: "历史商品" }
    }),
    {
      runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
      taskId: "5f6b3d74-7dc4-4513-98af-7247c9eab3e6",
      captureId: "mm-worker-5f6b3d74-7dc4-4513-98af-7247c9eab3e6"
    }
  );

  assert.equal(rows.products[0].runId, "8d188942-1fcc-4ba5-80d7-a81105a2f410");
  assert.equal(rows.products[0].taskId, "5f6b3d74-7dc4-4513-98af-7247c9eab3e6");
  assert.equal(rows.products[0].captureId, "mm-worker-5f6b3d74-7dc4-4513-98af-7247c9eab3e6");
});

test("buildProductSnapshotKey is stable for idempotent upserts", () => {
  assert.equal(
    buildProductSnapshotKey({
      runId: "run-1",
      taskId: "task-1",
      categoryName: "推荐",
      spuId: "90000000001"
    }),
    "run-1|task-1|推荐|90000000001"
  );
});
