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

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_worker_received ON worker_heartbeats(worker_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_worker ON accounts(worker_id);
CREATE INDEX IF NOT EXISTS idx_profiles_worker ON profiles(worker_id);
CREATE INDEX IF NOT EXISTS idx_risk_events_status ON risk_events(status, created_at DESC);
