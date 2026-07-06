# Retail Price Orchestrator

Distributed worker orchestration system for authorized retail price collection.

## What This Builds

This repository is the control system for a multi-device, multi-account, human-supervised collection workflow.

It is designed for:

- A master node that schedules store/category jobs.
- Multiple worker devices that run local browser/CDP collection tasks.
- Human-in-the-loop handling for login, captcha, identity checks, and account risk.
- Raw-first data storage, then configurable business-format exports.
- Long-term scaling from 3 devices to more devices, accounts, and stores.

## Non-Goals

- No captcha bypass.
- No account-risk evasion.
- No credential storage in this repository.
- No real captured store data in this repository.
- No hardcoded account, profile, cookie, or request identifiers.

## Architecture Summary

```text
xf-master
  - API
  - scheduler
  - worker registry
  - account/profile registry
  - risk event center
  - artifact collector
  - dashboard

mm-worker / jl-worker / xf-worker
  - local worker agent
  - local Chrome/CDP profiles
  - local raw JSONL artifacts
  - local Codex operator support
```

The system uses SSH only for deployment and troubleshooting. Normal coordination uses worker-initiated HTTP polling or WebSocket.

## Production Tech Stack

| Layer | First Version | Later Scale Path |
|---|---|---|
| Master API | Node.js + TypeScript + Fastify | Same, modularized by domain |
| Database | PostgreSQL | Read replicas / partitioning if needed |
| Presence / events | Redis | Redis Cluster if needed |
| Realtime | WebSocket | WebSocket + event bus |
| Artifact storage | MinIO/S3 | S3-compatible object storage |
| Worker Agent | Node.js + TypeScript | Same, packaged per OS |
| Dashboard | React + Vite + TanStack Query | Same |
| Notifications | DingTalk webhook | DingTalk/Feishu/WeCom routing |
| Process | launchctl / Windows Task Scheduler | systemd/daemon manager where available |

## Current Status

Implemented:

- master API with Fastify
- PostgreSQL, Redis, MinIO health integration
- worker WebSocket registration and heartbeat
- account/profile/CDP identity registry
- risk event API
- DingTalk webhook notification adapter for risk events
- store/run/category task API
- concurrent-safe task claiming
- MinIO presigned upload URL and artifact metadata registry
- React dashboard for workers, accounts, profiles, risks, stores, runs, tasks, and artifacts
- worker task polling client, disabled by default

## Local Run

Start infrastructure:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

Run master:

```powershell
pnpm dev:master
```

Run a worker:

```powershell
$env:MASTER_BASE_URL="http://127.0.0.1:17890"
$env:WORKER_ID="mm-worker"
$env:WORKER_SHARED_TOKEN="change-me"
$env:WORKER_ENABLE_TASK_POLLING="false"
pnpm dev:worker
```

Enable worker task claiming only when the operator is ready:

```powershell
$env:WORKER_ENABLE_TASK_POLLING="true"
$env:WORKER_TASK_POLLING_INTERVAL_MS="30000"
pnpm dev:worker
```

Run dashboard:

```powershell
pnpm dev:dashboard
```

Open:

- `http://localhost:2808/`
- LAN example: `http://192.168.100.57:2808/`

Start here for implementation context:

- `docs/requirements.md`
- `docs/technical-design.md`
- `docs/superpowers/plans/2026-07-06-phase-1-worker-heartbeat.md`
- `docs/superpowers/plans/2026-07-06-phase-2-3-registry-and-scheduler.md`
