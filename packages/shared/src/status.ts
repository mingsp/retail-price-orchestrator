export const workerStatuses = ["online", "offline", "degraded", "device_risk"] as const;
export type WorkerStatus = (typeof workerStatuses)[number];

export const accountStatuses = [
  "safe",
  "running",
  "cooldown",
  "manual_required",
  "account_blocked",
  "retired"
] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export const profileStatuses = ["safe", "profile_risk", "retired"] as const;
export type ProfileStatus = (typeof profileStatuses)[number];

export const riskLevels = ["normal", "watch", "high", "blocked"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const storeStatuses = ["active", "paused", "retired"] as const;
export type StoreStatus = (typeof storeStatuses)[number];

export const runStatuses = ["planned", "running", "paused", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof runStatuses)[number];

export const taskStatuses = [
  "pending",
  "assigned",
  "running",
  "paused",
  "manual_required",
  "completed",
  "failed",
  "skipped"
] as const;
export type TaskStatus = (typeof taskStatuses)[number];
