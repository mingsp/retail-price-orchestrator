# Phase 1 Worker Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-grade slice: master WebSocket API, worker heartbeat, account/profile/CDP identification, PostgreSQL persistence, Redis presence, MinIO health, and dashboard worker status page.

**Architecture:** The master exposes WebSocket endpoints for workers and dashboard clients. Workers connect outbound, register, and send heartbeats with account/profile/CDP snapshots. The dashboard reads live worker state over WebSocket and falls back to HTTP snapshots.

**Tech Stack:** TypeScript, Fastify, `@fastify/websocket`, PostgreSQL, Redis, MinIO/S3, React, Vite, TanStack Query, pnpm workspace.

---

## Task 1: Workspace and Shared Types

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/messages.ts`
- Create: `packages/shared/src/status.ts`
- Modify: `package.json`

- [x] Create shared package with worker, account, profile, and WebSocket message types.
- [x] Export status enums from one place.
- [x] Add root scripts for `dev:master`, `dev:worker`, `dev:dashboard`, and `typecheck`.

## Task 2: Production Infrastructure

**Files:**

- Create: `infra/docker-compose.yml`
- Create: `infra/postgres/init.sql`
- Modify: `.env.example`

- [x] Add PostgreSQL service.
- [x] Add Redis service.
- [x] Add MinIO service.
- [x] Add MinIO console port.
- [x] Add environment variables for all infrastructure.

## Task 3: Master API Skeleton

**Files:**

- Create: `apps/master/package.json`
- Create: `apps/master/tsconfig.json`
- Create: `apps/master/src/config.ts`
- Create: `apps/master/src/server.ts`
- Create: `apps/master/src/index.ts`

- [x] Create Fastify app.
- [x] Add `/health`.
- [x] Add `/ready` checking PostgreSQL, Redis, and MinIO.
- [x] Add structured logging.

## Task 4: Master Persistence

**Files:**

- Create: `apps/master/src/db.ts`
- Create: `apps/master/src/repositories/workers.ts`
- Create: `apps/master/src/repositories/risk-events.ts`
- Modify: `infra/postgres/init.sql`

- [x] Create tables for workers, worker heartbeats, accounts, profiles, risk events.
- [x] Implement upsert worker snapshot.
- [x] Implement heartbeat insert.
- [x] Implement worker list query.

## Task 5: Worker WebSocket Gateway

**Files:**

- Create: `apps/master/src/ws/worker-gateway.ts`
- Create: `apps/master/src/ws/dashboard-gateway.ts`
- Modify: `apps/master/src/server.ts`

- [x] Add `/ws/worker`.
- [x] Authenticate worker with shared token.
- [x] Accept `worker.register`.
- [x] Accept `worker.heartbeat`.
- [x] Persist heartbeat and account/profile snapshot.
- [x] Publish worker updates to Redis.
- [x] Broadcast worker updates to dashboard clients.

## Task 6: HTTP Snapshot API

**Files:**

- Create: `apps/master/src/routes/workers.ts`
- Modify: `apps/master/src/server.ts`

- [x] Add `GET /api/workers`.
- [x] Add `GET /api/workers/:workerId`.
- [x] Return latest heartbeat and account/profile/CDP summaries.

## Task 7: Worker Agent

**Files:**

- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/config.ts`
- Create: `apps/worker/src/local-snapshot.ts`
- Create: `apps/worker/src/connection.ts`
- Create: `apps/worker/src/index.ts`

- [x] Load worker config from env.
- [x] Build local account/profile/CDP snapshot from config JSON.
- [x] Connect to master WebSocket.
- [x] Send `worker.register`.
- [x] Send heartbeat every 10 seconds.
- [x] Reconnect with backoff.

## Task 8: Dashboard Worker Status Page

**Files:**

- Create: `apps/dashboard/package.json`
- Create: `apps/dashboard/tsconfig.json`
- Create: `apps/dashboard/index.html`
- Create: `apps/dashboard/src/main.tsx`
- Create: `apps/dashboard/src/App.tsx`
- Create: `apps/dashboard/src/api.ts`
- Create: `apps/dashboard/src/worker-status.tsx`
- Create: `apps/dashboard/src/styles.css`

- [x] Fetch initial worker snapshot from `GET /api/workers`.
- [x] Connect to `/ws/dashboard`.
- [x] Update worker table on `worker.updated`.
- [x] Show worker, account, profile, CDP, status, last heartbeat, and log summary.

## Task 9: Local Verification

**Commands:**

```powershell
pnpm install
pnpm typecheck
docker compose -f infra/docker-compose.yml up -d
pnpm dev:master
pnpm dev:worker
pnpm dev:dashboard
```

Expected:

- master `/ready` returns PostgreSQL, Redis, and MinIO healthy.
- worker appears in `/api/workers`.
- dashboard shows the worker online.
- account/profile/CDP fields are visible.

Status on 2026-07-06:

- [x] `pnpm install`
- [x] `pnpm typecheck`
- [ ] `docker compose -f infra/docker-compose.yml up -d`
- [ ] `pnpm dev:master`
- [ ] `pnpm dev:worker`
- [ ] `pnpm dev:dashboard`

Current blocker: Docker Desktop is not running on the Windows machine, so PostgreSQL/Redis/MinIO could not be started. Error: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
