#!/bin/bash
set -euo pipefail
umask 077

MASTER_URL=""
MASTER_VERSION=""
ENROLLMENT_TOKEN=""
MACHINE_LABEL=""
MANIFEST_URL=""
RELEASE_PUBLIC_KEY=""
RELEASE_KEY_ID=""
MASTER_CA=""
REMOTE_PROVIDER="none"
REMOTE_TARGET=""
HEALTH_TIMEOUT=180
STABLE_HEALTH_SECONDS=30
INSTALL_ROOT="$HOME/Library/Application Support/RetailRadar/Worker"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --master-url) MASTER_URL="$2"; shift 2 ;;
    --master-version) MASTER_VERSION="$2"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="$2"; shift 2 ;;
    --machine-label) MACHINE_LABEL="$2"; shift 2 ;;
    --manifest-url) MANIFEST_URL="$2"; shift 2 ;;
    --release-public-key) RELEASE_PUBLIC_KEY="$2"; shift 2 ;;
    --release-key-id) RELEASE_KEY_ID="$2"; shift 2 ;;
    --master-ca) MASTER_CA="$2"; shift 2 ;;
    --remote-provider) REMOTE_PROVIDER="$2"; shift 2 ;;
    --remote-target) REMOTE_TARGET="$2"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
    --stable-health-seconds) STABLE_HEALTH_SECONDS="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$MASTER_URL" && -n "$MASTER_VERSION" && -n "$MACHINE_LABEL" && -n "$MANIFEST_URL" && -n "$RELEASE_PUBLIC_KEY" && -n "$RELEASE_KEY_ID" ]] \
  || { echo "Required installation arguments are missing" >&2; exit 2; }
[[ "$MASTER_URL" == https://* && "$MANIFEST_URL" == https://* ]] || { echo "Master and manifest URLs must use HTTPS" >&2; exit 1; }
[[ "$RELEASE_KEY_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "release-key-id is invalid" >&2; exit 2; }
[[ -f "$RELEASE_PUBLIC_KEY" ]] || { echo "Release public key was not found" >&2; exit 1; }

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "Node.js is required" >&2; exit 1; }
NODE_MAJOR="$($NODE_BIN --version | sed -E 's/^v([0-9]+).*/\1/')"
(( NODE_MAJOR >= 22 )) || { echo "Node.js 22 or newer is required" >&2; exit 1; }
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[[ -x "$CHROME" ]] || { echo "Google Chrome was not found" >&2; exit 1; }
command -v curl >/dev/null && command -v launchctl >/dev/null && command -v shasum >/dev/null || { echo "curl, launchctl and shasum are required" >&2; exit 1; }

SERVICE_ROOT="$INSTALL_ROOT/service"
CONFIG_ROOT="$INSTALL_ROOT/config"
STATE_ROOT="$INSTALL_ROOT/state"
DATA_ROOT="$INSTALL_ROOT/data"
CERTIFICATE_ROOT="$INSTALL_ROOT/certificates"
WORK_ROOT="$INSTALL_ROOT/work"
ENV_FILE="$CONFIG_ROOT/worker.env"
IDENTITY_FILE="$STATE_ROOT/worker-identity.json"
INSTALL_MARKER="$INSTALL_ROOT/.installing"
PLIST="$HOME/Library/LaunchAgents/com.retailradar.worker.plist"
DOMAIN="gui/$(id -u)"
LABEL="com.retailradar.worker"

remove_enrollment_token() {
  [[ -f "$ENV_FILE" ]] || return 0
  grep -v '^WORKER_ENROLLMENT_TOKEN=' "$ENV_FILE" > "$ENV_FILE.next" || true
  chmod 600 "$ENV_FILE.next"
  mv "$ENV_FILE.next" "$ENV_FILE"
}

remove_release_safely() {
  local release_path="$1" release_root
  [[ -n "$release_path" && -d "$release_path" ]] || return 0
  release_root="$(cd "$INSTALL_ROOT/releases" && pwd -P)/"
  case "$(cd "$release_path" && pwd -P)/" in
    "$release_root"*) rm -rf "$release_path" ;;
    *) echo "Refusing to remove release outside $release_root" >&2; return 1 ;;
  esac
}

STALE_INSTALL=false
[[ -f "$INSTALL_MARKER" ]] && STALE_INSTALL=true

mkdir -p "$SERVICE_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" "$DATA_ROOT" "$CERTIFICATE_ROOT" "$WORK_ROOT" "$INSTALL_ROOT/logs" "$INSTALL_ROOT/releases"
chmod 700 "$INSTALL_ROOT" "$SERVICE_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" "$DATA_ROOT" "$CERTIFICATE_ROOT" "$WORK_ROOT" "$INSTALL_ROOT/logs" "$INSTALL_ROOT/releases"

NODE_EXTRA_CA=""
CURL_CA_ARGS=()
RELEASE_PUBLIC_KEY_INSTALLED="$CERTIFICATE_ROOT/release-signing-public.pem"
RELEASE_PATH=""
SERVICE_LOADED=false
INSTALL_COMMITTED=false

cleanup_failed_install() {
  local current_target=""
  remove_enrollment_token || true
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  if [[ -L "$INSTALL_ROOT/current" ]]; then current_target="$(readlink "$INSTALL_ROOT/current")"; rm "$INSTALL_ROOT/current"; fi
  [[ ! -L "$INSTALL_ROOT/current.next" ]] || rm "$INSTALL_ROOT/current.next"
  [[ ! -L "$INSTALL_ROOT/current.previous" ]] || rm "$INSTALL_ROOT/current.previous"
  [[ -n "$RELEASE_PATH" ]] || RELEASE_PATH="$current_target"
  remove_release_safely "$RELEASE_PATH" || true
  rm -f "$INSTALL_MARKER"
}

if $STALE_INSTALL; then
  echo "Cleaning an interrupted installation before retry" >&2
  cleanup_failed_install
fi

if [[ -e "$PLIST" ]]; then
  echo "Worker is already installed; use the upgrade script instead" >&2
  exit 1
fi

read_worker_id() {
  MASTER_URL_EXPECTED="${MASTER_URL%/}" "$NODE_BIN" -e 'const fs=require("fs"),identity=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),normalize=x=>String(x).replace(/\/$/,"");if(typeof identity.workerId!=="string"||!identity.workerId.trim()||typeof identity.workerToken!=="string"||!identity.workerToken.trim()||typeof identity.masterBaseUrl!=="string")throw new Error("Worker identity file is incomplete");if(normalize(identity.masterBaseUrl)!==process.env.MASTER_URL_EXPECTED)throw new Error("Existing Worker identity belongs to a different Master");process.stdout.write(identity.workerId.trim())' "$IDENTITY_FILE"
}

PERSISTED_WORKER_ID=""
if [[ -f "$IDENTITY_FILE" ]]; then
  PERSISTED_WORKER_ID="$(read_worker_id)"
  echo "Resuming installation with preserved Master-issued Worker identity $PERSISTED_WORKER_ID"
elif [[ -z "$ENROLLMENT_TOKEN" ]]; then
  echo "enrollment-token is required when no Master-issued Worker identity exists" >&2
  exit 2
fi

printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$INSTALL_MARKER"

trap 'if ! $INSTALL_COMMITTED; then cleanup_failed_install; fi' EXIT

cp "$RELEASE_PUBLIC_KEY" "$RELEASE_PUBLIC_KEY_INSTALLED"
chmod 600 "$RELEASE_PUBLIC_KEY_INSTALLED"
if [[ -n "$MASTER_CA" ]]; then
  [[ -f "$MASTER_CA" ]] || { echo "Master CA certificate was not found" >&2; exit 1; }
  NODE_EXTRA_CA="$CERTIFICATE_ROOT/master-ca.crt"
  cp "$MASTER_CA" "$NODE_EXTRA_CA"
  chmod 600 "$NODE_EXTRA_CA"
  CURL_CA_ARGS=(--cacert "$NODE_EXTRA_CA")
fi
curl --fail --silent --show-error --max-time 20 "${CURL_CA_ARGS[@]}" "$MASTER_URL/health" >/dev/null

SCRIPT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_ROOT/start-worker.sh" "$SERVICE_ROOT/start-worker.sh"
cp "$SCRIPT_ROOT/upgrade-worker.sh" "$SERVICE_ROOT/upgrade-worker.sh"
cp "$SCRIPT_ROOT/../release/verify-release-manifest.mjs" "$SERVICE_ROOT/verify-release-manifest.mjs"
cp "$SCRIPT_ROOT/../release/release-manifest-lib.mjs" "$SERVICE_ROOT/release-manifest-lib.mjs"
chmod 700 "$SERVICE_ROOT/"*.sh
chmod 600 "$SERVICE_ROOT/"*.mjs

{
  printf 'MASTER_BASE_URL=%q\n' "${MASTER_URL%/}"
  printf 'WORKER_MACHINE_LABEL=%q\n' "$MACHINE_LABEL"
  [[ -n "$PERSISTED_WORKER_ID" ]] || printf 'WORKER_ENROLLMENT_TOKEN=%q\n' "$ENROLLMENT_TOKEN"
  printf 'WORKER_IDENTITY_FILE=%q\n' "$IDENTITY_FILE"
  printf 'WORKER_NODE_EXECUTABLE=%q\n' "$NODE_BIN"
  printf 'WORKER_CHROME_EXECUTABLE=%q\n' "$CHROME"
  printf 'WORKER_CHROME_PROFILE_ROOT=%q\n' "$STATE_ROOT/chrome-profiles"
  printf 'WORKER_CDP_STATE_FILE=%q\n' "$STATE_ROOT/cdp-runtime-state.json"
  printf 'WORKER_NATIVE_OUTPUT_ROOT=%q\n' "$DATA_ROOT/native-capture"
  printf 'WORKER_MUTATION_SPOOL_FILE=%q\n' "$DATA_ROOT/spool/master-mutations.jsonl"
  printf 'WORKER_ENABLE_TASK_POLLING=true\nWORKER_ENABLE_TASK_EXECUTION=true\nWORKER_ENABLE_CDP_COMMANDS=true\n'
  printf 'WORKER_COLLECTOR_ADAPTER=native\nWORKER_NATIVE_SCRIPT_ROOT=scripts\n'
  printf 'WORKER_REMOTE_DESKTOP_PROVIDER=%q\n' "$REMOTE_PROVIDER"
  printf 'WORKER_REMOTE_DESKTOP_TARGET=%q\n' "$REMOTE_TARGET"
  [[ -z "$NODE_EXTRA_CA" ]] || printf 'NODE_EXTRA_CA_CERTS=%q\nCURL_CA_BUNDLE=%q\n' "$NODE_EXTRA_CA" "$NODE_EXTRA_CA"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

UPGRADE_ARGS=(--manifest-url "$MANIFEST_URL" --master-url "$MASTER_URL" --master-version "$MASTER_VERSION" \
  --release-public-key "$RELEASE_PUBLIC_KEY_INSTALLED" --release-key-id "$RELEASE_KEY_ID" --install-root "$INSTALL_ROOT" --install-only)
[[ -z "$NODE_EXTRA_CA" ]] || UPGRADE_ARGS+=(--master-ca "$NODE_EXTRA_CA")
NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA" "$SERVICE_ROOT/upgrade-worker.sh" "${UPGRADE_ARGS[@]}"
RELEASE_PATH="$(readlink "$INSTALL_ROOT/current")"
EXPECTED_VERSION="$(node -p 'require(process.argv[1]).version' "$INSTALL_ROOT/current/package.json")"

mkdir -p "$(dirname "$PLIST")"
INSTALL_ROOT="$INSTALL_ROOT" node -e 'const fs=require("fs"),src=fs.readFileSync(process.argv[1],"utf8"),escaped=process.env.INSTALL_ROOT.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");fs.writeFileSync(process.argv[2],src.replaceAll("__INSTALL_ROOT__",escaped),{mode:0o600})' "$SCRIPT_ROOT/com.retailradar.worker.plist" "$PLIST"
plutil -lint "$PLIST" >/dev/null
defaults write com.google.Chrome NSAppSleepDisabled -bool YES
launchctl bootstrap "$DOMAIN" "$PLIST"
SERVICE_LOADED=true
launchctl kickstart -k "$DOMAIN/$LABEL"

deadline=$((SECONDS + 120))
while [[ ! -f "$IDENTITY_FILE" && $SECONDS -lt $deadline ]]; do sleep 2; done
[[ -f "$IDENTITY_FILE" ]] || { echo "launchd started but enrollment did not create an identity file" >&2; exit 1; }
EFFECTIVE_WORKER_ID="$(read_worker_id)"
EFFECTIVE_WORKER_TOKEN="$(node -e 'const fs=require("fs"),i=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!i.workerToken)process.exit(1);process.stdout.write(i.workerToken)' "$IDENTITY_FILE")"
chmod 600 "$IDENTITY_FILE"
remove_enrollment_token
launchctl kickstart -k "$DOMAIN/$LABEL"

stable_since=0
deadline=$((SECONDS + HEALTH_TIMEOUT))
while (( SECONDS < deadline )); do
  WORKER_JSON="$(curl --fail --silent --show-error --max-time 10 "${CURL_CA_ARGS[@]}" \
    -H "Authorization: Bearer $EFFECTIVE_WORKER_TOKEN" "$MASTER_URL/api/worker/self" 2>/dev/null || true)"
  MATCH="$(printf '%s' "$WORKER_JSON" | EXPECTED_VERSION="$EXPECTED_VERSION" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=JSON.parse(s).worker.worker;if(w.status==="online"&&w.bootId&&w.agentVersion===process.env.EXPECTED_VERSION)process.stdout.write("yes")}catch{}})')"
  if [[ "$MATCH" == "yes" ]]; then
    now="$(date +%s)"; (( stable_since > 0 )) || stable_since="$now"
    (( now - stable_since >= STABLE_HEALTH_SECONDS )) && break
  else stable_since=0; fi
  sleep 3
done
(( stable_since > 0 )) && (( $(date +%s) - stable_since >= STABLE_HEALTH_SECONDS )) || { echo "Worker did not remain online at version $EXPECTED_VERSION" >&2; exit 1; }

LAUNCH_STATUS="$(launchctl print "$DOMAIN/$LABEL")"
printf '%s\n' "$LAUNCH_STATUS" | grep -Eq 'state = running' || { echo "launchd service is loaded but not running" >&2; exit 1; }
printf '%s\n' "$LAUNCH_STATUS" | grep -Eq 'pid = [1-9][0-9]*' || { echo "launchd service has no positive PID" >&2; exit 1; }
rm -f "$INSTALL_MARKER"
INSTALL_COMMITTED=true
echo "Worker installed transactionally. launchd=$LABEL WorkerId=$EFFECTIVE_WORKER_ID Version=$EXPECTED_VERSION"
