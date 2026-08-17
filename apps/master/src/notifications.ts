import type { RiskEventRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import {
  buildRiskNotification,
  buildRunMilestoneNotification,
  type RunMilestoneNotification
} from "./notification-outbox.js";
import { enqueueNotification } from "./repositories/notification-outbox.js";

export async function queueRiskEventNotification(
  db: Pool,
  enabled: boolean,
  risk: RiskEventRecord
): Promise<{ notificationId?: string; inserted: boolean }> {
  if (!enabled) return { inserted: false };
  return enqueueNotification(db, buildRiskNotification(risk));
}

export async function queueRunMilestoneNotification(
  db: Pool,
  enabled: boolean,
  milestone: RunMilestoneNotification
): Promise<{ notificationId?: string; inserted: boolean }> {
  if (!enabled) return { inserted: false };
  return enqueueNotification(db, buildRunMilestoneNotification(milestone));
}
