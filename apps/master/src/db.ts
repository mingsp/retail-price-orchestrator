import { Pool } from "pg";

export function createDb(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

export async function ensureSchema(db: Pool): Promise<void> {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      machine_label TEXT NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL,
      agent_version TEXT NOT NULL,
      status TEXT NOT NULL,
      network_mode TEXT NOT NULL,
      codex_operator BOOLEAN NOT NULL DEFAULT FALSE,
      capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      latest_log_summary TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      id BIGSERIAL PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      masked_login TEXT,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      cdp_port INTEGER NOT NULL,
      current_store_id TEXT,
      current_store_name TEXT,
      current_category_name TEXT,
      last_verified_at TIMESTAMPTZ,
      last_risk_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      profile_id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      account_id TEXT,
      profile_path TEXT NOT NULL,
      cdp_port INTEGER NOT NULL,
      status TEXT NOT NULL,
      risk_count INTEGER NOT NULL DEFAULT 0,
      last_risk_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      risk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      severity TEXT NOT NULL,
      risk_type TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      account_id TEXT,
      profile_id TEXT,
      cdp_port INTEGER,
      store_id TEXT,
      store_name TEXT,
      category_name TEXT,
      phase TEXT,
      observed TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'meituan_h5',
      poi_id_str TEXT,
      url TEXT NOT NULL,
      city TEXT,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      collection_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS store_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      run_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      strategy TEXT NOT NULL DEFAULT 'category_split',
      target_finish_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS category_tasks (
      task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES store_runs(run_id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      category_name TEXT NOT NULL,
      category_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 100,
      assigned_worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      assigned_account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,
      assigned_profile_id TEXT REFERENCES profiles(profile_id) ON DELETE SET NULL,
      expected_items INTEGER,
      collected_items INTEGER NOT NULL DEFAULT 0,
      cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID REFERENCES category_tasks(task_id) ON DELETE SET NULL,
      run_id UUID REFERENCES store_runs(run_id) ON DELETE SET NULL,
      store_id TEXT REFERENCES stores(store_id) ON DELETE SET NULL,
      worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,
      profile_id TEXT REFERENCES profiles(profile_id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      checksum_sha256 TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bucket, object_key)
    );

    CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_worker_received ON worker_heartbeats(worker_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_accounts_worker ON accounts(worker_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_worker ON profiles(worker_id);
    CREATE INDEX IF NOT EXISTS idx_risk_events_status ON risk_events(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_store_runs_store ON store_runs(store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_category_tasks_run_status ON category_tasks(run_id, status, priority ASC);
    CREATE INDEX IF NOT EXISTS idx_category_tasks_assignee ON category_tasks(assigned_worker_id, assigned_account_id, status);
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at DESC);
  `);
}
