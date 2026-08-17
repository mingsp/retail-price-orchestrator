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
      boot_id TEXT,
      started_at TIMESTAMPTZ,
      current_ip TEXT,
      disk_free_bytes BIGINT,
      clock_offset_ms INTEGER,
      remote_desktop JSONB NOT NULL DEFAULT '{"provider":"none","status":"unknown"}'::jsonb,
      latest_log_summary TEXT,
      execution_snapshot JSONB,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS worker_enrollment_tokens (
      token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS worker_credentials (
      credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
      cdp_endpoint TEXT,
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
      cdp_endpoint TEXT,
      status TEXT NOT NULL,
      risk_count INTEGER NOT NULL DEFAULT 0,
      last_risk_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cdp_endpoints (
      endpoint_id TEXT PRIMARY KEY,
      slot_id UUID,
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      endpoint_url TEXT NOT NULL,
      ws_endpoint TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      profile_id TEXT,
      account_id TEXT,
      account_display_name TEXT,
      masked_login TEXT,
      operator_owner TEXT,
      target_store_id TEXT,
      target_store_name TEXT,
      current_category_name TEXT,
      last_seen_url TEXT,
      last_seen_title TEXT,
      last_screenshot_artifact_id UUID,
      manual_note TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (worker_id, port)
    );

    CREATE TABLE IF NOT EXISTS cdp_commands (
      command_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slot_id UUID,
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      endpoint_id TEXT,
      port INTEGER NOT NULL,
      profile_id TEXT NOT NULL,
      profile_path TEXT,
      account_id TEXT,
      account_display_name TEXT,
      masked_login TEXT,
      operator_owner TEXT,
      target_store_id TEXT,
      target_store_name TEXT,
      launch_url TEXT,
      chrome_executable TEXT,
      proxy_mode TEXT NOT NULL DEFAULT 'system',
      note TEXT,
      claimed_by TEXT,
      claimed_at TIMESTAMPTZ,
      claim_until TIMESTAMPTZ,
      claim_generation INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
      screenshot_artifact_id UUID,
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

    CREATE TABLE IF NOT EXISTS account_pool (
      account_id TEXT PRIMARY KEY DEFAULT ('account-' || gen_random_uuid()::text),
      display_name TEXT NOT NULL,
      masked_login TEXT NOT NULL CHECK (masked_login !~ '^[0-9]{7,}$'),
      operator_owner TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available','reserved','in_use','cooldown','risk','retired')),
      risk_level TEXT NOT NULL DEFAULT 'normal'
        CHECK (risk_level IN ('normal','watch','blocked')),
      note TEXT,
      available_after TIMESTAMPTZ,
      assigned_worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      assigned_store_id TEXT REFERENCES stores(store_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS browser_slots (
      slot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id TEXT NOT NULL REFERENCES workers(worker_id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
      status TEXT NOT NULL DEFAULT 'unknown',
      profile_id TEXT REFERENCES profiles(profile_id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,
      target_store_id TEXT REFERENCES stores(store_id) ON DELETE SET NULL,
      remote_desktop_target TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (worker_id, label),
      UNIQUE (worker_id, port)
    );

    CREATE TABLE IF NOT EXISTS store_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_business_key TEXT NOT NULL UNIQUE CHECK (run_business_key ~ '^[a-f0-9]{64}$'),
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      run_label TEXT NOT NULL,
      schedule_window TEXT NOT NULL,
      scope_version TEXT NOT NULL,
      scope_manifest_id UUID,
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
      canonical_category_key TEXT NOT NULL,
      category_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 100,
      assigned_worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      assigned_account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,
      assigned_profile_id TEXT REFERENCES profiles(profile_id) ON DELETE SET NULL,
      assigned_cdp_endpoint_id TEXT REFERENCES cdp_endpoints(endpoint_id) ON DELETE SET NULL,
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
      storage_version_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bucket, object_key)
    );

    CREATE TABLE IF NOT EXISTS scope_manifests (
      scope_manifest_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE RESTRICT,
      scope_version TEXT NOT NULL,
      manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
      include_coupons BOOLEAN NOT NULL DEFAULT FALSE,
      categories JSONB NOT NULL,
      source_artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (store_id, manifest_hash)
    );

    CREATE TABLE IF NOT EXISTS price_quality_checks (
      quality_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID REFERENCES category_tasks(task_id) ON DELETE SET NULL,
      run_id UUID REFERENCES store_runs(run_id) ON DELETE SET NULL,
      store_id TEXT REFERENCES stores(store_id) ON DELETE SET NULL,
      worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,
      profile_id TEXT REFERENCES profiles(profile_id) ON DELETE SET NULL,
      artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      raw_rows INTEGER NOT NULL,
      unique_spu_count INTEGER NOT NULL,
      sku_rows INTEGER NOT NULL,
      front_display_price_present INTEGER NOT NULL,
      sku_front_display_price_present INTEGER NOT NULL,
      actual_price_info_present INTEGER NOT NULL DEFAULT 0,
      promotion_info_present INTEGER NOT NULL DEFAULT 0,
      dynamic_label_present INTEGER NOT NULL DEFAULT 0,
      duplicate_spu_count INTEGER NOT NULL DEFAULT 0,
      completeness_status TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_snapshots (
      snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      unique_key TEXT NOT NULL UNIQUE,
      artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      capture_id TEXT,
      store_run_id UUID REFERENCES store_runs(run_id) ON DELETE CASCADE,
      task_uuid UUID REFERENCES category_tasks(task_id) ON DELETE CASCADE,
      store_id TEXT NOT NULL,
      store_name TEXT,
      worker_id TEXT,
      account_id TEXT,
      account_label TEXT,
      profile_id TEXT,
      cdp_endpoint_id TEXT,
      cdp_port INTEGER,
      source TEXT,
      source_ts TIMESTAMPTZ,
      category_name TEXT NOT NULL,
      category_display_name TEXT,
      parent_category_name TEXT,
      category_order INTEGER,
      category_tag TEXT,
      spu_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      min_price NUMERIC,
      origin_price_text TEXT,
      unit TEXT,
      picture TEXT,
      month_saled_content TEXT,
      promotion_info TEXT,
      front_display_price_text TEXT,
      front_display_price_value NUMERIC,
      user_final_price_text TEXT,
      user_final_price_value NUMERIC,
      price_source_path TEXT,
      user_final_price_source_path TEXT,
      price_semantics TEXT NOT NULL DEFAULT 'front_display_only',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sku_snapshots (
      snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      unique_key TEXT NOT NULL UNIQUE,
      artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      capture_id TEXT,
      store_run_id UUID REFERENCES store_runs(run_id) ON DELETE CASCADE,
      task_uuid UUID REFERENCES category_tasks(task_id) ON DELETE CASCADE,
      store_id TEXT NOT NULL,
      worker_id TEXT,
      account_id TEXT,
      profile_id TEXT,
      cdp_endpoint_id TEXT,
      source_ts TIMESTAMPTZ,
      category_name TEXT NOT NULL,
      spu_id TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      spec TEXT,
      price NUMERIC,
      origin_price NUMERIC,
      stock INTEGER,
      status INTEGER,
      promotion_info TEXT,
      front_display_price_text TEXT,
      front_display_price_value NUMERIC,
      user_final_price_text TEXT,
      user_final_price_value NUMERIC,
      price_source_path TEXT,
      user_final_price_source_path TEXT,
      price_semantics TEXT NOT NULL DEFAULT 'front_display_only',
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_category_memberships (
      run_id UUID NOT NULL REFERENCES store_runs(run_id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES category_tasks(task_id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      spu_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      category_tag TEXT,
      category_order INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, store_id, spu_id, category_name)
    );

    CREATE TABLE IF NOT EXISTS ingestion_errors (
      error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      error_key TEXT UNIQUE,
      artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      run_id UUID REFERENCES store_runs(run_id) ON DELETE CASCADE,
      task_id UUID REFERENCES category_tasks(task_id) ON DELETE CASCADE,
      store_id TEXT REFERENCES stores(store_id) ON DELETE SET NULL,
      line_number INTEGER,
      error_code TEXT NOT NULL,
      error_message TEXT NOT NULL,
      raw_excerpt TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS data_deliveries (
      delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL UNIQUE REFERENCES store_runs(run_id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      product_count INTEGER NOT NULL DEFAULT 0,
      sku_count INTEGER NOT NULL DEFAULT 0,
      user_final_price_coverage NUMERIC(8,6) NOT NULL DEFAULT 0,
      raw_artifact_count INTEGER NOT NULL DEFAULT 0,
      export_artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
      last_error TEXT,
      frozen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS business_activity_events (
      activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES store_runs(run_id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES category_tasks(task_id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      category_name TEXT NOT NULL,
      status TEXT NOT NULL,
      collected_items INTEGER NOT NULL DEFAULT 0,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (task_id, status, collected_items)
    );

    CREATE TABLE IF NOT EXISTS operation_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      worker_id TEXT,
      account_id TEXT,
      profile_id TEXT,
      cdp_endpoint_id TEXT,
      store_id TEXT,
      task_id UUID,
      risk_id UUID,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS registry_sync_batches (
      batch_id UUID PRIMARY KEY,
      provider TEXT NOT NULL,
      source_base_id TEXT NOT NULL,
      schema_hash TEXT NOT NULL CHECK (schema_hash ~ '^[a-f0-9]{64}$'),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
      record_count INTEGER NOT NULL CHECK (record_count >= 0),
      status TEXT NOT NULL CHECK (status IN ('publishing','published','rejected')),
      issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS registry_sync_records (
      provider TEXT NOT NULL,
      source_table_id TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_version BIGINT NOT NULL CHECK (source_version > 0),
      content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('store','account','worker','collection_plan')),
      entity_id TEXT NOT NULL,
      last_batch_id UUID NOT NULL REFERENCES registry_sync_batches(batch_id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('published','rejected','conflict')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, source_table_id, source_record_id)
    );

    CREATE TABLE IF NOT EXISTS registry_sync_issues (
      issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID REFERENCES registry_sync_batches(batch_id) ON DELETE CASCADE,
      source_table_id TEXT,
      source_record_id TEXT,
      issue_code TEXT NOT NULL,
      business_message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS collection_plan_definitions (
      plan_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE RESTRICT,
      frequency TEXT NOT NULL,
      weekdays JSONB NOT NULL DEFAULT '[]'::jsonb,
      start_window TEXT,
      target_completion TEXT,
      planned_accounts INTEGER,
      priority TEXT NOT NULL DEFAULT 'normal',
      enabled_status TEXT NOT NULL DEFAULT 'draft',
      include_coupons BOOLEAN NOT NULL DEFAULT FALSE,
      raw_retention TEXT,
      notification_policy TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS worker_registry_metadata (
      registry_worker_id TEXT PRIMARY KEY,
      master_worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
      device_name TEXT NOT NULL,
      operating_system TEXT,
      device_owner TEXT,
      location TEXT,
      ssh_alias TEXT,
      remote_desktop_type TEXT,
      remote_desktop_target TEXT,
      planned_slots INTEGER,
      maximum_slots INTEGER,
      maintenance_window TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dedupe_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL CHECK (channel IN ('dingtalk')),
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','delivering','sent','retryable_failure','outcome_unknown','dead_letter')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_attempt_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      provider_code TEXT,
      provider_message TEXT,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_worker_received ON worker_heartbeats(worker_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_worker_credentials_worker ON worker_credentials(worker_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_accounts_worker ON accounts(worker_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_worker ON profiles(worker_id);
    CREATE INDEX IF NOT EXISTS idx_account_pool_status ON account_pool(status, available_after, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_pool_owner ON account_pool(operator_owner, status);
    CREATE INDEX IF NOT EXISTS idx_cdp_endpoints_worker ON cdp_endpoints(worker_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cdp_endpoints_account ON cdp_endpoints(account_id);
    CREATE INDEX IF NOT EXISTS idx_cdp_commands_worker_status ON cdp_commands(worker_id, status, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_risk_events_status ON risk_events(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_store_runs_store ON store_runs(store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_browser_slots_worker ON browser_slots(worker_id, status, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot_account ON browser_slots(account_id) WHERE account_id IS NOT NULL AND status <> 'retired';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot_profile ON browser_slots(profile_id) WHERE profile_id IS NOT NULL AND status <> 'retired';
    CREATE INDEX IF NOT EXISTS idx_category_tasks_run_status ON category_tasks(run_id, status, priority ASC);
    CREATE INDEX IF NOT EXISTS idx_category_tasks_assignee ON category_tasks(assigned_worker_id, assigned_account_id, status);
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scope_manifests_store ON scope_manifests(store_id, frozen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_price_quality_run ON price_quality_checks(run_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_price_quality_task ON price_quality_checks(task_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_snapshots_run ON product_snapshots(run_id, store_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_product_snapshots_task ON product_snapshots(task_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_product_snapshots_store ON product_snapshots(store_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sku_snapshots_run ON sku_snapshots(run_id, store_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_sku_snapshots_task ON sku_snapshots(task_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_product_memberships_task ON product_category_memberships(task_id, category_name);
    CREATE INDEX IF NOT EXISTS idx_ingestion_errors_task ON ingestion_errors(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_data_deliveries_status ON data_deliveries(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_business_activity_occurred ON business_activity_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_events_created ON operation_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_events_task ON operation_events(task_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_events_account ON operation_events(account_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_events_profile ON operation_events(profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operation_events_cdp ON operation_events(cdp_endpoint_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_registry_sync_batches_started ON registry_sync_batches(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_registry_sync_records_entity ON registry_sync_records(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_registry_sync_issues_status ON registry_sync_issues(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collection_plan_store ON collection_plan_definitions(store_id, enabled_status);
    CREATE INDEX IF NOT EXISTS idx_worker_registry_master ON worker_registry_metadata(master_worker_id);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_dispatch
      ON notification_outbox(status, next_attempt_at, created_at);
  `);

  await db.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cdp_endpoint TEXT;
    ALTER TABLE cdp_endpoints ADD COLUMN IF NOT EXISTS slot_id UUID;
    ALTER TABLE cdp_commands ADD COLUMN IF NOT EXISTS slot_id UUID;
    ALTER TABLE cdp_commands ADD COLUMN IF NOT EXISTS claim_until TIMESTAMPTZ;
    ALTER TABLE cdp_commands ADD COLUMN IF NOT EXISTS claim_generation INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS boot_id TEXT;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS current_ip TEXT;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS disk_free_bytes BIGINT;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS clock_offset_ms INTEGER;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS remote_desktop JSONB NOT NULL DEFAULT '{"provider":"none","status":"unknown"}'::jsonb;
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS execution_snapshot JSONB;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cdp_endpoint TEXT;
    ALTER TABLE risk_events ADD COLUMN IF NOT EXISTS screenshot_artifact_id UUID;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS assigned_cdp_endpoint_id TEXT REFERENCES cdp_endpoints(endpoint_id) ON DELETE SET NULL;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS lease_owner TEXT;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS lease_generation INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS missing_spu_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS checkpoint_artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS raw_artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS summary_artifact_id UUID REFERENCES artifacts(artifact_id) ON DELETE SET NULL;
    ALTER TABLE product_snapshots ADD COLUMN IF NOT EXISTS capture_id TEXT;
    ALTER TABLE product_snapshots ADD COLUMN IF NOT EXISTS store_run_id UUID REFERENCES store_runs(run_id) ON DELETE CASCADE;
    ALTER TABLE product_snapshots ADD COLUMN IF NOT EXISTS task_uuid UUID REFERENCES category_tasks(task_id) ON DELETE CASCADE;
    ALTER TABLE product_snapshots ADD COLUMN IF NOT EXISTS user_final_price_source_path TEXT;
    ALTER TABLE product_snapshots ADD COLUMN IF NOT EXISTS price_semantics TEXT NOT NULL DEFAULT 'front_display_only';
    ALTER TABLE sku_snapshots ADD COLUMN IF NOT EXISTS capture_id TEXT;
    ALTER TABLE sku_snapshots ADD COLUMN IF NOT EXISTS store_run_id UUID REFERENCES store_runs(run_id) ON DELETE CASCADE;
    ALTER TABLE sku_snapshots ADD COLUMN IF NOT EXISTS task_uuid UUID REFERENCES category_tasks(task_id) ON DELETE CASCADE;
    ALTER TABLE sku_snapshots ADD COLUMN IF NOT EXISTS user_final_price_source_path TEXT;
    ALTER TABLE sku_snapshots ADD COLUMN IF NOT EXISTS price_semantics TEXT NOT NULL DEFAULT 'front_display_only';
    ALTER TABLE ingestion_errors ADD COLUMN IF NOT EXISTS error_key TEXT UNIQUE;
    ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS storage_version_id TEXT;
    ALTER TABLE store_runs ADD COLUMN IF NOT EXISTS run_business_key TEXT;
    ALTER TABLE store_runs ADD COLUMN IF NOT EXISTS schedule_window TEXT;
    ALTER TABLE store_runs ADD COLUMN IF NOT EXISTS scope_version TEXT;
    ALTER TABLE store_runs ADD COLUMN IF NOT EXISTS scope_manifest_id UUID;
    ALTER TABLE category_tasks ADD COLUMN IF NOT EXISTS canonical_category_key TEXT;
  `);

  await db.query(`
    UPDATE product_snapshots p SET
      capture_id = COALESCE(p.capture_id, p.run_id),
      store_run_id = t.run_id,
      task_uuid = t.task_id
    FROM category_tasks t
    WHERE p.task_uuid IS NULL
      AND p.task_id = t.task_id::text;

    UPDATE sku_snapshots s SET
      capture_id = COALESCE(s.capture_id, s.run_id),
      store_run_id = t.run_id,
      task_uuid = t.task_id
    FROM category_tasks t
    WHERE s.task_uuid IS NULL
      AND s.task_id = t.task_id::text;

    UPDATE store_runs
    SET run_business_key = encode(digest(run_id::text, 'sha256'), 'hex')
    WHERE run_business_key IS NULL;

    UPDATE store_runs
    SET schedule_window = 'legacy:' || run_id::text
    WHERE schedule_window IS NULL;

    UPDATE store_runs
    SET scope_version = 'legacy'
    WHERE scope_version IS NULL;

    UPDATE category_tasks
    SET canonical_category_key = 'legacy:' || task_id::text
    WHERE canonical_category_key IS NULL;

    ALTER TABLE store_runs ALTER COLUMN run_business_key SET NOT NULL;
    ALTER TABLE store_runs ALTER COLUMN schedule_window SET NOT NULL;
    ALTER TABLE store_runs ALTER COLUMN scope_version SET NOT NULL;
    ALTER TABLE category_tasks ALTER COLUMN canonical_category_key SET NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_store_runs_business_key ON store_runs(run_business_key);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_category_tasks_run_category
      ON category_tasks(run_id, canonical_category_key);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_store_runs_scope_manifest'
      ) THEN
        ALTER TABLE store_runs
          ADD CONSTRAINT fk_store_runs_scope_manifest
          FOREIGN KEY (scope_manifest_id) REFERENCES scope_manifests(scope_manifest_id) ON DELETE RESTRICT;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_product_snapshots_store_run ON product_snapshots(store_run_id, store_id, spu_id);
    CREATE INDEX IF NOT EXISTS idx_sku_snapshots_store_run ON sku_snapshots(store_run_id, store_id, spu_id, sku_id);

    INSERT INTO business_activity_events (run_id, task_id, store_id, category_name, status, collected_items, occurred_at)
    SELECT run_id, task_id, store_id, category_name, status, collected_items, updated_at
    FROM category_tasks
    ON CONFLICT (task_id, status, collected_items) DO NOTHING;
  `);
}
