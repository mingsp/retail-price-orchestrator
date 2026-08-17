# Implementation Roadmap

> 2026-07-15 更新：Phase 1-7 以及 Phase 9 中的核心生产加固已经实现并通过隔离生产栈验证。当前关键路径不再是补 demo 页面，而是将同一套 Master 部署到 `xf`，再用标准安装器接入 `mm/jl` 并完成真实设备故障演练。

## Phase 0: Repository and Design

- Public repository with docs only.
- No real store data.
- No credentials.
- No browser profiles.

## Phase 1: Master + Worker Heartbeat

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

Status: implemented and runtime verified on `mm`.

## Phase 2: Account/Profile Registry

Build:

- account registry API
- profile registry API
- account status update API
- profile status update API
- risk event API
- dashboard account/profile/risk views

Deliverable:

- operators can identify which account is in which profile/CDP/device and mark risk state.

Status: implemented as control-plane APIs and dashboard views.

## Phase 3: Task Model

Build:

- store model
- run model
- category task model
- account/profile model
- task status state machine

Deliverable:

- master can assign category tasks to worker/account pairs.

Status: implemented. Category tasks use fixed assignment, fenced leases, preflight store verification and checkpoint-gated migration; stale generations cannot write progress or artifacts.

## Phase 4: Risk Event Loop

Build:

- captcha/manual_required event
- account_blocked event
- profile_risk event
- device_risk event
- DingTalk notification adapter
- resume/reassign endpoint

Deliverable:

- Risk events enter dashboard queue and DingTalk.
- Operator can mark risk as acknowledged/resolved.
- Operator can mark account blocked, profile risk, worker device risk.
- Operator can pause, resume, sleep, or requeue a task.

Status: implemented. Risk events can link a browser screenshot artifact, notify DingTalk and preserve the exact task/account/Profile/CDP context for manual intervention.

## Phase 5: Artifact and Quality Pipeline

Build:

- artifact presign endpoint
- artifact metadata registry
- raw JSONL registry
- category plan registry
- export job model
- business Excel export
- product-name consistency check

Deliverable:

- Worker uploads raw JSONL, progress, checkpoint, summary, categories, screenshots.
- Master registers artifact metadata and checksum.
- Worker or export job registers price quality checks.
- Business Excel is generated only after quality check pass/warn.

Status: implemented. Raw JSONL, structured SPU/SKU rows, screenshot/checkpoint artifacts, quality gates, raw embedded SKU reconciliation and business exports form one traceable chain. Delivery freeze requires one raw JSONL per effective category and verifies the MinIO object size plus content SHA-256 before export.

## Phase 6: Stage-One Two-Store Production Run

Build:

- stage-one run planner
- 2-store weekly run setup
- 7-account allocation model
- category discovery and task creation
- native collector progress reporting
- colleague-facing Excel export

Deliverable:

- Current priority pair 乐购达（景耀店） and 呱呱超市（莲湖店） is collected through master/worker.
- 7 accounts are represented in account/profile/CDP registry.
- Both stores have business Excel exports.
- Dashboard shows full run history, risks, artifacts, and price quality.

## Phase 7: Dashboard MVP

Build:

- overview page
- workers page
- runs page
- tasks page
- risk events page
- artifacts page

Deliverable:

- operators can monitor and resume tasks without reading terminal logs.

Status: implemented as one Chinese collection-and-scheduling workbench, including truthful progress, Worker/account/Profile/CDP mapping, risk intervention, artifact delivery and concise live activity.

## Phase 8: Scale to Six Stores

Build:

- final six-store run templates
- competitor-vs-own pairing model
- weekly cadence automation
- pair-level price quality dashboard
- batch export package

Deliverable:

- weekly runs for 乐购达景耀店 / 呱呱莲湖店, 犀牛西门店 / 呱呱南门店, 小柴购小寨店 / 呱呱雁塔店.

## Phase 9: Scale Hardening

Build:

- retry policies
- queue partitioning
- object lifecycle policies
- worker auto-update
- role-based dashboard access

Status:

- implemented: one-time Worker enrollment, independent credentials, operator/automation isolation, local durable spool, fenced leases, readiness checks, metrics, signed releases, transactional upgrade/rollback and MinIO/PostgreSQL/Redis production Compose;
- verified in isolated production stack: HTTPS/WSS, Worker enrollment, Browser Slot binding, task claim, stale lease rejection, public signed raw upload, SPU/SKU ingestion, quality validation, delivery freeze, Excel download, Redis degradation/recovery and full E2E after Master restart;
- pending on physical devices: Windows/macOS installation, Worker network loss, Chrome process termination, remote desktop intervention and cross-device checkpoint migration.

## Phase 10: XF Production Cutover

Build:

- assign a fixed LAN address and trusted hostname to `xf`;
- generate the production CA/server certificate and Ed25519 release signing key;
- deploy the Master Compose on `xf` and configure backup/retention/boot policies;
- enroll `mm` and `jl` with one-time tokens, then retire all shared Worker credentials;
- execute one small-category canary before the first two-store weekly batch;
- enable Master-side Codex supervision only after the canary and physical fault drills pass.

Status: deployment package ready; external production cutover not yet executed.
