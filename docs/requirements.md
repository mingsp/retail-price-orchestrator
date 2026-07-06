# Retail Price Orchestrator Requirements

Last updated: 2026-07-06

## 1. Business Objective

Build a long-running distributed collection control system for authorized retail price monitoring.

The current deployment has three devices:

| Device | Role | Notes |
|---|---|---|
| `xf` | master + worker | central scheduler, dashboard, data collector, and one local worker |
| `mm` | worker | current Windows device |
| `jl` | worker | Mac laptop |

The system must scale beyond the current three devices. New workers, accounts, profiles, and stores should be added through configuration and dashboard workflows, not ad hoc manual coordination.

## 2. Required Outcomes

### 2.1 Phase 1 Outcome

Phase 1 must deliver:

- A production-oriented master API.
- WebSocket worker connections from day one.
- Worker registration and heartbeat.
- Worker account/profile/CDP identity reporting.
- PostgreSQL persistence.
- Redis-backed live presence and event fanout.
- MinIO/S3 artifact storage health integration.
- Dashboard worker status page.
- No real store data or credentials committed to Git.

### 2.2 Long-Term Outcome

The full system must support:

- multi-device collection
- multi-account scheduling
- account/profile risk tracking
- store/category task assignment
- human-in-the-loop verification handling
- raw artifact ingestion
- business export generation
- operational dashboard
- scalable storage and state

## 3. Non-Goals

- No captcha bypass.
- No account-risk evasion.
- No hidden credential capture.
- No committed browser profiles.
- No committed raw production data.
- No hardcoded cookies, profile identifiers, request IDs, or account phone numbers.

## 4. Production Technology Baseline

The system should not start with throwaway storage or transport.

Required baseline:

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | shared master/worker/dashboard types |
| Master API | Fastify | high-performance Node server with explicit plugin boundaries |
| Realtime | WebSocket | worker live state, dashboard live state, future control messages |
| Database | PostgreSQL | durable relational state for workers/accounts/tasks/risk |
| Cache / presence | Redis | live worker presence, event fanout, future queues |
| Artifact storage | MinIO/S3 | raw JSONL, screenshots, exports, logs |
| Dashboard | React + Vite | fast operational UI |
| Package manager | pnpm workspace | multi-app monorepo |
| Runtime deployment | Docker Compose for infra, native Node for workers | easy local and multi-device setup |

## 5. Worker Identity Requirements

Every worker heartbeat must include:

- `workerId`: stable device-level ID, for example `mm-worker`.
- `machineLabel`: human-readable machine name, for example `mm Windows`.
- `hostname`.
- `os`.
- `agentVersion`.
- `codexOperator`: whether Codex is available on this machine.
- `networkMode`: `direct`, `proxy`, `unknown`.
- `capabilities`: `chrome_cdp`, `local_artifacts`, `codex_operator`, etc.
- active accounts.
- active profiles.
- active CDP ports.

## 6. Account Identification Requirements

The system must make it easy to identify which account is logged into which profile/CDP/device.

Account records must support:

- `accountId`: stable alias, for example `account-07`.
- `displayName`: operator-facing label, for example `A07-xf-main`.
- `maskedLogin`: optional masked phone or label, never full phone by default.
- `workerId`: assigned device.
- `profileId`: current profile.
- `cdpPort`: current Chrome CDP port.
- `status`: `safe`, `running`, `cooldown`, `manual_required`, `account_blocked`, `retired`.
- `riskLevel`: `normal`, `watch`, `high`, `blocked`.
- `lastVerifiedAt`.
- `lastRiskAt`.
- `currentStoreId`.
- `currentCategoryName`.

Dashboard must show worker, account, profile, and CDP together on one row so operators can identify the exact browser window when risk appears.

## 7. Profile Requirements

Profile records must support:

- `profileId`
- `workerId`
- `profilePath`
- `cdpPort`
- `status`: `safe`, `profile_risk`, `retired`
- `boundAccountId`
- `riskCount`
- `lastRiskAt`

Rules:

- One account should normally bind to one profile.
- If an account is blocked, replace both account and profile for the task.
- A `profile_risk` profile must not be reused for a new account.

## 8. Risk Requirements

The system must distinguish:

| Risk | Detection | Required Action |
|---|---|---|
| Captcha / identity check | visible verification or HTTP 418 | pause task, notify human |
| Interface risk | HTTP 403 or platform error code | cooldown, do not rapid retry |
| Account block | login works but store products are invisible | mark account blocked, mark profile risk, require account + profile replacement |
| Device/IP risk | multiple accounts on one device show product invisibility | mark worker device risk, stop assigning tasks to that worker |

Risk events must contain:

- worker
- account
- profile
- CDP port
- store
- category
- page or phase
- observed symptom
- recommended action
- status
- timestamps

## 9. Dashboard Requirements

Phase 1 dashboard must show:

- all workers
- online/offline status
- last heartbeat time
- active WebSocket session count
- current account/profile/CDP summary
- worker status: `online`, `offline`, `degraded`, `device_risk`
- latest log summary

Later dashboard pages:

- store runs
- task assignments
- accounts
- profiles
- risk events
- artifacts
- exports
- settings

UI style:

- operational console
- dense but readable tables
- clear status colors
- no marketing hero page
- no decorative layout

## 10. Data Requirements

Data layers:

1. Raw artifacts in MinIO/S3.
2. PostgreSQL metadata and normalized indexes.
3. Business exports generated from raw + normalized data.

Raw data must be preserved first. Business format can change later.

Product names must remain exactly as collected in raw data. Export jobs must validate product names before producing final files.

## 11. Phase List

| Phase | Name | Goal |
|---:|---|---|
| 0 | Production foundation | repo, docs, Docker infra, env schema |
| 1 | Worker heartbeat | master WS, worker registration, dashboard worker page |
| 2 | Account/profile registry | account identification, CDP/profile mapping |
| 3 | Store/run/task scheduler | category assignment and task state machine |
| 4 | Risk event loop | captcha/account/device risk notification and resume/reassign |
| 5 | Artifact pipeline | MinIO uploads, raw manifests, export jobs |
| 6 | Collection integration | wrap existing CDP collection scripts as worker tasks |
| 7 | Dashboard operations | full operator console |
| 8 | Scaling hardening | auth, RBAC, metrics, HA, backup, deployment automation |

