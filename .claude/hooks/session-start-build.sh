#!/bin/bash

# Session Start Hook: Build packages
# Ensures all buildable packages have dist/ at session start.
# This prevents the ~2,400 no-unsafe-* lint errors caused by unresolved types.
#
# PARALLEL-SAFE: Uses flock to prevent concurrent builds across Claude instances.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/sessions.log"

cd "$(dirname "$0")/../.." || exit 0
PROJECT_ROOT="$(pwd)"

# Lock file in project root (so different repos can build in parallel)
LOCK_FILE="${PROJECT_ROOT}/.claude-build.lock"
LOCK_TIMEOUT=120  # Max seconds to wait for lock

# Log session start with timestamp
if command -v gdate &>/dev/null; then
    TIMESTAMP_ISO=$(gdate -u +%Y-%m-%dT%H:%M:%S.%3NZ)
elif [[ "$(uname)" == "Darwin" ]]; then
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
else
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
fi
echo "[${TIMESTAMP_ISO}] Session started (PID $$)" >> "$LOG_FILE"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "CONTINUE"
  exit 0
fi

# Check if any buildable package is missing dist/
check_missing_dist() {
  for pkg in packages/*/; do
    if [ -f "$pkg/package.json" ]; then
      has_build=$(jq -r '.scripts.build // empty' "$pkg/package.json" 2>/dev/null)
      if [ -n "$has_build" ] && [ ! -d "$pkg/dist" ]; then
        return 0  # true: missing dist
      fi
    fi
  done
  return 1  # false: all dist present
}

if check_missing_dist; then
  # Try to acquire lock with timeout
  exec 200>"$LOCK_FILE"

  if command -v flock &>/dev/null; then
    # Linux/GNU flock available
    if flock -w "$LOCK_TIMEOUT" 200 2>/dev/null; then
      # Re-check after acquiring lock (another instance may have built)
      if check_missing_dist; then
        echo "[${TIMESTAMP_ISO}] Building packages (acquired lock)..." >> "$LOG_FILE"
        echo "Building packages (dist/ missing)..." >&2
        pnpm build >&2
        echo "[${TIMESTAMP_ISO}] Build complete" >> "$LOG_FILE"
      else
        echo "[${TIMESTAMP_ISO}] Skipped build (dist/ appeared while waiting)" >> "$LOG_FILE"
      fi
    else
      echo "[${TIMESTAMP_ISO}] Skipped build (lock timeout - another build in progress)" >> "$LOG_FILE"
      echo "Skipping build (another Claude instance is building)..." >&2
    fi
  else
    # macOS: flock not available, use simpler approach with shlock or mkdir
    if mkdir "${LOCK_FILE}.dir" 2>/dev/null; then
      trap 'rmdir "${LOCK_FILE}.dir" 2>/dev/null' EXIT

      if check_missing_dist; then
        echo "[${TIMESTAMP_ISO}] Building packages (acquired lock)..." >> "$LOG_FILE"
        echo "Building packages (dist/ missing)..." >&2
        pnpm build >&2
        echo "[${TIMESTAMP_ISO}] Build complete" >> "$LOG_FILE"
      fi
    else
      # Check if lock is stale (older than 5 minutes)
      if [ -d "${LOCK_FILE}.dir" ]; then
        lock_age=$(($(date +%s) - $(stat -f %m "${LOCK_FILE}.dir" 2>/dev/null || echo 0)))
        if [ "$lock_age" -gt 300 ]; then
          echo "[${TIMESTAMP_ISO}] Removing stale lock (${lock_age}s old)" >> "$LOG_FILE"
          rmdir "${LOCK_FILE}.dir" 2>/dev/null || true
        fi
      fi
      echo "[${TIMESTAMP_ISO}] Skipped build (another build in progress)" >> "$LOG_FILE"
      echo "Skipping build (another Claude instance is building)..." >&2
    fi
  fi
fi

echo "CONTINUE"
