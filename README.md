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

## Planned Tech Stack

| Layer | First Version | Later Scale Path |
|---|---|---|
| Master API | Node.js + TypeScript + Fastify | Same or NestJS if complexity grows |
| Database | SQLite + Drizzle ORM | PostgreSQL |
| Worker Agent | Node.js + TypeScript | Same |
| Dashboard | React + Vite + TanStack Query | Same |
| Realtime | HTTP polling | WebSocket |
| Files | Local artifact directory | MinIO/S3 |
| Notifications | DingTalk webhook | DingTalk/Feishu/WeCom routing |
| Process | launchctl / Windows Task Scheduler | systemd/daemon manager where available |

## Repository Status

This repository starts with product and architecture design documents. Implementation should proceed from the implementation plan in `docs/implementation-roadmap.md`.

