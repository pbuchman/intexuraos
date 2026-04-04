#!/bin/bash
set -euo pipefail

# ==============================================================================
# Code Worker Container Entrypoint
# ==============================================================================

BOOTSTRAP_GCP_AUTH="skipped"
BOOTSTRAP_SECRET_SYNC="skipped"
BOOTSTRAP_ENVRC="missing"
BOOTSTRAP_GITHUB_TOKEN="missing"
BOOTSTRAP_CODEX_SKILLS="missing"

emit_bootstrap_evidence() {
    echo "[entrypoint] Bootstrap evidence: codex_skills=${BOOTSTRAP_CODEX_SKILLS} github_token=${BOOTSTRAP_GITHUB_TOKEN} gcp_auth=${BOOTSTRAP_GCP_AUTH} secret_sync=${BOOTSTRAP_SECRET_SYNC} envrc=${BOOTSTRAP_ENVRC}"
}

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
        BOOTSTRAP_GITHUB_TOKEN="loaded"
        # Point-in-time snapshot for convenience scripts; may go stale within
        # long-running attempts. The git credential helper and gh wrapper
        # (see Dockerfile) are the authoritative token sources — they re-read
        # the file on every invocation.
        export GITHUB_TOKEN="$(cat /secrets/github-token)"
        # Credential helper reads the bind-mounted file directly on each git
        # operation so it always uses the latest token from the orchestrator's
        # TokenRefresher (which updates /secrets/github-token every 30 min).
        git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=$(cat /secrets/github-token 2>/dev/null)"; }; f'
        echo "[entrypoint] GitHub token loaded and git credential configured"
    else
        BOOTSTRAP_GITHUB_TOKEN="missing"
        echo "[entrypoint] WARNING: GitHub token not found at /secrets/github-token"
    fi
}

forensics_enabled() {
    [ "${WORKER_FORENSICS:-0}" = "1" ]
}

forensics_prepare_attempt_dir() {
    local base_dir="${WORKER_FORENSICS_DIR:-/var/crash}"
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    local out_dir="${base_dir}/attempt-${stamp}-$$"
    mkdir -p "$out_dir" || return 1
    printf '%s\n' "$out_dir"
}

capture_claude_crash_forensics() {
    local out_dir="$1"

    mkdir -p "$out_dir" 2>/dev/null || true

    {
        echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "task_id=${TASK_ID:-unknown}"
        echo "continue_flag=${WORKER_CONTINUE:-0}"
        echo "pwd=$(pwd)"
        echo "uid=$(id -u 2>/dev/null || true)"
        echo "gid=$(id -g 2>/dev/null || true)"
        echo "user=$(whoami 2>/dev/null || true)"
        echo "uname=$(uname -a 2>/dev/null || true)"
        echo
        echo "[ulimit]"
        (ulimit -a 2>/dev/null || true)
        echo
        echo "[proc limits]"
        (cat /proc/self/limits 2>/dev/null || true)
        echo
        echo "[core settings]"
        (cat /proc/sys/kernel/core_pattern 2>/dev/null || true)
        (cat /proc/sys/kernel/dmesg_restrict 2>/dev/null || true)
        echo
        echo "[claude binary]"
        (claude --version 2>/dev/null || true)
        (file /usr/local/bin/claude 2>/dev/null || true)
    } > "${out_dir}/crash-summary.txt" 2>&1 || true

    (cp -a /tmp/claude-cmd-timing "${out_dir}/claude-cmd-timing" 2>/dev/null || true)
    (cp -a /home/claude/.claude/debug "${out_dir}/claude-debug" 2>/dev/null || true)
    (cp -a /home/claude/.claude/projects/-repo "${out_dir}/claude-projects-repo" 2>/dev/null || true)
    (cp -a /home/claude/.claude/shell-snapshots "${out_dir}/shell-snapshots" 2>/dev/null || true)
    (cp -a /home/claude/.claude.json "${out_dir}/.claude.json" 2>/dev/null || true)

    {
        find /repo /var/crash -maxdepth 3 -type f -name 'core*' 2>/dev/null || true
    } > "${out_dir}/core-files.txt" 2>&1 || true

    for core_file in /repo/core* /var/crash/core*; do
        [ -f "$core_file" ] || continue
        cp -a "$core_file" "$out_dir/" 2>/dev/null || true
    done

    if command -v gdb >/dev/null 2>&1; then
        for core_file in "${out_dir}"/core*; do
            [ -f "$core_file" ] || continue
            gdb -batch \
                -ex "set pagination off" \
                -ex "thread apply all bt full" \
                /usr/local/bin/claude "$core_file" \
                > "${out_dir}/$(basename "$core_file").gdb.txt" 2>&1 || true
        done
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
    local attempt_forensics_dir=""

    if forensics_enabled; then
        ulimit -c unlimited 2>/dev/null || true
        if attempt_forensics_dir=$(forensics_prepare_attempt_dir); then
            echo "[entrypoint] Forensics enabled; writing artifacts to ${attempt_forensics_dir}"
            {
                echo "started_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "task_id=${TASK_ID:-unknown}"
                echo "claude_continue=${WORKER_CONTINUE:-0}"
                echo "repo=/repo"
            } > "${attempt_forensics_dir}/attempt-meta.txt" 2>/dev/null || true
        else
            echo "[entrypoint] WARNING: Forensics enabled but failed to create output dir" >&2
        fi
    fi

    local continue_flag="${WORKER_CONTINUE:-0}"
    if [ "$continue_flag" = "1" ]; then
        echo "[entrypoint] Resuming previous Claude session with --continue"
    fi

    echo "[entrypoint] Starting Claude in --print mode..."

    set +e
    if [ -n "$attempt_forensics_dir" ]; then
        if [ "$continue_flag" = "1" ]; then
            claude --print --verbose --output-format stream-json \
                --dangerously-skip-permissions \
                --system-prompt "$system_prompt" \
                --continue \
                < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
        else
            claude --print --verbose --output-format stream-json \
                --dangerously-skip-permissions \
                --system-prompt "$system_prompt" \
                < /secrets/user-prompt.txt 2>&1 | tee -a "${attempt_forensics_dir}/claude-stream.log"
        fi
    else
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
    fi
    local exit_code=$?
    set -e

    if [ -n "$attempt_forensics_dir" ]; then
        printf '%s\n' "$exit_code" > "${attempt_forensics_dir}/claude-exit-code.txt" 2>/dev/null || true
        if [ "$exit_code" = "139" ]; then
            echo "[entrypoint] Claude segfault detected; collecting crash artifacts..."
            capture_claude_crash_forensics "$attempt_forensics_dir"
        fi
    fi

    echo "[entrypoint] Claude attempt finished with exit code: ${exit_code}"
    return "$exit_code"
}

read_linear_mcp_timeout_ms() {
    local mcp_json="/repo/.mcp.json"
    if [ ! -f "$mcp_json" ]; then
        echo "60000"
        return
    fi
    local timeout_ms
    timeout_ms=$(jq -r '.mcpServers.linear.timeoutMs // empty' "$mcp_json" 2>/dev/null || true)
    if [ -z "$timeout_ms" ] || ! [[ "$timeout_ms" =~ ^[0-9]+$ ]]; then
        echo "60000"
        return
    fi
    # Cap at 1 hour to prevent arithmetic overflow in timeout_s conversion
    if [ "$timeout_ms" -gt 3600000 ]; then
        timeout_ms=3600000
    fi
    echo "$timeout_ms"
}

run_codex_attempt() {
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
    local attempt_forensics_dir=""

    if forensics_enabled; then
        ulimit -c unlimited 2>/dev/null || true
        if attempt_forensics_dir=$(forensics_prepare_attempt_dir); then
            echo "[entrypoint] Forensics enabled; writing artifacts to ${attempt_forensics_dir}"
            {
                echo "started_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
                echo "task_id=${TASK_ID:-unknown}"
                echo "runtime=codex"
                echo "continue_flag=${WORKER_CONTINUE:-0}"
                echo "repo=/repo"
            } > "${attempt_forensics_dir}/attempt-meta.txt" 2>/dev/null || true
        else
            echo "[entrypoint] WARNING: Forensics enabled but failed to create output dir" >&2
        fi
    fi

    local continue_flag="${WORKER_CONTINUE:-0}"
    if [ "$continue_flag" = "1" ] && [ -z "${CODEX_THREAD_ID:-}" ]; then
        echo "[entrypoint] ERROR: CODEX_THREAD_ID is required for resumed Codex attempts" >&2
        return 1
    fi

    local runtime_mode="fresh"
    if [ "$continue_flag" = "1" ]; then
        runtime_mode="resume"
    fi
    local thread_id_state="absent"
    if [ -n "${CODEX_THREAD_ID:-}" ]; then
        thread_id_state="present"
    fi
    local reasoning_effort_state="default"
    if [ -n "${CODEX_REASONING_EFFORT:-}" ]; then
        reasoning_effort_state="${CODEX_REASONING_EFFORT}"
    fi

    local linear_timeout_ms
    linear_timeout_ms=$(read_linear_mcp_timeout_ms)
    local timeout_s=$(( (linear_timeout_ms + 999) / 1000 ))

    echo "[entrypoint] Codex runtime evidence: mode=${runtime_mode} thread_id=${thread_id_state} reasoning_effort=${reasoning_effort_state} linear_mcp_timeout_ms=${linear_timeout_ms}"

    local prompt_file
    prompt_file="$(mktemp /tmp/codex-prompt.XXXXXX)"
    {
        printf '[SYSTEM PROMPT]\n%s\n\n[USER PROMPT]\n' "$system_prompt"
        cat /secrets/user-prompt.txt
    } > "$prompt_file"

    echo "[entrypoint] Starting Codex in exec mode..."

    local effort_args=()
    if [ -n "${CODEX_REASONING_EFFORT:-}" ]; then
        effort_args=(-c "model_reasoning_effort=${CODEX_REASONING_EFFORT}")
        echo "[entrypoint] Codex reasoning effort: ${CODEX_REASONING_EFFORT}"
    fi

    local raw_exit=0
    local log_file
    log_file="$(mktemp /tmp/codex-output.XXXXXX)"
    set +e

    if [ -n "$attempt_forensics_dir" ]; then
        if [ "$continue_flag" = "1" ]; then
            timeout -s TERM -k 10 "${timeout_s}s" \
                codex exec resume --json \
                --skip-git-repo-check \
                --dangerously-bypass-approvals-and-sandbox \
                "${effort_args[@]}" \
                "${CODEX_THREAD_ID}" \
                - < "$prompt_file" > "$log_file" 2>&1 || raw_exit=$?
        else
            timeout -s TERM -k 10 "${timeout_s}s" \
                codex exec --json \
                --skip-git-repo-check \
                --dangerously-bypass-approvals-and-sandbox \
                "${effort_args[@]}" \
                - < "$prompt_file" > "$log_file" 2>&1 || raw_exit=$?
        fi
    else
        if [ "$continue_flag" = "1" ]; then
            timeout -s TERM -k 10 "${timeout_s}s" \
                codex exec resume --json \
                --skip-git-repo-check \
                --dangerously-bypass-approvals-and-sandbox \
                "${effort_args[@]}" \
                "${CODEX_THREAD_ID}" \
                - < "$prompt_file" > "$log_file" 2>&1 || raw_exit=$?
        else
            timeout -s TERM -k 10 "${timeout_s}s" \
                codex exec --json \
                --skip-git-repo-check \
                --dangerously-bypass-approvals-and-sandbox \
                "${effort_args[@]}" \
                - < "$prompt_file" > "$log_file" 2>&1 || raw_exit=$?
        fi
    fi
    set -e

    if [ -n "$attempt_forensics_dir" ]; then
        tee -a "${attempt_forensics_dir}/codex-stream.log" < "$log_file"
    else
        cat "$log_file"
    fi
    rm -f "$log_file"

    local exit_code="$raw_exit"
    if [ "$exit_code" -eq 124 ]; then
        echo "[entrypoint] MCP timeout server=linear timeout_ms=${linear_timeout_ms}"
        exit_code=1
    fi

    rm -f "$prompt_file"

    if [ -n "$attempt_forensics_dir" ]; then
        printf '%s\n' "$exit_code" > "${attempt_forensics_dir}/codex-exit-code.txt" 2>/dev/null || true
    fi

    echo "[entrypoint] Codex attempt finished with exit code: ${exit_code}"
    return "$exit_code"
}

run_worker_attempt() {
    case "${WORKER_RUNTIME:-claude}" in
        claude)
            run_claude_attempt
            ;;
        codex)
            run_codex_attempt
            ;;
        *)
            echo "[entrypoint] ERROR: Unsupported worker runtime '${WORKER_RUNTIME:-}'" >&2
            return 1
            ;;
    esac
}

if [ "${1:-}" = "run-attempt" ]; then
    if [ ! -f "/tmp/worker-ready" ]; then
        echo "[entrypoint] ERROR: Worker not ready — readiness marker missing" >&2
        exit 1
    fi
    run_worker_attempt
    attempt_exit=$?
    # Terminate lingering child processes (MCP servers, background tools)
    # that may hold Docker exec file descriptors open.
    pkill -P $$ 2>/dev/null || true
    sleep 0.5
    pkill -9 -P $$ 2>/dev/null || true
    exit $attempt_exit
fi

echo "[entrypoint] Code worker starting at $(date)"
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
mkdir -p /home/claude/.config/gcloud /home/claude/.claude /home/claude/.agents/skills

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
# Restore pre-installed Codex skill discovery directory into ~/.agents/
# Codex discovers skills from ~/.agents/skills. The staged symlink points at
# /opt/codex-superpowers/skills, which stays in the image filesystem.
# ------------------------------------------------------------------------------
if [ -d "/opt/codex-home/.agents/skills" ]; then
    cp -a /opt/codex-home/.agents/. /home/claude/.agents/
    BOOTSTRAP_CODEX_SKILLS="restored"
    echo "[entrypoint] Codex skill discovery restored"
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
        BOOTSTRAP_GCP_AUTH="active"
        echo "[entrypoint] GCP auth successful"
    else
        BOOTSTRAP_GCP_AUTH="failed"
        echo "[entrypoint] GCP auth failed (non-fatal)"
    fi
fi

# ------------------------------------------------------------------------------
# Sync secrets from GCP Secret Manager (writes /repo/.envrc)
# ------------------------------------------------------------------------------
if [ -f "/secrets/gcp-sa.json" ] && [ -f "/repo/scripts/sync-secrets.sh" ]; then
    SYNC_PROJECT_ID="$(jq -r .project_id /secrets/gcp-sa.json)"
    echo "[entrypoint] Syncing secrets from GCP Secret Manager (project: ${SYNC_PROJECT_ID})..."
    if bash /repo/scripts/sync-secrets.sh dev --project-id "${SYNC_PROJECT_ID}"; then
        BOOTSTRAP_SECRET_SYNC="synced"
        echo "[entrypoint] Secret sync complete"
    else
        BOOTSTRAP_SECRET_SYNC="failed"
        echo "[entrypoint] Secret sync failed (non-fatal, will use existing .envrc if available)"
    fi
fi

# ------------------------------------------------------------------------------
# Load environment variables from .envrc (synced from GCP Secret Manager)
# ------------------------------------------------------------------------------
if [ -f "/repo/.envrc" ]; then
    source /repo/.envrc
    direnv allow /repo
    BOOTSTRAP_ENVRC="loaded"
    echo "[entrypoint] Loaded environment from /repo/.envrc ($(grep -c '^export ' /repo/.envrc) vars)"
fi

# ------------------------------------------------------------------------------
# Set up git identity and GitHub token
# ------------------------------------------------------------------------------
setup_git_identity
setup_github_token

emit_bootstrap_evidence

# Token freshness: The orchestrator's TokenRefresher updates /secrets/github-token
# every 30 minutes via bind mount. The git credential helper reads this file directly
# on each git operation. The gh wrapper (/usr/local/bin/gh) re-reads it before each
# invocation. No background watcher needed.

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
if [ "${WORKER_MANAGED_MODE:-0}" = "1" ]; then
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

run_worker_attempt
exit $?
