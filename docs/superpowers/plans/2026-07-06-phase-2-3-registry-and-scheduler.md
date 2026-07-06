# Phase 2-3 Registry and Scheduler Foundation Plan

**Goal:** Extend the Phase 1 heartbeat foundation into an operator-usable control plane for account/profile identification and category-level task assignment.

## Task 1: Account/Profile Registry API

- [x] Add account list/detail endpoints.
- [x] Add profile list/detail endpoints.
- [x] Add account status update endpoint.
- [x] Add profile status update endpoint.
- [x] Preserve masked-account-only data handling.

## Task 2: Risk Event API

- [x] Add risk event list endpoint.
- [x] Add risk event create endpoint.
- [x] Add risk event status update endpoint.
- [x] Broadcast created risk events to dashboard clients.

## Task 3: Dashboard Registry Views

- [x] Add dashboard tab navigation.
- [x] Add account table with worker/profile/CDP mapping.
- [x] Add profile table with risk count and binding.
- [x] Add risk event table.

## Task 4: Task Control Plane

- [x] Add `stores` table.
- [x] Add `store_runs` table.
- [x] Add `category_tasks` table.
- [x] Add store CRUD foundation.
- [x] Add run creation/listing.
- [x] Add category task creation/listing.
- [x] Add task status/progress/assignment update endpoint.

## Task 5: Dashboard Task Views

- [x] Add stores view.
- [x] Add runs view.
- [x] Add category tasks view.
- [x] Show worker/account/profile assignment on task rows.

## Task 6: Verification

- [x] Run `pnpm typecheck`.
- [x] Verify `/api/accounts`.
- [x] Verify `/api/profiles`.
- [x] Verify `/api/risk-events`.
- [x] Verify store/run/task creation with `system-test-store`.
- [x] Verify task assignment to `mm-worker/account-01/profile-account-01`.
- [x] Verify dashboard HTTP 200.

## Next Implementation Slice

- [x] Add worker task polling or WebSocket command protocol.
- [x] Add task claim endpoint with account/profile eligibility checks.
- [x] Add artifact upload metadata and MinIO object registration.
- [x] Add dashboard actions for task/account/profile state transitions.
- [ ] Add notification adapter for manual verification events.

Verification:

- `/api/tasks/claim` first call claimed `Test Category B`.
- Second claim call returned `no_task`, confirming pending tasks are not double assigned.
- Worker task polling is controlled by `WORKER_ENABLE_TASK_POLLING`; default is `false`.
- `/api/artifacts/presign` returned a MinIO presigned PUT URL.
- `/api/artifacts` registered a `raw_jsonl` artifact metadata row.
- Account action API changed `account-02` to `cooldown` and restored it to `safe`.
