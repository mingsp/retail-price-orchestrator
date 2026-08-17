import type { AccountPoolStatus, RiskLevel } from "@retail-orchestrator/shared";

export interface AccountPoolEligibilityFacts {
  status: AccountPoolStatus;
  riskLevel: Extract<RiskLevel, "normal" | "watch" | "blocked">;
  availableAfter?: string | Date | null;
}

export function isAccountPoolEligible(
  account: AccountPoolEligibilityFacts | undefined,
  now = new Date()
): boolean {
  if (!account) return false;
  if (!["available", "reserved", "in_use"].includes(account.status)) return false;
  if (account.riskLevel === "blocked") return false;
  if (account.availableAfter && new Date(account.availableAfter).getTime() > now.getTime()) return false;
  return true;
}
