#!/bin/bash
set -euo pipefail

# ==============================================================================
# Claude Worker Container Entrypoint
# ==============================================================================

setup_git_identity() {
    # Set identity at BOTH repo and global level.
    # Repo-level is critical because worktrees inherit the parent repo's
    # .git/config [user] section, which overrides global ~/.gitconfig.
    if [ -n "${GIT_USER_NAME:-}" ]; then
        git config --global user.name "$GIT_USER_NAME"
        if [ -d "/repo" ] && { [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; }; then
            git -C /repo config user.name "$GIT_USER_NAME"
        fi
    fi
    if [ -n "${GIT_USER_EMAIL:-}" ]; then
        git config --global user.email "$GIT_USER_EMAIL"
        if [ -d "/repo" ] && { [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; }; then
            git -C /repo config user.email "$GIT_USER_EMAIL"
        fi
    fi
}

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

run_claude_attempt() {
    if [ ! -d "/repo" ]; then
        echo "[entrypoint] ERROR: /repo directory not mounted" >&2
        return 1
    fi

    cd /repo
    setup_git_identity
    setup_github_token

    if [ ! -f "/secrets/system-prompt.txt" ]; then
        echo "[entrypoint] ERROR: /secrets/system-prompt.txt not found" >&2
        return 1
    fi

    if [ ! -f "/secrets/user-prompt.txt" ]; then
        echo "[entrypoint] ERROR: /secrets/user-prompt.txt not found" >&2
        return 1
    fi

    local system_prompt
    system_prompt=$(cat /secrets/system-prompt.txt)
    echo "[entrypoint] System prompt loaded (${#system_prompt} chars)"
    echo "[entrypoint] User prompt loaded ($(wc -c < /secrets/user-prompt.txt | tr -d ' ') bytes)"

    local continue_flag="${CLAUDE_CONTINUE:-0}"
    if [ "$continue_flag" = "1" ]; then
        echo "[entrypoint] Resuming previous Claude session with --continue"
    fi

    echo "[entrypoint] Starting Claude in --print mode..."

    set +e
    if [ "$continue_flag" = "1" ]; then
        claude --print --verbose --output-format stream-json \
            --dangerously-skip-permissions \
            --system-prompt "$system_prompt" \
            --continue \
            < /secrets/user-prompt.txt
    else
        claude --print --verbose --output-format stream-json \
            --dangerously-skip-permissions \
            --system-prompt "$system_prompt" \
            < /secrets/user-prompt.txt
    fi
    local exit_code=$?
    set -e

    echo "[entrypoint] Claude attempt finished with exit code: ${exit_code}"
    return "$exit_code"
}

if [ "${1:-}" = "run-attempt" ]; then
    if [ ! -f "/tmp/worker-ready" ]; then
        echo "[entrypoint] ERROR: Worker not ready — readiness marker missing" >&2
        exit 1
    fi
    run_claude_attempt
    exit $?
fi

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
# Restore pre-installed plugin cache into the bind-mounted .claude/ directory
# Plugins were installed at build time into /opt/claude-plugins/.claude/plugins/
# The bind mount at /home/claude/.claude is initially empty per-task.
# ------------------------------------------------------------------------------
if [ -d "/opt/claude-plugins/.claude/plugins" ]; then
    cp -r /opt/claude-plugins/.claude/plugins /home/claude/.claude/
    # Rewrite staging paths to match runtime HOME
    if [ -f "/home/claude/.claude/plugins/installed_plugins.json" ]; then
        sed -i 's|/opt/claude-plugins/.claude|/home/claude/.claude|g' /home/claude/.claude/plugins/installed_plugins.json
    fi
    if [ -f "/home/claude/.claude/plugins/known_marketplaces.json" ]; then
        sed -i 's|/opt/claude-plugins/.claude|/home/claude/.claude|g' /home/claude/.claude/plugins/known_marketplaces.json
    fi
    echo "[entrypoint] Plugin cache restored ($(ls /home/claude/.claude/plugins/cache/ 2>/dev/null | wc -l) marketplaces)"
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
# Set up git identity and GitHub token
# ------------------------------------------------------------------------------
setup_git_identity
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
    CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --store-dir /home/claude/pnpm-store 2>&1
    echo "[entrypoint] Dependencies installed"
fi

# ------------------------------------------------------------------------------
# Set randomized attribution for commits and PRs
# ------------------------------------------------------------------------------
VERBS=(
    "Crafted" "Forged" "Engineered" "Sculpted" "Woven"
    "Conjured" "Assembled" "Composed" "Distilled" "Fashioned"
    "Architected" "Brewed" "Chiseled" "Designed" "Devised"
    "Hammered" "Kindled" "Molded" "Orchestrated" "Refined"
    "Shaped" "Sparked" "Stitched" "Tempered" "Wrought"
)
VERB=${VERBS[$((RANDOM % ${#VERBS[@]}))]}
COMMIT_ATTR="${VERB} with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"
PR_ATTR="${VERB} with love by 🤖 <a href=\"mailto:intex@intexuraos.cloud\">Intex</a>"

mkdir -p /repo/.claude
if [ -f "/repo/.claude/settings.local.json" ]; then
    jq --arg commit "$COMMIT_ATTR" --arg pr "$PR_ATTR" \
        '.attribution = { commit: $commit, pr: $pr }' /repo/.claude/settings.local.json > /tmp/settings.local.json \
        && mv /tmp/settings.local.json /repo/.claude/settings.local.json
else
    jq -n --arg commit "$COMMIT_ATTR" --arg pr "$PR_ATTR" \
        '{ attribution: { commit: $commit, pr: $pr } }' > /repo/.claude/settings.local.json
fi
echo "[entrypoint] Attribution set: ${COMMIT_ATTR}"

echo "[entrypoint] Writing readiness marker"
touch /tmp/worker-ready

# ------------------------------------------------------------------------------
# Managed mode: stay alive and wait for orchestrator to run attempts via docker exec
# ------------------------------------------------------------------------------
if [ "${CLAUDE_MANAGED_MODE:-0}" = "1" ]; then
    echo "[entrypoint] Managed attempt mode enabled; waiting for run-attempt invocations"
    while true; do
        sleep 3600
    done
fi

# ------------------------------------------------------------------------------
# Legacy mode: run Claude once and exit container
# ------------------------------------------------------------------------------
echo "[entrypoint] Starting Claude..."
echo "[entrypoint] Working directory: $(pwd)"
if [ -d "/repo/.git" ] || [ -f "/repo/.git" ]; then
    echo "[entrypoint] Git branch: $(git -C /repo branch --show-current 2>/dev/null || echo 'unknown')"
fi

run_claude_attempt
exit $?
