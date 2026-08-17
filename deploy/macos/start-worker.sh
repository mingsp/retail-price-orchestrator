#!/bin/bash
set -euo pipefail

INSTALL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$INSTALL_ROOT/config/worker.env"
CURRENT_RELEASE="$INSTALL_ROOT/current"

[[ -f "$ENV_FILE" ]] || { echo "Worker environment file is missing: $ENV_FILE" >&2; exit 1; }
[[ -f "$CURRENT_RELEASE/dist/index.js" ]] || { echo "Active Worker release is invalid: $CURRENT_RELEASE" >&2; exit 1; }

set -a
# The file is owned by the current user and mode 0600.
source "$ENV_FILE"
set +a

cd "$CURRENT_RELEASE"
exec /usr/bin/caffeinate -dimsu "${WORKER_NODE_EXECUTABLE:-$(command -v node)}" dist/index.js
