# Architecture

## System Boundary

The system coordinates collection tasks. It does not bypass authentication, captcha, or platform risk controls.

## Components

### Master API

Responsibilities:

- Store registry
- Worker registry
- Account/profile registry
- Task queue
- Risk event center
- Artifact registry
- Export orchestration
- Notification dispatch

First version:

- Fastify HTTP API
- WebSocket gateways for workers and dashboard clients
- PostgreSQL durable state
- Redis live presence and event fanout
- MinIO/S3-compatible artifact storage

### Worker Agent

Responsibilities:

- Register with master over WebSocket
- Send heartbeat over WebSocket
- Receive future commands over WebSocket
- Start local collection scripts
- Watch local status files
- Upload artifacts
- Report risk events
- Pause until master sends resume/reassign

Workers connect outbound to master. Master does not need inbound access to workers for normal task control.

### Codex Operator

Each device may run Codex App. Codex is a local intelligent operator, not the system communication protocol.

Codex helps with:

- local CDP/browser launch
- login checks
- page inspection
- script repair
- local incident documentation

### Dashboard

First version pages:

- Overview
- Stores
- Runs
- Workers
- Accounts and profiles
- Risk events
- Artifacts and exports

## Data Flow

```text
master creates run
  -> scheduler creates category tasks
  -> worker receives or pulls task
  -> worker performs natural page0 capture
  -> worker runs low-frequency collection
  -> worker writes raw local JSONL
  -> worker uploads status through WebSocket/API and artifacts to MinIO/S3
  -> master indexes progress
  -> exporter creates business CSV
```

## Risk Flow

```text
worker detects captcha / 403 / 418 / account block / device risk
  -> task paused
  -> risk event created
  -> master sends notification
  -> human handles issue
  -> master resumes, reassigns, or retires account/profile/device
```

## Account Block Rule

If an account can log in but cannot see store product information after entering the store, mark:

- account: `account_blocked`
- profile: `profile_risk`
- task: `paused`

Recovery requires a different account and a new profile.

If multiple accounts on one device show this behavior at the same time, mark the worker as `device_risk` and stop assigning tasks to that device until reviewed.

## Data Layers

### Raw Layer

Immutable source of truth:

- raw results JSONL
- natural responses
- status JSONL
- risk logs
- category plan
- screenshots/snapshots when needed

### Normalized Layer

SPU/SKU table preserving original product names.

### Business View

Template-specific CSV/Excel export. Capture metadata is omitted unless explicitly requested.

## Security Rules

- No credentials in repository.
- No phone numbers in logs.
- No profile directories in repository.
- No raw captured production data in public repository.
- Worker shared tokens must be stored in `.env`, never committed.

## Phase 1 Baseline

Phase 1 starts with the production baseline:

- PostgreSQL, not SQLite.
- Redis, not in-memory presence.
- MinIO/S3, not local-only artifacts.
- WebSocket, not HTTP polling only.
- Account/profile/CDP identity in heartbeat from day one.
