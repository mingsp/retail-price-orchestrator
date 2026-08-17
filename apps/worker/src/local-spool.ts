import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type LocalSpoolStatus = "pending" | "inflight" | "retryable_failure" | "dead_letter";

export interface LocalSpoolItem<T = unknown> {
  idempotencyKey: string;
  payload: T;
  createdAt?: string;
  status?: LocalSpoolStatus;
  attemptCount?: number;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface LocalSpoolOptions {
  maxAttempts?: number;
  retryBaseMs?: number;
  claimLeaseMs?: number;
}

interface SpoolRow {
  idempotency_key: string;
  payload_json: string;
  created_at: string;
  status: LocalSpoolStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
}

export class LocalSpool<T = unknown> {
  private operation: Promise<unknown> = Promise.resolve();
  private database?: DatabaseSync;
  private initialized = false;
  private readonly databasePath: string;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly claimLeaseMs: number;

  constructor(private readonly legacyFilePath: string, options: LocalSpoolOptions = {}) {
    this.databasePath = `${legacyFilePath}.sqlite`;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 8);
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? 5_000);
    this.claimLeaseMs = Math.max(1_000, options.claimLeaseMs ?? 60_000);
  }

  enqueue(item: LocalSpoolItem<T>): Promise<void> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      const createdAt = item.createdAt || new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO spool_items (
          idempotency_key, payload_json, created_at, status, attempt_count, next_attempt_at
        ) VALUES (?, ?, ?, 'pending', 0, ?)
      `).run(item.idempotencyKey, JSON.stringify(item.payload), createdAt, createdAt);
    });
  }

  list(): Promise<LocalSpoolItem<T>[]> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      return this.mapRows(db.prepare(`
        SELECT idempotency_key, payload_json, created_at, status, attempt_count, next_attempt_at, last_error
        FROM spool_items
        ORDER BY created_at, idempotency_key
      `).all() as unknown as SpoolRow[]);
    });
  }

  stats(): Promise<Record<LocalSpoolStatus, number>> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      const rows = db.prepare(`
        SELECT status, COUNT(*) AS count FROM spool_items GROUP BY status
      `).all() as unknown as Array<{ status: LocalSpoolStatus; count: number }>;
      const result: Record<LocalSpoolStatus, number> = {
        pending: 0,
        inflight: 0,
        retryable_failure: 0,
        dead_letter: 0
      };
      for (const row of rows) result[row.status] = Number(row.count);
      return result;
    });
  }

  claim(limit: number, owner: string): Promise<LocalSpoolItem<T>[]> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      const now = new Date().toISOString();
      const claimUntil = new Date(Date.now() + this.claimLeaseMs).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          UPDATE spool_items
          SET status = 'retryable_failure', claimed_by = NULL, claim_until = NULL
          WHERE status = 'inflight' AND claim_until <= ?
        `).run(now);
        const rows = db.prepare(`
          SELECT idempotency_key, payload_json, created_at, status, attempt_count, next_attempt_at, last_error
          FROM spool_items
          WHERE status IN ('pending','retryable_failure') AND next_attempt_at <= ?
          ORDER BY created_at, idempotency_key
          LIMIT ?
        `).all(now, Math.max(1, limit)) as unknown as SpoolRow[];
        const markClaimed = db.prepare(`
          UPDATE spool_items
          SET status = 'inflight', claimed_by = ?, claim_until = ?
          WHERE idempotency_key = ? AND status IN ('pending','retryable_failure')
        `);
        for (const row of rows) markClaimed.run(owner, claimUntil, row.idempotency_key);
        db.exec("COMMIT");
        return this.mapRows(rows.map((row) => ({ ...row, status: "inflight" as const })));
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  acknowledge(idempotencyKey: string): Promise<void> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      db.prepare("DELETE FROM spool_items WHERE idempotency_key = ?").run(idempotencyKey);
    });
  }

  fail(idempotencyKey: string, error: string): Promise<void> {
    return this.exclusive(async () => {
      const db = await this.getDatabase();
      const current = db.prepare(
        "SELECT attempt_count FROM spool_items WHERE idempotency_key = ?"
      ).get(idempotencyKey) as { attempt_count: number } | undefined;
      if (!current) return;
      const attemptCount = current.attempt_count + 1;
      const deadLetter = attemptCount >= this.maxAttempts;
      const delay = this.retryBaseMs * Math.min(2 ** Math.max(0, attemptCount - 1), 64);
      db.prepare(`
        UPDATE spool_items
        SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?,
            claimed_by = NULL, claim_until = NULL
        WHERE idempotency_key = ?
      `).run(
        deadLetter ? "dead_letter" : "retryable_failure",
        attemptCount,
        new Date(Date.now() + delay).toISOString(),
        error.slice(0, 2_000),
        idempotencyKey
      );
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      this.database?.close();
      this.database = undefined;
      this.initialized = false;
    });
  }

  private exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async getDatabase(): Promise<DatabaseSync> {
    if (this.database && this.initialized) return this.database;
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    const db = new DatabaseSync(this.databasePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS spool_items (
        idempotency_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','inflight','retryable_failure','dead_letter')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        claimed_by TEXT,
        claim_until TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_spool_dispatch
        ON spool_items(status, next_attempt_at, created_at);
    `);
    this.database = db;
    await this.importLegacyJsonl(db);
    this.initialized = true;
    return db;
  }

  private async importLegacyJsonl(db: DatabaseSync): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const insert = db.prepare(`
      INSERT OR IGNORE INTO spool_items (
        idempotency_key, payload_json, created_at, status, attempt_count, next_attempt_at
      ) VALUES (?, ?, ?, 'pending', 0, ?)
    `);
    for (const line of content.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const item = JSON.parse(line) as LocalSpoolItem<T>;
      const createdAt = item.createdAt || new Date().toISOString();
      insert.run(item.idempotencyKey, JSON.stringify(item.payload), createdAt, createdAt);
    }
  }

  private mapRows(rows: SpoolRow[]): LocalSpoolItem<T>[] {
    return rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      payload: JSON.parse(row.payload_json) as T,
      createdAt: row.created_at,
      status: row.status,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at,
      lastError: row.last_error || undefined
    }));
  }
}
