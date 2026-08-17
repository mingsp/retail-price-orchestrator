# Worker Collector Adapter

Last updated: 2026-07-06

## 1. Purpose

The worker collector adapter connects master-assigned category tasks to the existing Meituan H5 CDP collection scripts.

Current adapters:

- claims one pending category task from master;
- checks the worker account/profile eligibility before claiming;
- starts either the legacy CDP script or the native page-runtime collector locally;
- updates task status to `running`, `manual_required`, `completed`, or `failed`;
- creates risk events when the script reports verification/risk pause;
- uploads raw JSONL/log artifacts to MinIO by presigned URL;
- registers artifact metadata in PostgreSQL.

Adapter modes:

| Mode | Env | Purpose |
|---|---|---|
| Legacy | `WORKER_COLLECTOR_ADAPTER=legacy` | Keeps compatibility with earlier CDP scripts. |
| Native | `WORKER_COLLECTOR_ADAPTER=native` | Production path based on page runtime functions, category cache, `allSortedSpuId`, and missing-ID smooth fill. |

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
5. For legacy mode, the worker must have a fresh natural request source file:

```text
meituan-natural-responses-YYYYMMDD.jsonl
```

6. The worker must have a category plan file if the legacy script needs tag mapping:

```text
songshu-category-plan-YYYYMMDD.json
```

7. For native mode, the task category name should match the page runtime category display name, or the task cursor should contain `categoryTag`, `categoryI`, and `categoryJ`.

Native mode does not reuse fixed UUID, cookie, token, `wm_uuid`, `wm_visitid`, or old request parameters. It calls the already-open page's own runtime functions.

## 4. Worker Environment

```powershell
$env:MASTER_BASE_URL="http://127.0.0.1:17890"
$env:WORKER_ID="mm-worker"
$env:WORKER_SHARED_TOKEN="change-me"
$env:WORKER_ENABLE_TASK_POLLING="true"
$env:WORKER_ENABLE_TASK_EXECUTION="true"
$env:WORKER_TASK_POLLING_INTERVAL_MS="30000"
$env:WORKER_COLLECTOR_ADAPTER="native"
$env:WORKER_LEGACY_SCRIPT_ROOT=".."
$env:WORKER_LEGACY_SCRIPT_NAME="mt-cdp-inpage-category-products.mjs"
$env:WORKER_CATEGORY_PLAN_FILE="songshu-category-plan-20260706.json"
$env:WORKER_NATIVE_SCRIPT_ROOT="scripts"
$env:WORKER_NATIVE_SCRIPT_NAME="native-cdp-store-capture.mjs"
$env:WORKER_NATIVE_OUTPUT_ROOT=".runtime/native-capture"
$env:WORKER_NATIVE_DELAY_MIN_MS="45000"
$env:WORKER_NATIVE_DELAY_MAX_MS="120000"
$env:WORKER_NATIVE_CATEGORY_REST_MIN_MS="90000"
$env:WORKER_NATIVE_CATEGORY_REST_MAX_MS="240000"
$env:WORKER_NATIVE_RISK_SLEEP_MS="3600000"
$env:WORKER_NATIVE_DYNAMIC_CHUNK_MODE="balanced"
$env:WORKER_NATIVE_ALLOW_PAGE_FALLBACK="false"
$env:WORKER_ARTIFACT_BUCKET="raw-artifacts"
```

The account/CDP mapping is still passed through `WORKER_ACCOUNTS_JSON`.

## 5. Native Collector Strategy

The native collector is the preferred production path after the 2026-07-07 single-account validation.

It runs one claimed category task on one account/CDP profile:

```text
1. Connect to the already-open CDP page.
2. Verify the page is a usable Meituan H5 store page, not login/403/verification.
3. Read `food_spu_tags` from the page store.
4. Match the assigned category by `categoryI/categoryJ`, `categoryTag`, or category display name.
5. Read `_getCachedData(i, j)`.
6. If needed, call `requestSpusAndSortedIds(i, j, tag, type, 0, false)` once to populate `allSortedSpuId`.
7. Compute missing product IDs from `allSortedSpuId - cached.spus`.
8. Call `requestSmoothSpus(ids, i, j, tag, type, {}, true)` with a dynamic chunk size.
9. Re-read cache after every chunk and continue until the category is complete or risk/manual intervention is needed.
10. Write raw JSONL first. Cleaning/export happens later.
```

Dynamic chunk rule:

```text
chunkSize = min(page method cap, observed smooth window, remainingMissing)
```

Important:

- It does not use fixed `20` pagination as the main path.
- It does not use fixed `30/60/90` probing as production behavior.
- The default observed smooth window is `30` only as a fallback from prior validation; production tasks can override it through task cursor `observedSmoothChunkSize`.
- `WORKER_NATIVE_ALLOW_PAGE_FALLBACK=false` by default to avoid reverting to high-request page-by-page collection.

Useful task cursor fields:

```json
{
  "targetUrlPart": "poi_id_str or another stable URL substring",
  "categoryI": 10,
  "categoryJ": 0,
  "categoryTag": "790108458_27",
  "observedSmoothChunkSize": 30
}
```

Native artifacts per task:

```text
<runId>.products.raw.jsonl
<runId>.categories.jsonl
<runId>.progress.jsonl
<runId>.summary.json
<runId>.checkpoint.json
```

All files are uploaded to MinIO/S3 after the script exits and registered in the artifact table.

## 6. Notification Policy

DingTalk must stay low-noise.

The system sends:

```text
Risk events: immediately, via master risk event route.
Store/run progress: only at 50% and 100%, evaluated by master after task updates.
Per request/per chunk/per category: no DingTalk notification.
```

Run milestone notifications are deduplicated in Redis for 14 days:

```text
notify:run:<runId>:milestone:50
notify:run:<runId>:milestone:100
```

For 50%/100% to be accurate, category tasks should have `expectedItems` populated from the category plan.

## 7. Risk Handling

When the script emits:

- `risk_pause`
- `risk_pause_waiting`
- `inpage_response_risk`

the adapter:

- marks the task as `manual_required`;
- creates a risk event;
- keeps the collector process alive if the script is waiting for manual handling;
- expects the operator to handle the browser page and create the resume marker file printed by the script.

Native risk handling:

```text
The collector waits for `<runId>.risk-resume.ok` in the task output directory.
If no marker appears, it waits for `WORKER_NATIVE_RISK_SLEEP_MS`, then retries slowly.
It never repeatedly hammers the interface during a risk state.
```

## 8. Information Needed From Operators

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

For native mode, also provide:

- Target store URL or stable URL substring for each task cursor.
- Category plan with `categoryI`, `categoryJ`, `categoryTag`, and `expectedItems`.
- Account/profile/CDP label visible in the CDP identity page.
- Confirmation that the page can open the target instant retail store before claiming tasks.

## 9. Current Limitation

The adapter can execute category tasks, but it does not yet generate category tasks automatically from a live store page. These remain separate worker/master commands:

- `prepare-store-session`
- `capture-category-plan`
- `execute-category-task`
- `normalize-run-export`
