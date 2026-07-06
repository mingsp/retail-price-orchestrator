# Technical Design

Last updated: 2026-07-06

## 1. Architecture

```text
Dashboard <---- WebSocket/SSE/HTTP ----> Master API
                                           |
                                           | PostgreSQL durable state
                                           | Redis live presence/events
                                           | MinIO/S3 artifact storage
                                           |
Worker Agent <------ WebSocket ----------> Master API
Worker Agent ------ artifact upload -----> MinIO/S3
Worker Agent ------ metadata/events -----> Master API
```

## 2. Apps and Packages

```text
apps/
  master/       Fastify API + WebSocket gateway
  worker/       local worker agent
  dashboard/    React operations console
packages/
  shared/       shared schemas, types, constants
infra/
  docker-compose.yml
  postgres/init.sql
```

## 3. Transport

### Worker WebSocket

Endpoint:

```text
ws://master:17890/ws/worker?workerId=mm-worker
```

Messages from worker:

- `worker.register`
- `worker.heartbeat`
- `worker.account_snapshot`
- `worker.risk_event`
- `worker.log_summary`

Messages from master:

- `master.register_ack`
- `master.heartbeat_ack`
- `master.command`
- `master.config_update`

### Dashboard WebSocket

Endpoint:

```text
ws://master:17890/ws/dashboard
```

Messages:

- `dashboard.snapshot`
- `worker.updated`
- `risk.created`

## 4. Database

PostgreSQL durable tables:

- `workers`
- `worker_heartbeats`
- `accounts`
- `profiles`
- `risk_events`
- `stores`
- `store_runs`
- `category_tasks`
- `artifacts`

Future tables:

- `exports`

## 5. Redis

Redis keys:

```text
presence:worker:{workerId}
worker:last_snapshot:{workerId}
events:worker
events:risk
```

Use Redis for:

- live presence
- dashboard fanout
- future task queues

PostgreSQL remains the source of durable truth.

## 6. MinIO/S3

Buckets:

```text
raw-artifacts
exports
screenshots
logs
```

Phase 1 only needs health checks and config validation. Artifact upload starts in Phase 5, but MinIO is included from the beginning to avoid storage redesign.

## 7. HTTP APIs

Worker and identity:

```text
GET /api/workers
GET /api/workers/:workerId
GET /api/accounts
GET /api/accounts/:accountId
PATCH /api/accounts/:accountId/status
GET /api/profiles
GET /api/profiles/:profileId
PATCH /api/profiles/:profileId/status
```

Risk loop:

```text
GET /api/risk-events
POST /api/risk-events
PATCH /api/risk-events/:riskId/status
```

Task control plane:

```text
GET /api/stores
POST /api/stores
GET /api/runs
POST /api/runs
GET /api/runs/:runId
GET /api/tasks
POST /api/tasks/claim
POST /api/runs/:runId/tasks
GET /api/tasks/:taskId
PATCH /api/tasks/:taskId
```

Task claiming uses account/profile eligibility checks and row locking (`FOR UPDATE SKIP LOCKED`) so multiple workers cannot claim the same pending category task.

Artifact pipeline:

```text
GET /api/artifacts
POST /api/artifacts
POST /api/artifacts/presign
```

Workers upload large raw files directly to MinIO/S3 by presigned URL, then register metadata in PostgreSQL. Master does not proxy large artifact bodies.

## 8. Worker Account Snapshot

Worker sends account/profile/CDP identification in every heartbeat.

Example:

```json
{
  "type": "worker.heartbeat",
  "sentAt": "2026-07-06T10:30:00.000Z",
  "worker": {
    "workerId": "mm-worker",
    "machineLabel": "mm Windows",
    "hostname": "MM-PC",
    "os": "Windows",
    "agentVersion": "0.1.0",
    "status": "online",
    "networkMode": "direct",
    "codexOperator": true
  },
  "accounts": [
    {
      "accountId": "account-01",
      "displayName": "A01-mm-main",
      "maskedLogin": "156****5952",
      "status": "safe",
      "profileId": "profile-account-01",
      "profileStatus": "safe",
      "profilePath": "browser-profiles/account-01-safe",
      "cdpPort": 9223,
      "currentStoreId": "",
      "currentCategoryName": ""
    }
  ]
}
```

## 9. Security

- Worker authenticates with shared token in Phase 1.
- Replace with per-worker token in Phase 2.
- No full phone numbers in dashboard by default.
- No credentials in logs.
- No profile directories in Git or artifact uploads.
