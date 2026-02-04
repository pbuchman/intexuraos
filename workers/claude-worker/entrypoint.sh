#!/bin/bash
set -euo pipefail

# ==============================================================================
# Claude Worker Container Entrypoint
# ==============================================================================

echo "[entrypoint] Claude worker starting at $(date)"
echo "[entrypoint] Task ID: ${TASK_ID:-unknown}"

# ------------------------------------------------------------------------------
# Security: Verify non-root
# ------------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
    echo "[entrypoint] ERROR: Running as root is forbidden" >&2
    exit 1
fi
echo "[entrypoint] Running as user: $(whoami) (uid=$(id -u))"

# ------------------------------------------------------------------------------
# Security: Verify network restrictions
# ------------------------------------------------------------------------------
verify_network_restrictions() {
    # These should fail if restrictions are working
    if curl -s --max-time 2 http://169.254.169.254/ >/dev/null 2>&1; then
        echo "[entrypoint] WARNING: Metadata server is accessible!" >&2
    fi
}

# Verify in background (don't block startup)
verify_network_restrictions &

# ------------------------------------------------------------------------------
# Verify mounts
# ------------------------------------------------------------------------------
if [ ! -d "/repo" ]; then
    echo "[entrypoint] ERROR: /repo directory not mounted" >&2
    exit 1
fi

if [ -d "/repo/.git" ]; then
    echo "[entrypoint] Worktree verified: /repo (git repo)"
else
    echo "[entrypoint] WARNING: /repo is not a git repository"
fi

if [ ! -f "/secrets/gcp-sa.json" ]; then
    echo "[entrypoint] WARNING: GCP SA not mounted at /secrets/gcp-sa.json"
fi

# ------------------------------------------------------------------------------
# Activate GCP credentials
# ------------------------------------------------------------------------------
if [ -f "/secrets/gcp-sa.json" ]; then
    echo "[entrypoint] Activating GCP service account..."
    if gcloud auth activate-service-account --key-file=/secrets/gcp-sa.json 2>&1; then
        echo "[entrypoint] GCP auth successful"
    else
        echo "[entrypoint] GCP auth failed (non-fatal)"
    fi
fi

# ------------------------------------------------------------------------------
# Set up GitHub token (refreshed by orchestrator)
# ------------------------------------------------------------------------------
setup_github_token() {
    if [ -f "/secrets/github-token" ]; then
        export GITHUB_TOKEN=$(cat /secrets/github-token)
        echo "[entrypoint] GitHub token loaded"
    else
        echo "[entrypoint] WARNING: GitHub token not found at /secrets/github-token"
    fi
}
setup_github_token

# Watch for token refresh in background
(
    while true; do
        sleep 60
        if [ -f "/secrets/github-token" ]; then
            NEW_TOKEN=$(cat /secrets/github-token)
            if [ "$NEW_TOKEN" != "${GITHUB_TOKEN:-}" ]; then
                export GITHUB_TOKEN="$NEW_TOKEN"
                echo "[entrypoint] GitHub token refreshed"
            fi
        fi
    done
) &

# ------------------------------------------------------------------------------
# Start Claude in interactive mode
# ------------------------------------------------------------------------------
echo "[entrypoint] Starting Claude..."
echo "[entrypoint] Working directory: $(pwd)"
if [ -d "/repo/.git" ]; then
    echo "[entrypoint] Git branch: $(git -C /repo branch --show-current 2>/dev/null || echo 'unknown')"
fi

# Execute Claude in interactive mode (no --print flag)
# stdin/stdout connected directly for sendInput() to work
#
# --dangerously-skip-permissions: Required for automated operation. Without this flag,
# Claude Code prompts for confirmation before file writes, tool executions, and other
# actions. In a containerized worker, there's no human to approve these prompts, so
# they would block indefinitely. The container's isolation (non-root user, read-only
# secrets, dropped capabilities) provides the security boundary instead.
exec claude --dangerously-skip-permissions
