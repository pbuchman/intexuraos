#!/usr/bin/env bash
# cleanup-containers.sh — Remove old Docker containers matching a name prefix.
#
# Designed for cron/launchd/systemd execution on both macOS and Linux.
# Containers older than RETENTION_DAYS that are not running are deleted.
# Optionally queries the orchestrator for running task IDs so that
# containers associated with active tasks are never removed.
#
# Environment variables (all optional):
#   CONTAINER_PREFIX   — Docker name prefix to match   (default: claude-worker-)
#   RETENTION_DAYS     — Age threshold in days          (default: 1)
#   DRY_RUN            — Set to "true" to preview only  (default: false)
#   LOG_FILE           — Path to log file               (default: stdout)
#   ORCHESTRATOR_URL   — Base URL of the orchestrator   (default: http://localhost:8199)
#
# Exit codes:
#   0 — Success (including "nothing to do")
#   1 — Docker not available

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTAINER_PREFIX="${CONTAINER_PREFIX:-claude-worker-}"
RETENTION_DAYS="${RETENTION_DAYS:-1}"
DRY_RUN="${DRY_RUN:-false}"
LOG_FILE="${LOG_FILE:-}"
ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:8199}"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_log_ts() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

log_info() {
  local msg
  msg="$(_log_ts) [INFO]  $*"
  if [[ -n "${LOG_FILE}" ]]; then
    echo "${msg}" >> "${LOG_FILE}"
  else
    echo "${msg}"
  fi
}

log_warn() {
  local msg
  msg="$(_log_ts) [WARN]  $*"
  if [[ -n "${LOG_FILE}" ]]; then
    echo "${msg}" >> "${LOG_FILE}"
  else
    echo "${msg}" >&2
  fi
}

log_error() {
  local msg
  msg="$(_log_ts) [ERROR] $*"
  if [[ -n "${LOG_FILE}" ]]; then
    echo "${msg}" >> "${LOG_FILE}"
  else
    echo "${msg}" >&2
  fi
}

# ---------------------------------------------------------------------------
# Cross-platform date arithmetic (macOS BSD date vs GNU date)
# Returns seconds since epoch for the retention cutoff.
# ---------------------------------------------------------------------------
retention_cutoff_epoch() {
  local days="$1"
  if date --version >/dev/null 2>&1; then
    # GNU date (Linux)
    date -d "-${days} days" '+%s'
  else
    # BSD date (macOS)
    date -v "-${days}d" '+%s'
  fi
}

# Convert an ISO-8601 / Docker timestamp to epoch seconds.
# Handles formats like "2025-02-20T10:30:00Z" and "2025-02-20 10:30:00 +0000 UTC".
timestamp_to_epoch() {
  local ts="$1"
  if date --version >/dev/null 2>&1; then
    # GNU date
    date -d "${ts}" '+%s' 2>/dev/null || echo ""
  else
    # BSD date — try ISO-8601 first, then strip timezone suffix
    local cleaned
    cleaned=$(echo "${ts}" | sed 's/ UTC$//' | sed 's/ +0000$//')
    date -jf '%Y-%m-%dT%H:%M:%S' "${cleaned}" '+%s' 2>/dev/null \
      || date -jf '%Y-%m-%d %H:%M:%S %z' "${ts}" '+%s' 2>/dev/null \
      || echo ""
  fi
}

# ---------------------------------------------------------------------------
# Orchestrator integration (best-effort)
# ---------------------------------------------------------------------------
get_running_task_ids() {
  local response
  response=$(curl -sf --connect-timeout 3 --max-time 5 \
    "${ORCHESTRATOR_URL}/health" 2>/dev/null) || {
    log_warn "Could not reach orchestrator at ${ORCHESTRATOR_URL} — falling back to age-based cleanup only"
    echo ""
    return
  }

  # Extract running task IDs from the /tasks endpoint would require listing,
  # but health only gives counts. We list containers that are still running
  # and skip those — the orchestrator check is a secondary safety net.
  #
  # For a more robust integration, we would hit a /tasks?status=running
  # endpoint; for now we rely on Docker state (running containers are
  # always skipped) and log that the orchestrator is reachable.
  log_info "Orchestrator reachable (status: $(echo "${response}" | grep -o '"status":"[^"]*"' | head -1 || echo 'unknown'))"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log_info "=== Container cleanup started ==="
  log_info "Prefix=${CONTAINER_PREFIX}  Retention=${RETENTION_DAYS}d  DryRun=${DRY_RUN}"

  # --- Pre-flight: Docker available? ---
  if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker not found — exiting"
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    log_error "Docker daemon not reachable — exiting"
    exit 1
  fi

  # --- Orchestrator check (best-effort) ---
  get_running_task_ids

  # --- Retention cutoff ---
  local cutoff_epoch
  cutoff_epoch=$(retention_cutoff_epoch "${RETENTION_DAYS}")
  log_info "Cutoff epoch: ${cutoff_epoch} (containers created before this will be removed)"

  # --- List matching containers (all states) ---
  local container_lines
  container_lines=$(docker ps -a \
    --filter "name=${CONTAINER_PREFIX}" \
    --format '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}' 2>/dev/null) || {
    log_error "Failed to list Docker containers"
    exit 1
  }

  if [[ -z "${container_lines}" ]]; then
    log_info "No containers matching prefix '${CONTAINER_PREFIX}' found"
    log_info "=== Container cleanup finished (nothing to do) ==="
    exit 0
  fi

  # --- Process each container ---
  local total=0
  local deleted=0
  local skipped=0
  local errors=0

  while IFS=$'\t' read -r cid cname cstate ccreated; do
    total=$((total + 1))

    # Skip running containers — never delete these
    if [[ "${cstate}" == "running" ]]; then
      log_info "SKIP (running): ${cname} [${cid:0:12}]"
      skipped=$((skipped + 1))
      continue
    fi

    # Parse creation time
    local created_epoch
    created_epoch=$(timestamp_to_epoch "${ccreated}")
    if [[ -z "${created_epoch}" ]]; then
      log_warn "Could not parse creation time for ${cname}: '${ccreated}' — skipping"
      skipped=$((skipped + 1))
      continue
    fi

    # Check age
    if [[ "${created_epoch}" -ge "${cutoff_epoch}" ]]; then
      log_info "SKIP (recent): ${cname} [${cid:0:12}] created=${ccreated}"
      skipped=$((skipped + 1))
      continue
    fi

    # Delete (or preview)
    if [[ "${DRY_RUN}" == "true" ]]; then
      log_info "DELETE (dry-run): ${cname} [${cid:0:12}] created=${ccreated}"
      deleted=$((deleted + 1))
    else
      if docker rm -f "${cid}" >/dev/null 2>&1; then
        log_info "DELETE: ${cname} [${cid:0:12}] created=${ccreated}"
        deleted=$((deleted + 1))
      else
        log_error "Failed to remove ${cname} [${cid:0:12}]"
        errors=$((errors + 1))
      fi
    fi
  done <<< "${container_lines}"

  # --- Summary ---
  log_info "=== Container cleanup finished ==="
  log_info "Total=${total}  Deleted=${deleted}  Skipped=${skipped}  Errors=${errors}"
}

main "$@"
