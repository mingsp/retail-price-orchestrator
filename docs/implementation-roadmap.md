# Implementation Roadmap

## Phase 0: Repository and Design

- Public repository with docs only.
- No real store data.
- No credentials.
- No browser profiles.

## Phase 1: Master Skeleton

Build:

- Fastify app
- PostgreSQL connection
- Redis connection
- MinIO/S3 health check
- WebSocket worker gateway
- WebSocket dashboard gateway
- health endpoint
- worker registration endpoint
- heartbeat endpoint
- HTTP worker snapshot endpoint
- worker account/profile/CDP snapshot persistence

Deliverable:

- master can show registered workers, latest heartbeat, and account/profile/CDP identity.

## Phase 2: Worker Agent Skeleton

Build:

- worker config loader
- worker registration
- heartbeat loop
- WebSocket connection loop
- local command runner abstraction
- local artifact watcher

Deliverable:

- mm/jl/xf workers appear online in master and dashboard.

## Phase 3: Task Model

Build:

- store model
- run model
- category task model
- account/profile model
- task status state machine

Deliverable:

- master can assign category tasks to worker/account pairs.

## Phase 4: Risk Event Loop

Build:

- captcha/manual_required event
- account_blocked event
- profile_risk event
- device_risk event
- DingTalk notification adapter
- resume/reassign endpoint

Deliverable:

- worker can pause and request human intervention through master.

## Phase 5: Artifact Pipeline

Build:

- artifact upload endpoint
- raw JSONL registry
- category plan registry
- export job model
- business CSV export
- product-name consistency check

Deliverable:

- one store run produces a clean business CSV from raw worker artifacts.

## Phase 6: Dashboard MVP

Build:

- overview page
- workers page
- runs page
- tasks page
- risk events page
- artifacts page

Deliverable:

- operators can monitor and resume tasks without reading terminal logs.

## Phase 7: Scale Hardening

Build:

- retry policies
- queue partitioning
- object lifecycle policies
- worker auto-update
- role-based dashboard access
