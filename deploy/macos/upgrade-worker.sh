#!/bin/bash
set -euo pipefail

MANIFEST_URL=""
MASTER_URL=""
WORKER_ID=""
WORKER_TOKEN=""
MASTER_VERSION=""
AUTOMATION_TOKEN=""
RELEASE_PUBLIC_KEY=""
RELEASE_KEY_ID=""
MASTER_CA=""
INSTALL_ROOT="$HOME/Library/Application Support/RetailRadar/Worker"
MANIFEST_VERIFIER=""
DRAIN_TIMEOUT=300
HEALTH_TIMEOUT=180
STABLE_HEALTH_SECONDS=30
INSTALL_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-url) MANIFEST_URL="$2"; shift 2 ;;
    --master-url) MASTER_URL="$2"; shift 2 ;;
    --master-version) MASTER_VERSION="$2"; shift 2 ;;
    --automation-token) AUTOMATION_TOKEN="$2"; shift 2 ;;
    --release-public-key) RELEASE_PUBLIC_KEY="$2"; shift 2 ;;
    --release-key-id) RELEASE_KEY_ID="$2"; shift 2 ;;
    --master-ca) MASTER_CA="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --manifest-verifier) MANIFEST_VERIFIER="$2"; shift 2 ;;
    --drain-timeout) DRAIN_TIMEOUT="$2"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
    --stable-health-seconds) STABLE_HEALTH_SECONDS="$2"; shift 2 ;;
    --install-only) INSTALL_ONLY=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$MANIFEST_URL" && -n "$MASTER_URL" && -n "$MASTER_VERSION" && -n "$RELEASE_PUBLIC_KEY" && -n "$RELEASE_KEY_ID" ]] \
  || { echo "manifest-url, master-url, master-version, release-public-key and release-key-id are required" >&2; exit 2; }
[[ "$RELEASE_KEY_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "release-key-id is invalid" >&2; exit 2; }

RELEASE_ROOT="$INSTALL_ROOT/releases"
CURRENT_LINK="$INSTALL_ROOT/current"
PREVIOUS_LINK="$INSTALL_ROOT/current.previous"
NEXT_LINK="$INSTALL_ROOT/current.next"
WORK_ROOT="$INSTALL_ROOT/work"
DRAIN_JOURNAL="$WORK_ROOT/upgrade-drained-tasks.txt"
IDENTITY_FILE="$INSTALL_ROOT/state/worker-identity.json"
PLIST="$HOME/Library/LaunchAgents/com.retailradar.worker.plist"
DOMAIN="gui/$(id -u)"
LABEL="com.retailradar.worker"
[[ -n "$MANIFEST_VERIFIER" ]] || MANIFEST_VERIFIER="$INSTALL_ROOT/service/verify-release-manifest.mjs"
mkdir -p "$RELEASE_ROOT" "$WORK_ROOT"

read_persisted_worker_id() {
  [[ -f "$IDENTITY_FILE" ]] || { echo "Worker identity file is missing: $IDENTITY_FILE" >&2; return 1; }
  node -e 'const fs=require("fs"),identity=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(typeof identity.workerId!=="string"||!identity.workerId.trim()||typeof identity.workerToken!=="string"||!identity.workerToken.trim())throw new Error("Worker identity file is incomplete");process.stdout.write(identity.workerId.trim())' "$IDENTITY_FILE"
}

read_persisted_worker_token() {
  node -e 'const fs=require("fs"),identity=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(typeof identity.workerToken!=="string"||!identity.workerToken.trim())throw new Error("Worker identity token is missing");process.stdout.write(identity.workerToken.trim())' "$IDENTITY_FILE"
}

if ! $INSTALL_ONLY; then
  WORKER_ID="$(read_persisted_worker_id)"
  WORKER_TOKEN="$(read_persisted_worker_token)"
fi

assert_https() {
  node -e 'const u=new URL(process.argv[1]);if(u.protocol!=="https:"||u.username||u.password)process.exit(1)' "$1" \
    || { echo "$2 must be an HTTPS URL without embedded credentials" >&2; return 1; }
}

assert_https "$MASTER_URL" "master-url"
assert_https "$MANIFEST_URL" "manifest-url"
[[ -f "$RELEASE_PUBLIC_KEY" ]] || { echo "release public key was not found" >&2; exit 1; }
[[ -f "$MANIFEST_VERIFIER" ]] || { echo "release manifest verifier was not found" >&2; exit 1; }

CURL_CA_ARGS=()
if [[ -n "$MASTER_CA" ]]; then
  [[ -f "$MASTER_CA" ]] || { echo "Master CA certificate was not found" >&2; exit 1; }
  CURL_CA_ARGS=(--cacert "$MASTER_CA")
elif [[ -f "$INSTALL_ROOT/certificates/master-ca.crt" ]]; then
  MASTER_CA="$INSTALL_ROOT/certificates/master-ca.crt"
  CURL_CA_ARGS=(--cacert "$MASTER_CA")
fi

version_at_least() {
  node -e 'const a=process.argv[1].split(/[-+]/)[0].split(".").map(Number),b=process.argv[2].split(/[-+]/)[0].split(".").map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))process.exit(0);if((a[i]||0)<(b[i]||0))process.exit(1)}' "$1" "$2"
}

active_task_ids() {
  [[ -n "$AUTOMATION_TOKEN" ]] || { echo "automation-token is required to query active Worker tasks" >&2; return 1; }
  curl --fail --silent --show-error --max-time 15 "${CURL_CA_ARGS[@]}" \
    -H "Authorization: Bearer $AUTOMATION_TOKEN" \
    "$MASTER_URL/api/automation/v1/workers/$WORKER_ID/active-tasks" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const t of JSON.parse(s).tasks||[])console.log(t.taskId)})'
}

save_drain_task() {
  local task_id="$1"
  touch "$DRAIN_JOURNAL"
  chmod 600 "$DRAIN_JOURNAL"
  grep -Fqx "$task_id" "$DRAIN_JOURNAL" || printf '%s\n' "$task_id" >> "$DRAIN_JOURNAL"
}

task_action() {
  local task_id="$1" action="$2"
  [[ -n "$AUTOMATION_TOKEN" ]] || { echo "automation-token is required for transactional task drain and recovery" >&2; return 1; }
  curl --fail --silent --show-error --max-time 15 "${CURL_CA_ARGS[@]}" -X POST \
    -H "Authorization: Bearer $AUTOMATION_TOKEN" -H "Content-Type: application/json" -d '{}' \
    "$MASTER_URL/api/automation/v1/tasks/$task_id/$action" >/dev/null
}

resume_drained_tasks() {
  [[ -f "$DRAIN_JOURNAL" ]] || return 0
  local deadline=$((SECONDS + DRAIN_TIMEOUT)) task_id remaining
  while (( SECONDS < deadline )); do
    remaining="$DRAIN_JOURNAL.next"
    : > "$remaining"
    while IFS= read -r task_id; do
      [[ -z "$task_id" ]] && continue
      task_action "$task_id" resume || printf '%s\n' "$task_id" >> "$remaining"
    done < "$DRAIN_JOURNAL"
    chmod 600 "$remaining"
    mv "$remaining" "$DRAIN_JOURNAL"
    [[ ! -s "$DRAIN_JOURNAL" ]] && { rm -f "$DRAIN_JOURNAL"; return 0; }
    sleep 3
  done
  echo "failed to resume drained tasks: $(paste -sd, "$DRAIN_JOURNAL")" >&2
  return 1
}

drain_worker() {
  local deadline=$((SECONDS + DRAIN_TIMEOUT)) ids task_id
  while (( SECONDS < deadline )); do
    ids="$(active_task_ids)" || return 1
    [[ -z "$ids" ]] && return 0
    while IFS= read -r task_id; do
      [[ -z "$task_id" ]] && continue
      save_drain_task "$task_id"
      task_action "$task_id" pause || return 1
    done <<< "$ids"
    sleep 2
  done
  echo "drain timed out; active tasks remain" >&2
  return 1
}

worker_state() {
  curl --fail --silent --show-error --max-time 10 "${CURL_CA_ARGS[@]}" \
    -H "Authorization: Bearer $WORKER_TOKEN" "$MASTER_URL/api/worker/self" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).worker.worker;if(w.status==="online"&&w.bootId&&w.agentVersion)process.stdout.write(`${w.bootId}\t${w.agentVersion}`)}catch{}})' || true
}

wait_worker_health() {
  local previous_boot="$1" expected_version="$2" deadline=$((SECONDS + HEALTH_TIMEOUT)) state boot version stable_since=0 now
  while (( SECONDS < deadline )); do
    state="$(worker_state)"
    boot="${state%%$'\t'*}"
    version="${state#*$'\t'}"
    if [[ -n "$state" && "$boot" != "$state" && ( -z "$previous_boot" || "$boot" != "$previous_boot" ) && "$version" == "$expected_version" ]]; then
      now="$(date +%s)"
      (( stable_since > 0 )) || stable_since="$now"
      (( now - stable_since >= STABLE_HEALTH_SECONDS )) && return 0
    else
      stable_since=0
    fi
    sleep 3
  done
  echo "health check failed: Worker did not remain online at version $expected_version for $STABLE_HEALTH_SECONDS seconds" >&2
  return 1
}

switch_release() {
  local target="$1"
  [[ ! -e "$NEXT_LINK" && ! -L "$NEXT_LINK" ]] || { echo "stale current.next blocks release switch" >&2; return 1; }
  [[ ! -e "$PREVIOUS_LINK" && ! -L "$PREVIOUS_LINK" ]] || { echo "stale current.previous blocks release switch" >&2; return 1; }
  ln -s "$target" "$NEXT_LINK"
  if [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then mv "$CURRENT_LINK" "$PREVIOUS_LINK"; fi
  mv "$NEXT_LINK" "$CURRENT_LINK"
}

rollback_release() {
  local failed_state failed_boot
  failed_state="$(worker_state)"
  failed_boot="${failed_state%%$'\t'*}"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  if [[ -e "$PREVIOUS_LINK" || -L "$PREVIOUS_LINK" ]]; then
    [[ ! -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]] || { echo "rollback refuses non-link current path" >&2; return 1; }
    rm -f "$CURRENT_LINK"
    mv "$PREVIOUS_LINK" "$CURRENT_LINK"
  fi
  [[ ! -e "$NEXT_LINK" || -L "$NEXT_LINK" ]] || { echo "rollback refuses non-link current.next path" >&2; return 1; }
  rm -f "$NEXT_LINK"
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  wait_worker_health "$failed_boot" "$OLD_VERSION"
  resume_drained_tasks
}

if ! $INSTALL_ONLY && [[ -f "$DRAIN_JOURNAL" ]]; then
  echo "Recovering tasks from an interrupted prior upgrade before starting a new transaction" >&2
  resume_drained_tasks
fi

MANIFEST_FILE="$WORK_ROOT/manifest-$RANDOM.json"
curl --fail --silent --show-error --max-time 30 "${CURL_CA_ARGS[@]}" "$MANIFEST_URL" -o "$MANIFEST_FILE"
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] && PLATFORM="macos-arm64" || PLATFORM="macos-x64"
VERIFIED_JSON="$(node "$MANIFEST_VERIFIER" --manifest "$MANIFEST_FILE" --public-key "$RELEASE_PUBLIC_KEY" --expected-key-id "$RELEASE_KEY_ID" --platform "$PLATFORM")"
MANIFEST_VALUES="$(printf '%s' "$VERIFIED_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);for(const v of [x.version,x.minimumMasterVersion,x.artifact.url,x.artifact.sha256,x.artifact.sizeBytes])console.log(v)})')"
VERSION="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '1p')"
MINIMUM_MASTER="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '2p')"
ARTIFACT_URL="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '3p')"
EXPECTED_SHA="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '4p')"
EXPECTED_SIZE="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '5p')"
assert_https "$ARTIFACT_URL" "artifact-url"
version_at_least "$MASTER_VERSION" "$MINIMUM_MASTER" || { echo "Master $MASTER_VERSION is below release minimum $MINIMUM_MASTER" >&2; exit 1; }

RELEASE_PATH="$RELEASE_ROOT/$VERSION"
[[ ! -e "$RELEASE_PATH" ]] || { echo "Release $VERSION already exists; clean interrupted release before retry" >&2; exit 1; }
if $INSTALL_ONLY && [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then echo "install-only requires an empty current release" >&2; exit 1; fi
if [[ -e "$NEXT_LINK" || -L "$NEXT_LINK" ]]; then [[ -L "$NEXT_LINK" ]] || { echo "current.next is not a managed link" >&2; exit 1; }; rm "$NEXT_LINK"; fi
[[ ! -e "$PREVIOUS_LINK" && ! -L "$PREVIOUS_LINK" ]] || { echo "interrupted release switch requires rollback before retry" >&2; exit 1; }
if ! $INSTALL_ONLY; then [[ -L "$CURRENT_LINK" ]] || { echo "current release path is missing or is not a managed link" >&2; exit 1; }; fi

DOWNLOAD="$WORK_ROOT/$VERSION-$RANDOM.tar.gz"
STAGING="$WORK_ROOT/$VERSION-$RANDOM"
OLD_STATE=""
OLD_BOOT=""
OLD_VERSION=""
if ! $INSTALL_ONLY; then
  OLD_STATE="$(worker_state)"
  OLD_BOOT="${OLD_STATE%%$'\t'*}"
  OLD_VERSION="${OLD_STATE#*$'\t'}"
  [[ -n "$OLD_STATE" && "$OLD_BOOT" != "$OLD_STATE" && -n "$OLD_VERSION" ]] || { echo "cannot establish current Worker version before upgrade" >&2; exit 1; }
fi
SERVICE_STOPPED=false
RELEASE_CREATED=false
TRANSACTION_COMMITTED=false
cleanup() {
  rm -f "$DOWNLOAD" "$MANIFEST_FILE"
  [[ ! -d "$STAGING" ]] || rm -rf "$STAGING"
  if $RELEASE_CREATED && ! $TRANSACTION_COMMITTED && [[ -d "$RELEASE_PATH" && ! "$RELEASE_PATH" -ef "$CURRENT_LINK" ]]; then rm -rf "$RELEASE_PATH"; fi
}
trap cleanup EXIT

upgrade_transaction() {
  local remaining actual_sha actual_sha_lower expected_sha_lower actual_size
  if ! $INSTALL_ONLY; then
    # DEPLOY_PHASE: DRAIN
    drain_worker
    launchctl bootout "$DOMAIN/$LABEL"
    SERVICE_STOPPED=true
    remaining="$(active_task_ids)"
    [[ -z "$remaining" ]] || { echo "drain race detected after launchd stop" >&2; return 1; }
  fi

  # DEPLOY_PHASE: DOWNLOAD
  curl --fail --location --silent --show-error --max-time 300 "${CURL_CA_ARGS[@]}" "$ARTIFACT_URL" -o "$DOWNLOAD"

  # DEPLOY_PHASE: SHA256
  actual_size="$(stat -f %z "$DOWNLOAD")"
  [[ "$actual_size" == "$EXPECTED_SIZE" ]] || { echo "release artifact size mismatch" >&2; return 1; }
  actual_sha="$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')"
  actual_sha_lower="$(printf '%s' "$actual_sha" | tr '[:upper:]' '[:lower:]')"
  expected_sha_lower="$(printf '%s' "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]')"
  [[ "$actual_sha_lower" == "$expected_sha_lower" ]] || { echo "SHA256 mismatch for downloaded Worker release" >&2; return 1; }
  mkdir "$STAGING"
  tar -xzf "$DOWNLOAD" -C "$STAGING"
  [[ -f "$STAGING/dist/index.js" ]] || { echo "Worker release is missing dist/index.js" >&2; return 1; }
  mv "$STAGING" "$RELEASE_PATH"
  RELEASE_CREATED=true

  # DEPLOY_PHASE: SWITCH
  switch_release "$RELEASE_PATH"
  if $INSTALL_ONLY; then TRANSACTION_COMMITTED=true; return 0; fi

  # DEPLOY_PHASE: RESTART
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"

  # DEPLOY_PHASE: HEALTH
  wait_worker_health "$OLD_BOOT" "$VERSION"
  resume_drained_tasks
  rm -f "$PREVIOUS_LINK"
  SERVICE_STOPPED=false
  TRANSACTION_COMMITTED=true
}

if ! upgrade_transaction; then
  # DEPLOY_PHASE: ROLLBACK
  if ! $INSTALL_ONLY && $SERVICE_STOPPED; then
    echo "Upgrade transaction failed; restoring the previous release" >&2
    rollback_release || { echo "Upgrade failed and rollback recovery failed" >&2; exit 1; }
  elif ! $INSTALL_ONLY && [[ -f "$DRAIN_JOURNAL" ]]; then
    resume_drained_tasks || { echo "Upgrade failed and drained tasks could not be resumed" >&2; exit 1; }
  fi
  exit 1
fi

if $INSTALL_ONLY; then
  echo "Installed immutable Worker release $VERSION; launchd lifecycle was intentionally skipped."
else
  echo "Worker upgraded to $VERSION, remained stable, and resumed drained tasks."
fi
