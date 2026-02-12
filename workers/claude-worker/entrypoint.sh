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
# Create required directories (tmpfs on /home/claude wipes image dirs)
# ------------------------------------------------------------------------------
mkdir -p /home/claude/.config/gcloud /home/claude/.claude

# ------------------------------------------------------------------------------
# Restore Claude config defaults (skips onboarding on fresh tmpfs)
# ------------------------------------------------------------------------------
if [ -d "/opt/claude-defaults" ]; then
    cp -r /opt/claude-defaults/. /home/claude/
    echo "[entrypoint] Claude config defaults restored"
fi

# ------------------------------------------------------------------------------
# Verify mounts
# ------------------------------------------------------------------------------
if [ ! -d "/repo" ]; then
    echo "[entrypoint] ERROR: /repo directory not mounted" >&2
    exit 1
fi

# Git worktrees use a .git FILE (not directory) pointing to the main repo
if [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; then
    echo "[entrypoint] Git repo verified: /repo"
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
        # Configure git to use the token for HTTPS pushes
        git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
        echo "[entrypoint] GitHub token loaded and git credential configured"
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
# Configure pnpm to use persistent store (shared volume across containers)
# ------------------------------------------------------------------------------
pnpm config set store-dir /home/claude/pnpm-store --global

# ------------------------------------------------------------------------------
# Install dependencies (Linux-native node_modules via shared pnpm store)
# ------------------------------------------------------------------------------
if [ -f "/repo/pnpm-lock.yaml" ]; then
    echo "[entrypoint] Installing dependencies..."
    cd /repo
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --store-dir /home/claude/pnpm-store 2>&1
    echo "[entrypoint] Dependencies installed"
fi

# ------------------------------------------------------------------------------
# Start Claude in --print mode (non-interactive)
# ------------------------------------------------------------------------------
echo "[entrypoint] Starting Claude..."
echo "[entrypoint] Working directory: $(pwd)"
if [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; then
    echo "[entrypoint] Git branch: $(git -C /repo branch --show-current 2>/dev/null || echo 'unknown')"
fi

if [ ! -f "/secrets/system-prompt.txt" ]; then
    echo "[entrypoint] ERROR: /secrets/system-prompt.txt not found" >&2
    exit 1
fi

if [ ! -f "/secrets/user-prompt.txt" ]; then
    echo "[entrypoint] ERROR: /secrets/user-prompt.txt not found" >&2
    exit 1
fi

SYSTEM_PROMPT=$(cat /secrets/system-prompt.txt)
echo "[entrypoint] System prompt loaded (${#SYSTEM_PROMPT} chars)"
echo "[entrypoint] User prompt loaded ($(wc -c < /secrets/user-prompt.txt | tr -d ' ') bytes)"

CLAUDE_CONTINUE_FLAG=""
if [ "${CLAUDE_CONTINUE:-0}" = "1" ]; then
    echo "[entrypoint] Resuming previous Claude session with --continue"
    CLAUDE_CONTINUE_FLAG="--continue"
fi

echo "[entrypoint] Starting Claude in --print mode..."
if [ -n "$CLAUDE_CONTINUE_FLAG" ]; then
    exec claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$SYSTEM_PROMPT" \
        --continue \
        < /secrets/user-prompt.txt
else
    exec claude --print --verbose --output-format stream-json \
        --dangerously-skip-permissions \
        --system-prompt "$SYSTEM_PROMPT" \
        < /secrets/user-prompt.txt
fi
