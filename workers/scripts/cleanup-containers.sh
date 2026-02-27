#!/usr/bin/env bash
# cleanup-containers.sh — Remove old Docker containers matching a name prefix.
#
# Designed for cron/launchd/systemd execution on both macOS and Linux.
# Containers older than RETENTION_DAYS that are not running are deleted.
# Queries the orchestrator health endpoint to verify reachability.
# Running containers are protected by Docker state checks (never deleted).
#
# Known limitation: The script does not yet query individual task IDs from
# the orchestrator. Protection relies on Docker's container state — any
# container in "running" state is unconditionally skipped. A future
# /tasks?status=running endpoint would provide additional safety for
# containers being used for forensics/log extraction after task completion.
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
    # BSD date — strip trailing timezone abbreviations (UTC, PST, EST, etc.)
    # and numeric offsets so the format string matches cleanly.
    local cleaned
    cleaned=$(echo "${ts}" | sed 's/ [A-Z]\{2,5\}$//' | sed 's/ [+-][0-9]\{4\}$//')
    date -jf '%Y-%m-%dT%H:%M:%S' "${cleaned}" '+%s' 2>/dev/null \
      || date -jf '%Y-%m-%d %H:%M:%S %z' "${ts}" '+%s' 2>/dev/null \
      || date -jf '%Y-%m-%d %H:%M:%S' "${cleaned}" '+%s' 2>/dev/null \
      || echo ""
  fi
}

# ---------------------------------------------------------------------------
# Orchestrator integration (best-effort)
# ---------------------------------------------------------------------------
check_orchestrator_health() {
  local response
  response=$(curl -sf --connect-timeout 3 --max-time 5 \
    "${ORCHESTRATOR_URL}/health" 2>/dev/null) || {
    log_warn "Could not reach orchestrator at ${ORCHESTRATOR_URL} — falling back to age-based cleanup only"
    return
  }

  # NOTE: Task-level filtering is not yet implemented. The orchestrator
  # does not currently expose a /tasks?status=running endpoint. This
  # health check only confirms the orchestrator is alive. Protection
  # against deleting active containers relies on Docker state checks
  # (running containers are unconditionally skipped in the main loop).
  log_info "Orchestrator reachable (status: $(echo "${response}" | grep -o '"status":"[^"]*"' | head -1 || echo 'unknown'))"
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
  check_orchestrator_health

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
      # Re-check state to avoid TOCTOU race (container may have started
      # between the initial listing and now). Use plain `docker rm` without
      # -f so a running container will fail safely rather than being killed.
      local current_state
      current_state=$(docker inspect --format '{{.State.Status}}' "${cid}" 2>/dev/null || echo "unknown")
      if [[ "${current_state}" == "running" ]]; then
        log_info "SKIP (now running): ${cname} [${cid:0:12}]"
        skipped=$((skipped + 1))
        continue
      fi
      if docker rm "${cid}" >/dev/null 2>&1; then
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
  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "Total=${total}  WouldDelete=${deleted}  Skipped=${skipped}  Errors=${errors}  (dry-run)"
  else
    log_info "Total=${total}  Deleted=${deleted}  Skipped=${skipped}  Errors=${errors}"
  fi
}

main "$@"
