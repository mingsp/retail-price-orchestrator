import assert from "node:assert/strict";
import test from "node:test";
import { assertRunScopeReference, buildScopeManifest } from "../src/repositories/scope-manifests.js";

test("scope manifest is stable regardless of category discovery order", () => {
  const a = buildScopeManifest({
    storeId: "store-1",
    includeCoupons: true,
    categories: [
      { canonicalCategoryKey: "tag:1:b", categoryName: "饮料", categoryOrder: 2 },
      { canonicalCategoryKey: "tag:1:a", categoryName: "神券", categoryOrder: 1 }
    ]
  });
  const b = buildScopeManifest({
    storeId: "store-1",
    includeCoupons: true,
    categories: [...a.categories].reverse()
  });

  assert.equal(a.manifestHash, b.manifestHash);
  assert.equal(a.scopeVersion, b.scopeVersion);
  assert.deepEqual(a.categories.map((item) => item.canonicalCategoryKey), ["tag:1:a", "tag:1:b"]);
});

test("coupon requirement and category membership change the scope version", () => {
  const base = buildScopeManifest({
    storeId: "store-1",
    includeCoupons: false,
    categories: [{ canonicalCategoryKey: "name:饮料", categoryName: "饮料", categoryOrder: 1 }]
  });
  const coupon = buildScopeManifest({ ...base, includeCoupons: true });
  const extra = buildScopeManifest({
    ...base,
    categories: [...base.categories, { canonicalCategoryKey: "name:零食", categoryName: "零食", categoryOrder: 2 }]
  });

  assert.notEqual(base.scopeVersion, coupon.scopeVersion);
  assert.notEqual(base.scopeVersion, extra.scopeVersion);
});

test("run scope reference must belong to the same store and version", () => {
  const manifest = { scopeManifestId: "scope-1", storeId: "store-1", scopeVersion: "scope:v1" };
  assert.deepEqual(assertRunScopeReference({ storeId: "store-1", scopeVersion: "scope:v1" }, manifest), manifest);
  assert.throws(
    () => assertRunScopeReference({ storeId: "store-2", scopeVersion: "scope:v1" }, manifest),
    /scope_manifest_store_mismatch/
  );
  assert.throws(
    () => assertRunScopeReference({ storeId: "store-1", scopeVersion: "scope:v2" }, manifest),
    /scope_manifest_version_mismatch/
  );
  assert.throws(
    () => assertRunScopeReference({ storeId: "store-1" }, undefined),
    /scope_manifest_not_found/
  );
});
