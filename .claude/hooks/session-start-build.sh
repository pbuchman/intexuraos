#!/bin/bash

# Session Start Hook: Build packages
# Ensures all buildable packages have dist/ at session start.
# This prevents the ~2,400 no-unsafe-* lint errors caused by unresolved types.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/sessions.log"

cd "$(dirname "$0")/../.." || exit 0

# Log session start with timestamp
if command -v gdate &>/dev/null; then
    TIMESTAMP_ISO=$(gdate -u +%Y-%m-%dT%H:%M:%S.%3NZ)
elif [[ "$(uname)" == "Darwin" ]]; then
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
else
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
fi
echo "[${TIMESTAMP_ISO}] Session started" >> "$LOG_FILE"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "CONTINUE"
  exit 0
fi

# Check if any buildable package is missing dist/
# Only check packages that have a "build" script in package.json
missing_dist=false
for pkg in packages/*/; do
  if [ -f "$pkg/package.json" ]; then
    has_build=$(jq -r '.scripts.build // empty' "$pkg/package.json" 2>/dev/null)
    if [ -n "$has_build" ] && [ ! -d "$pkg/dist" ]; then
      missing_dist=true
      break
    fi
  fi
done

if [ "$missing_dist" = true ]; then
  echo "Building packages (dist/ missing)..." >&2
  pnpm build >&2
fi

echo "CONTINUE"
