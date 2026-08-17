import type { TaskStatus } from "@retail-orchestrator/shared";

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["assigned", "running", "collecting", "paused", "manual_required", "failed", "skipped"],
  assigned: ["pending", "running", "collecting", "paused", "manual_required", "failed", "skipped"],
  running: ["collecting", "captured", "paused", "manual_required", "failed", "skipped"],
  collecting: ["running", "captured", "paused", "manual_required", "failed", "skipped"],
  captured: ["uploading", "needs_review", "failed"],
  uploading: ["structuring", "needs_review", "failed"],
  structuring: ["validating", "needs_review", "failed"],
  validating: ["completed_valid", "needs_review", "failed"],
  paused: ["pending", "running", "manual_required", "failed"],
  manual_required: ["pending", "running", "paused", "failed"],
  completed: ["validating", "completed_valid", "needs_review"],
  completed_valid: [],
  needs_review: ["pending", "uploading", "structuring", "validating", "failed"],
  failed: ["pending", "paused", "needs_review"],
  skipped: ["pending", "needs_review"]
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function validTaskPredecessors(target: TaskStatus): TaskStatus[] {
  return (Object.keys(transitions) as TaskStatus[]).filter((status) => canTransitionTask(status, target));
}
