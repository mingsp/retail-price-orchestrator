import type { TaskStatus } from "@retail-orchestrator/shared";

export interface TaskQualityFacts {
  taskStatus: TaskStatus;
  artifactVerified: boolean;
  rawRows: number;
  uniqueSpuCount: number;
  skuRows: number;
  frontDisplayPricePresent: number;
  categoryComplete: boolean;
  expectedItems?: number;
}

export interface TaskQualityDecision {
  status: "pass" | "warn" | "fail";
  reasons: string[];
}

export function evaluateTaskQuality(facts: TaskQualityFacts): TaskQualityDecision {
  const failures: string[] = [];
  if (facts.taskStatus !== "validating") failures.push("task_not_validating");
  if (!facts.artifactVerified) failures.push("raw_artifact_not_verified");
  if (facts.rawRows <= 0 || facts.uniqueSpuCount <= 0) failures.push("raw_product_rows_missing");
  if (!facts.categoryComplete) failures.push("category_terminal_evidence_missing");
  if (failures.length) return { status: "fail", reasons: failures };

  const warnings: string[] = [];
  if (facts.frontDisplayPricePresent < facts.rawRows) warnings.push("front_display_price_incomplete");
  if (facts.expectedItems && facts.rawRows < facts.expectedItems) warnings.push("expected_item_shortfall");
  return warnings.length
    ? { status: "warn", reasons: warnings }
    : { status: "pass", reasons: [] };
}
