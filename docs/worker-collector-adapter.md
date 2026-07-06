# Worker Collector Adapter

Last updated: 2026-07-06

## 1. Purpose

The worker collector adapter connects master-assigned category tasks to the existing Meituan H5 CDP collection scripts.

Current adapter:

- claims one pending category task from master;
- checks the worker account/profile eligibility before claiming;
- starts the legacy CDP script locally;
- updates task status to `running`, `manual_required`, `completed`, or `failed`;
- creates risk events when the legacy script reports verification/risk pause;
- uploads raw JSONL/log artifacts to MinIO by presigned URL;
- registers artifact metadata in PostgreSQL.

## 2. Safety Defaults

Task polling and execution are both disabled by default.

```powershell
WORKER_ENABLE_TASK_POLLING=false
WORKER_ENABLE_TASK_EXECUTION=false
```

To allow production execution, both must be enabled:

```powershell
$env:WORKER_ENABLE_TASK_POLLING="true"
$env:WORKER_ENABLE_TASK_EXECUTION="true"
```

This prevents a worker from accidentally claiming a real category task before the operator has confirmed the browser, profile, CDP port, category plan, and natural request source.

## 3. Required Local Preconditions

Before a worker can execute a category task:

1. Chrome must already be running with remote debugging enabled.
2. The correct Meituan account must be logged in.
3. The account must be bound to the worker snapshot with the correct CDP port.
4. The target store page must be open and usable in that CDP page.
5. The worker must have a fresh natural request source file:

```text
meituan-natural-responses-YYYYMMDD.jsonl
```

6. The worker must have a category plan file if the legacy script needs tag mapping:

```text
songshu-category-plan-YYYYMMDD.json
```

7. The task category name should match the category name in the local category plan, or the task cursor should contain a `categoryTag`.

## 4. Worker Environment

```powershell
$env:MASTER_BASE_URL="http://127.0.0.1:17890"
$env:WORKER_ID="mm-worker"
$env:WORKER_SHARED_TOKEN="change-me"
$env:WORKER_ENABLE_TASK_POLLING="true"
$env:WORKER_ENABLE_TASK_EXECUTION="true"
$env:WORKER_TASK_POLLING_INTERVAL_MS="30000"
$env:WORKER_LEGACY_SCRIPT_ROOT=".."
$env:WORKER_LEGACY_SCRIPT_NAME="mt-cdp-inpage-category-products.mjs"
$env:WORKER_CATEGORY_PLAN_FILE="songshu-category-plan-20260706.json"
$env:WORKER_ARTIFACT_BUCKET="raw-artifacts"
```

The account/CDP mapping is still passed through `WORKER_ACCOUNTS_JSON`.

## 5. Risk Handling

When the legacy script emits:

- `risk_pause`
- `risk_pause_waiting`
- `inpage_response_risk`

the adapter:

- marks the task as `manual_required`;
- creates a risk event;
- keeps the legacy process alive if the script is waiting for manual handling;
- expects the operator to handle the browser page and create the resume marker file printed by the script.

## 6. Information Needed From Operators

For each worker machine, provide:

- SSH host, username, and authentication method if remote setup is needed.
- Master URL reachable from that machine.
- Worker ID, for example `jl-worker` or `xf-worker`.
- Account aliases and masked phone labels.
- Profile paths.
- CDP ports.
- Whether the network is direct or proxy.
- Store URL.
- Local path to the category plan file.
- Confirmation that `meituan-natural-responses-YYYYMMDD.jsonl` exists after natural browsing.

## 7. Current Limitation

The first adapter intentionally reuses the existing low-frequency CDP scripts. It does not yet generate the category plan or natural request source automatically. Those will become separate worker commands:

- `prepare-store-session`
- `capture-category-plan`
- `execute-category-task`
- `normalize-run-export`
