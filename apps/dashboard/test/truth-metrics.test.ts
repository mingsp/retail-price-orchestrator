import assert from "node:assert/strict";
import test from "node:test";
import {
  accountHealthPercent,
  buildTruthfulRunProgress,
  reconcileAccountOperationalTruth
} from "../src/truth-metrics.js";

test("empty account inventory never reports a healthy 100 percent", () => {
  assert.equal(accountHealthPercent([]), undefined);
});

test("legacy completed tasks are not counted as validated completion", () => {
  const progress = buildTruthfulRunProgress([
    { status: "completed", collectedItems: 100, expectedItems: 100 },
    { status: "completed_valid", collectedItems: 80, expectedItems: 80 }
  ]);

  assert.equal(progress.validatedCategories, 1);
  assert.equal(progress.totalCategories, 2);
  assert.equal(progress.categoryCompletionPercent, 50);
  assert.equal(progress.itemProgressPercent, undefined);
  assert.equal(progress.itemProgressLabel, "商品总量待确认");
});

test("unknown item totals never produce a product percentage", () => {
  const progress = buildTruthfulRunProgress([
    { status: "collecting", collectedItems: 280 },
    { status: "pending", collectedItems: 0 }
  ]);

  assert.equal(progress.itemProgressPercent, undefined);
  assert.equal(progress.itemProgressLabel, "商品总量待识别");
});

test("evidenced non-product entries count as resolved but not as validated products", () => {
  const progress = buildTruthfulRunProgress([
    { status: "completed_valid", collectedItems: 80, cursor: {} },
    { status: "skipped", collectedItems: 0, cursor: { exclusionEvidence: true } }
  ]);

  assert.equal(progress.validatedCategories, 1);
  assert.equal(progress.excludedCategories, 1);
  assert.equal(progress.resolvedCategories, 2);
  assert.equal(progress.categoryCompletionPercent, 100);
});

test("active task overrides stale account store and provides last collection time", () => {
  const account = reconcileAccountOperationalTruth(
    {
      accountId: "account-1",
      displayName: "账号一",
      status: "safe",
      riskLevel: "normal",
      profileId: "profile-1",
      profileStatus: "safe",
      profilePath: "profile-1",
      cdpPort: 9301,
      currentStoreName: "旧门店"
    },
    [
      {
        taskId: "task-1",
        runId: "run-1",
        storeId: "store-new",
        storeName: "真实门店",
        categoryName: "饮料",
        categoryOrder: 1,
        status: "collecting",
        priority: 1,
        assignedAccountId: "account-1",
        leaseGeneration: 0,
        lastProgressAt: "2026-07-13T03:00:00.000Z",
        missingSpuCount: 0,
        collectedItems: 30,
        cursor: {},
        createdAt: "2026-07-13T02:00:00.000Z",
        updatedAt: "2026-07-13T03:00:00.000Z"
      }
    ]
  );

  assert.equal(account.currentStoreName, "真实门店");
  assert.equal(account.currentCategoryName, "饮料");
  assert.equal(account.lastCollectedAt, "2026-07-13T03:00:00.000Z");
  assert.equal(account.operationalSource, "active_task");
});
