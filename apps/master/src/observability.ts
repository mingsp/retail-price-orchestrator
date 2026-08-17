import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";

export interface RuntimeMetrics {
  dashboardConnections: () => number;
  businessConnections: () => number;
  workerConnections: () => number;
}

export function registerObservability(app: FastifyInstance, db: Pool, runtime?: RuntimeMetrics): void {
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  let httpRequests = 0;
  let httpErrors = 0;
  let httpDurationMs = 0;

  app.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, Date.now());
    reply.header("x-correlation-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    httpRequests++;
    if (reply.statusCode >= 500) httpErrors++;
    httpDurationMs += Math.max(0, Date.now() - (requestStartedAt.get(request) || Date.now()));
  });

  app.get("/metrics", async (_request, reply) => {
    const result = await db.query(`
      SELECT
        (SELECT count(*) FROM workers WHERE last_seen_at > now() - interval '90 seconds')::int AS online_workers,
        (SELECT count(*) FROM category_tasks WHERE status IN ('assigned','running','collecting','captured','uploading','structuring','validating'))::int AS active_tasks,
        (SELECT count(*) FROM category_tasks WHERE status IN ('manual_required','needs_review','failed'))::int AS attention_tasks,
        (SELECT count(*) FROM category_tasks WHERE lease_until IS NOT NULL AND lease_until < now())::int AS expired_leases,
        (SELECT count(*) FROM risk_events WHERE status <> 'resolved')::int AS open_risks,
        (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0) FROM risk_events WHERE status <> 'resolved')::bigint AS oldest_open_risk_seconds,
        (SELECT count(*) FROM product_snapshots)::int AS product_snapshots,
        (SELECT count(*) FROM ingestion_errors)::int AS ingestion_errors,
        (SELECT count(*) FROM operation_events WHERE action = 'task.lease_conflict')::int AS lease_conflicts,
        (SELECT count(*) FROM price_quality_checks WHERE completeness_status <> 'pass')::int AS quality_failures,
        (SELECT count(*) FROM notification_outbox WHERE status = 'dead_letter')::int AS notification_dead_letters,
        (SELECT count(*) FROM notification_outbox WHERE status = 'outcome_unknown')::int AS notification_outcome_unknown,
        (SELECT count(*) FROM artifacts WHERE checksum_sha256 IS NULL OR storage_version_id IS NULL)::int AS invalid_artifacts,
        (SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(last_seen_at))), 0) FROM workers)::bigint AS oldest_worker_heartbeat_seconds,
        (SELECT count(*) FROM store_runs WHERE status NOT IN ('completed','completed_with_review','failed') AND scope_manifest_id IS NULL)::int AS active_runs_without_scope
    `);
    const row = result.rows[0];
    const metrics = [
      ["retail_orchestrator_online_workers", row.online_workers],
      ["retail_orchestrator_active_tasks", row.active_tasks],
      ["retail_orchestrator_attention_tasks", row.attention_tasks],
      ["retail_orchestrator_expired_leases", row.expired_leases],
      ["retail_orchestrator_open_risks", row.open_risks],
      ["retail_orchestrator_oldest_open_risk_seconds", row.oldest_open_risk_seconds],
      ["retail_orchestrator_product_snapshots_total", row.product_snapshots],
      ["retail_orchestrator_ingestion_errors_total", row.ingestion_errors],
      ["retail_orchestrator_lease_conflicts_total", row.lease_conflicts],
      ["retail_orchestrator_quality_failures_total", row.quality_failures],
      ["retail_orchestrator_notification_dead_letters", row.notification_dead_letters],
      ["retail_orchestrator_notification_outcome_unknown", row.notification_outcome_unknown],
      ["retail_orchestrator_invalid_artifacts", row.invalid_artifacts],
      ["retail_orchestrator_oldest_worker_heartbeat_seconds", row.oldest_worker_heartbeat_seconds],
      ["retail_orchestrator_active_runs_without_scope", row.active_runs_without_scope],
      ["retail_orchestrator_http_requests_total", httpRequests],
      ["retail_orchestrator_http_errors_total", httpErrors],
      ["retail_orchestrator_http_request_duration_seconds_sum", httpDurationMs / 1_000],
      ["retail_orchestrator_dashboard_websocket_connections", runtime?.dashboardConnections() || 0],
      ["retail_orchestrator_business_websocket_connections", runtime?.businessConnections() || 0],
      ["retail_orchestrator_worker_websocket_connections", runtime?.workerConnections() || 0]
    ];
    reply.type("text/plain; version=0.0.4");
    return `${metrics.map(([name, value]) => `${name} ${value}`).join("\n")}\n`;
  });
}
