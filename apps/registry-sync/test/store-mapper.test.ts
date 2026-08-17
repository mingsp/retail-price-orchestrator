import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoreUrl } from "../src/store-mapper.js";

const storeUrl = "https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant?source=searchresult&poi_id_str=gN8C492bwzzgoOEEPtVobwI&poi_id=-100&initialLng=108.835749&initialLat=34.164996&channel=default&actualLng=108.835749&actualLat=34.164996&response_code=temporary&request_code=temporary";

test("标准化门店链接并移除临时错误参数", () => {
  const result = normalizeStoreUrl(storeUrl);
  assert.equal(result.poiIdStr, "gN8C492bwzzgoOEEPtVobwI");
  assert.equal(result.canonicalUrl.includes("response_code"), false);
  assert.equal(result.canonicalUrl.includes("request_code"), false);
  assert.equal(result.identityKey, "meituan_h5:gN8C492bwzzgoOEEPtVobwI");
});

test("同一 poi_id_str 的位置和来源变化不改变门店身份", () => {
  const first = normalizeStoreUrl(storeUrl);
  const second = normalizeStoreUrl(storeUrl.replace("source=searchresult", "source=waimai").replace("actualLng=108.835749", "actualLng=121.491353"));
  assert.equal(first.identityKey, second.identityKey);
});

test("拒绝非美团域名和缺失门店标识的链接", () => {
  assert.throws(() => normalizeStoreUrl("https://example.com/store?poi_id_str=abc"), /unsupported_store_url/);
  assert.throws(() => normalizeStoreUrl("https://cactivityapi-sc.waimai.meituan.com/h5/sub-trade/restaurant/restaurant"), /missing_poi_id_str/);
});
