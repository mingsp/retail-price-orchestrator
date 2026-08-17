import assert from "node:assert/strict";
import test from "node:test";
import {
  isRawStoreDataArtifact,
  requiredRawArtifactReadOptions,
  parseRawStoreDataLine
} from "../src/repositories/raw-data-sync.js";

const context = {
  storeSnapshotId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
  storeCode: "legouda-jingyao-20260709",
  storeName: "乐购达超市（景耀店）",
  sourceStoreId: "yAoCYxcAaVekB85Z8LI-wgI",
  channelCode: "meituan_h5",
  fallbackCollectedAt: "2026-07-09T05:48:43.895Z"
};

test("product raw line is preserved as a complete store observation", () => {
  const source = {
    ts: "2026-07-09T05:48:40.123Z",
    runId: "native-run-1",
    source: "native-cdp",
    category: { i: 2, j: 3, name: "饮料", tag: "drinks" },
    product: {
      spu_id: "spu-100",
      name: "原始商品名",
      skus: [{ id: "sku-1", price: 9.9 }],
      raw: { unify_price: { price: 9.9 }, unknown_future_field: { nested: true } }
    }
  };
  const line = JSON.stringify(source);
  const row = parseRawStoreDataLine(line, context);

  assert.equal(row.store_snapshot_id, context.storeSnapshotId);
  assert.equal(row.store_code, context.storeCode);
  assert.equal(row.record_type, "product");
  assert.equal(row.source_spu_id, "spu-100");
  assert.equal(row.category_key, "drinks");
  assert.equal(row.collected_at, "2026-07-09 13:48:40.123");
  assert.deepEqual(JSON.parse(row.raw_data), source);
  assert.equal(row.record_hash.length, 64);
  assert.equal("front_display_price_amount" in row, false);
  assert.equal("comparison_price_amount" in row, false);
});

test("raw data sync pins reads to the registered object version", () => {
  assert.deepEqual(requiredRawArtifactReadOptions("version-3", "artifact-1"), { versionId: "version-3" });
  assert.throws(() => requiredRawArtifactReadOptions(undefined, "artifact-1"), /raw_store_data_artifact_version_missing:artifact-1/);
});

test("native collector productRaw takes precedence over its category metadata", () => {
  const source = {
    ts: "2026-07-09T05:46:39.701Z",
    runId: "mm-worker-native-run",
    store: { storeId: context.storeCode, storeName: context.storeName },
    source: "page0",
    category: { i: 1, j: -1, name: "神价", tag: "god_price_tag" },
    productRaw: {
      id: 20519644058,
      name: "农夫山泉 食用冰 160g/杯*3",
      skus: [{ id: 35663383026, price: 12 }],
      future_field: { preserved: true }
    }
  };
  const row = parseRawStoreDataLine(JSON.stringify(source), context);

  assert.equal(row.record_type, "product");
  assert.equal(row.source_spu_id, "20519644058");
  assert.equal(row.category_key, "god_price_tag");
  assert.deepEqual(JSON.parse(row.raw_data), source);
});

test("category raw line remains queryable without inventing a product id", () => {
  const source = {
    ts: "2026-07-09T05:00:00.000Z",
    event: "category",
    category: { i: 1, j: 2, name: "零食", tag: "snacks", product_count: 300 }
  };
  const row = parseRawStoreDataLine(JSON.stringify(source), context);

  assert.equal(row.record_type, "category");
  assert.equal(row.source_spu_id, null);
  assert.equal(row.category_key, "snacks");
  assert.deepEqual(JSON.parse(row.raw_data), source);
});

test("identical source content has a stable idempotency hash", () => {
  const line = JSON.stringify({ ts: "2026-07-09T05:00:00.000Z", product: { spu_id: "spu-1", raw: {} } });
  assert.equal(
    parseRawStoreDataLine(line, context).record_hash,
    parseRawStoreDataLine(line, context).record_hash
  );
});

test("malformed JSON is rejected instead of silently losing source fields", () => {
  assert.throws(() => parseRawStoreDataLine("{not-json", context), /raw_store_data_invalid_json/);
});

test("only product and category JSONL artifacts enter the store raw table", () => {
  assert.equal(isRawStoreDataArtifact({ kind: "raw_jsonl", objectKey: "a.products.raw.jsonl", metadata: {} }), true);
  assert.equal(isRawStoreDataArtifact({ kind: "log", objectKey: "a.categories.jsonl", metadata: { artifactPart: "categories" } }), true);
  assert.equal(isRawStoreDataArtifact({ kind: "log", objectKey: "a.progress.jsonl", metadata: { artifactPart: "progress" } }), false);
  assert.equal(isRawStoreDataArtifact({ kind: "screenshot", objectKey: "a.png", metadata: {} }), false);
});
