import assert from "node:assert/strict";
import test from "node:test";
import type { RiskEventRecord } from "@retail-orchestrator/shared";
import { buildRiskClusters, insertRiskEvent } from "../src/repositories/risk-events.js";

function risk(overrides: Partial<RiskEventRecord>): RiskEventRecord {
  return {
    riskId: overrides.riskId || "risk-1",
    severity: overrides.severity || "high",
    riskType: overrides.riskType || "403",
    workerId: overrides.workerId || "worker-1",
    accountId: overrides.accountId,
    profileId: overrides.profileId,
    cdpPort: overrides.cdpPort,
    storeId: overrides.storeId || "store-1",
    storeName: overrides.storeName || "Store",
    categoryName: overrides.categoryName || "神价",
    phase: overrides.phase || "category_capture",
    observed: overrides.observed || "403",
    recommendedAction: overrides.recommendedAction || "pause",
    status: overrides.status || "open",
    createdAt: overrides.createdAt || "2026-07-09T08:00:00.000Z",
    resolvedAt: overrides.resolvedAt
  };
}

test("risk cluster quarantines same store/category risk across multiple accounts", () => {
  const clusters = buildRiskClusters([
    risk({ riskId: "risk-a", accountId: "account-a", profileId: "profile-a", createdAt: "2026-07-09T08:00:00.000Z" }),
    risk({ riskId: "risk-b", accountId: "account-b", profileId: "profile-b", createdAt: "2026-07-09T08:05:00.000Z" })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].status, "quarantine");
  assert.equal(clusters[0].affectedAccountCount, 2);
  assert.deepEqual(clusters[0].affectedAccounts, ["account-a", "account-b"]);
  assert.deepEqual(clusters[0].riskIds, ["risk-a", "risk-b"]);
});

test("risk cluster stays watch for a single-account event", () => {
  const clusters = buildRiskClusters([
    risk({ riskId: "risk-a", accountId: "account-a", profileId: "profile-a" })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].status, "watch");
  assert.equal(clusters[0].affectedAccountCount, 1);
});

test("risk events preserve the linked browser screenshot artifact", async () => {
  const screenshotArtifactId = "11111111-1111-4111-8111-111111111111";
  let parameters: unknown[] = [];
  const db = {
    async query(_sql: string, values: unknown[]) {
      parameters = values;
      return { rows: [{
        risk_id: "22222222-2222-4222-8222-222222222222",
        severity: "high",
        risk_type: "captcha",
        worker_id: "worker-1",
        screenshot_artifact_id: screenshotArtifactId,
        observed: "需要人工验证",
        recommended_action: "远程处理",
        status: "open",
        created_at: new Date("2026-07-15T00:00:00.000Z")
      }] };
    }
  } as any;
  const saved = await insertRiskEvent(db, {
    type: "worker.risk_event",
    sentAt: new Date().toISOString(),
    event: {
      severity: "high",
      riskType: "captcha",
      workerId: "worker-1",
      screenshotArtifactId,
      observed: "需要人工验证",
      recommendedAction: "远程处理"
    }
  });

  assert.equal(parameters[11], screenshotArtifactId);
  assert.equal(saved.screenshotArtifactId, screenshotArtifactId);
});
