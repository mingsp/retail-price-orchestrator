import type { Pool } from "pg";
import type {
  DeliveryResult,
  NotificationDelivery,
  NotificationDeliveryStore,
  NotificationDraft
} from "../notification-outbox.js";

const MAX_ATTEMPTS = 5;

export async function enqueueNotification(db: Pool, draft: NotificationDraft): Promise<{ notificationId: string; inserted: boolean }> {
  const inserted = await db.query(
    `
      INSERT INTO notification_outbox (dedupe_key, channel, event_type, message, payload)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING notification_id
    `,
    [draft.dedupeKey, draft.channel, draft.eventType, draft.message, JSON.stringify(draft.payload)]
  );
  if (inserted.rows[0]) return { notificationId: inserted.rows[0].notification_id, inserted: true };

  const existing = await db.query(
    `SELECT notification_id FROM notification_outbox WHERE dedupe_key = $1`,
    [draft.dedupeKey]
  );
  return { notificationId: existing.rows[0].notification_id, inserted: false };
}

export async function recoverStalledNotificationDeliveries(db: Pool): Promise<number> {
  const result = await db.query(`
    UPDATE notification_outbox
    SET status = 'outcome_unknown',
        last_error = 'Master 在投递期间中断，无法确认钉钉是否已收到；禁止自动重发',
        updated_at = now()
    WHERE status = 'delivering'
      AND last_attempt_at < now() - interval '5 minutes'
  `);
  return result.rowCount || 0;
}

export async function notificationDeliverySummary(db: Pool): Promise<Record<string, number>> {
  const result = await db.query(`
    SELECT status, count(*)::int AS count
    FROM notification_outbox
    GROUP BY status
    ORDER BY status
  `);
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
}

export async function listNotificationAttentionItems(db: Pool): Promise<Array<Record<string, unknown>>> {
  const result = await db.query(`
    SELECT notification_id, dedupe_key, event_type, status, attempt_count,
           provider_code, provider_message, last_error, created_at, last_attempt_at
    FROM notification_outbox
    WHERE status IN ('retryable_failure', 'outcome_unknown', 'dead_letter')
    ORDER BY updated_at DESC
    LIMIT 100
  `);
  return result.rows.map((row) => ({
    notificationId: row.notification_id,
    dedupeKey: row.dedupe_key,
    eventType: row.event_type,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    providerCode: row.provider_code || undefined,
    providerMessage: row.provider_message || undefined,
    lastError: row.last_error || undefined,
    createdAt: row.created_at.toISOString(),
    lastAttemptAt: row.last_attempt_at?.toISOString()
  }));
}

export class PostgresNotificationDeliveryStore implements NotificationDeliveryStore {
  constructor(private readonly db: Pool) {}

  async claimNext(): Promise<NotificationDelivery | null> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`
        WITH candidate AS (
          SELECT notification_id
          FROM notification_outbox
          WHERE status IN ('pending', 'retryable_failure')
            AND next_attempt_at <= now()
            AND attempt_count < ${MAX_ATTEMPTS}
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE notification_outbox AS outbox
        SET status = 'delivering',
            attempt_count = attempt_count + 1,
            last_attempt_at = now(),
            updated_at = now()
        FROM candidate
        WHERE outbox.notification_id = candidate.notification_id
        RETURNING outbox.*
      `);
      await client.query("COMMIT");
      return result.rows[0] ? mapDelivery(result.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markSent(delivery: NotificationDelivery, result: DeliveryResult): Promise<void> {
    await this.updateTerminal(delivery, "sent", result, null);
  }

  async markOutcomeUnknown(delivery: NotificationDelivery, result: DeliveryResult): Promise<void> {
    await this.updateTerminal(delivery, "outcome_unknown", result, null);
  }

  async markRetryableFailure(delivery: NotificationDelivery, result: DeliveryResult): Promise<void> {
    const deadLetter = delivery.attemptCount >= MAX_ATTEMPTS;
    const delaySeconds = retryDelaySeconds(delivery.attemptCount);
    await this.db.query(
      `
        UPDATE notification_outbox
        SET status = $2,
            provider_code = $3,
            provider_message = $4,
            last_error = $4,
            next_attempt_at = CASE WHEN $2 = 'retryable_failure' THEN now() + ($5 * interval '1 second') ELSE next_attempt_at END,
            updated_at = now()
        WHERE notification_id = $1 AND status = 'delivering'
      `,
      [
        delivery.notificationId,
        deadLetter ? "dead_letter" : "retryable_failure",
        result.providerCode || null,
        result.providerMessage || "钉钉明确拒绝投递",
        delaySeconds
      ]
    );
  }

  private async updateTerminal(
    delivery: NotificationDelivery,
    status: "sent" | "outcome_unknown",
    result: DeliveryResult,
    nextAttemptAt: Date | null
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE notification_outbox
        SET status = $2,
            provider_code = $3,
            provider_message = $4,
            last_error = CASE WHEN $2 = 'outcome_unknown' THEN $4 ELSE NULL END,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
            next_attempt_at = COALESCE($5, next_attempt_at),
            updated_at = now()
        WHERE notification_id = $1 AND status = 'delivering'
      `,
      [delivery.notificationId, status, result.providerCode || null, result.providerMessage || null, nextAttemptAt]
    );
  }
}

export function retryDelaySeconds(attemptCount: number): number {
  return Math.min(15 * 60, 30 * (2 ** Math.max(0, attemptCount - 1)));
}

function mapDelivery(row: any): NotificationDelivery {
  return {
    notificationId: row.notification_id,
    dedupeKey: row.dedupe_key,
    channel: row.channel,
    eventType: row.event_type,
    message: row.message,
    attemptCount: Number(row.attempt_count)
  };
}
