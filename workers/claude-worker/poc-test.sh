#!/bin/bash
set -euo pipefail

# ==============================================================================
# POC Test Script: Claude Worker Segfault Investigation
# Tests Debian-slim and ARM64-Alpine variants against Alpine-amd64 baseline
# ==============================================================================

VARIANT="${1:?Usage: poc-test.sh <debian|arm64|baseline>}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SECRETS_BASE="/tmp/claude-poc-secrets"
SHARED_CREDS="/Users/p.buchman/.claude-orchestrator/claude-creds"
PNPM_STORE="/tmp/claude-poc-pnpm-store"
CONTAINER_NAME="claude-worker-poc-${VARIANT}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[poc-test]${NC} $*"; }
ok()  { echo -e "${GREEN}[  OK  ]${NC} $*"; }
warn(){ echo -e "${YELLOW}[ WARN ]${NC} $*"; }
fail(){ echo -e "${RED}[ FAIL ]${NC} $*"; }

# --------------------------------------------------------------------------
# Setup
# --------------------------------------------------------------------------
log "Setting up test environment for variant: ${VARIANT}"

mkdir -p "${SECRETS_BASE}" "${PNPM_STORE}"

# Copy GCP SA key if available
GCP_SA_PATH="${HOME}/.config/gcloud/sa-key.json"
if [ -f "${GCP_SA_PATH}" ]; then
    cp "${GCP_SA_PATH}" "${SECRETS_BASE}/gcp-sa.json"
    ok "GCP SA key copied"
else
    warn "No GCP SA key found at ${GCP_SA_PATH}"
    echo '{}' > "${SECRETS_BASE}/gcp-sa.json"
fi

# Copy GitHub token from the running container's secrets (if available)
RUNNING_CONTAINER=$(docker ps --filter "name=claude-worker-task_" --format "{{.ID}}" | head -1)
if [ -n "${RUNNING_CONTAINER}" ]; then
    GITHUB_TOKEN=$(docker exec "${RUNNING_CONTAINER}" cat /secrets/github-token 2>/dev/null || echo "")
    if [ -n "${GITHUB_TOKEN}" ]; then
        echo -n "${GITHUB_TOKEN}" > "${SECRETS_BASE}/github-token"
        ok "GitHub token extracted from running container"
    fi
fi

# Write system prompt (minimal but realistic — triggers MCP/plugin loading)
cat > "${SECRETS_BASE}/system-prompt.txt" << 'SYSPROMPT'
You are a code assistant. You have access to tools including Bash, Read, Write, Glob, and Grep.
Use these tools to complete tasks. Be concise.
SYSPROMPT

# Write user prompt that triggers parallel operations (mimics the crash scenario)
cat > "${SECRETS_BASE}/user-prompt.txt" << 'USERPROMPT'
Run 3 commands in parallel: list the files in /repo with ls, check the git status, and read the package.json file. Do all 3 at once.
USERPROMPT

ok "Secrets and prompts written"

# --------------------------------------------------------------------------
# Determine image name
# --------------------------------------------------------------------------
case "${VARIANT}" in
    debian)   IMAGE="claude-worker-poc-debian:latest" ;;
    arm64)    IMAGE="claude-worker-poc-arm64:latest" ;;
    baseline) IMAGE="${POC_IMAGE:-europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/claude-worker:latest}" ;;
    *)        fail "Unknown variant: ${VARIANT}"; exit 1 ;;
esac

log "Using image: ${IMAGE}"

# --------------------------------------------------------------------------
# Cleanup previous POC container
# --------------------------------------------------------------------------
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

# --------------------------------------------------------------------------
# Get host UID/GID (same as orchestrator does)
# --------------------------------------------------------------------------
HOST_UID=$(id -u)
HOST_GID=$(id -g)

# --------------------------------------------------------------------------
# Create and start container (mirrors docker-provider.ts createContainer)
# --------------------------------------------------------------------------
log "Creating container: ${CONTAINER_NAME}"
log "Bind mounts:"
log "  ${REPO_ROOT} -> /repo"
log "  ${SECRETS_BASE} -> /secrets"
log "  ${SHARED_CREDS} -> /home/claude/.claude (shared credentials)"
log "  ${PNPM_STORE} -> /home/claude/pnpm-store"

# Use shared credentials (same as production orchestrator)
if [ ! -f "${SHARED_CREDS}/.credentials.json" ]; then
    fail "No shared credentials found at ${SHARED_CREDS}/.credentials.json"
    exit 1
fi

ok "Shared credentials available at ${SHARED_CREDS}"

docker create \
    --name "${CONTAINER_NAME}" \
    --env "TASK_ID=poc-test-${VARIANT}" \
    --env "GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json" \
    --env "CLAUDE_PROJECT_DIR=/repo" \
    --env "CLAUDE_WORKER_MODE=1" \
    --env "CLAUDE_MANAGED_MODE=1" \
    --env "CLAUDE_CONTINUE=0" \
    --env "GIT_USER_NAME=POC Test" \
    --env "GIT_USER_EMAIL=poc@test.local" \
    --env "LINEAR_API_KEY=" \
    --env "SENTRY_AUTH_TOKEN=" \
    --user "${HOST_UID}:${HOST_GID}" \
    --workdir /repo \
    --network claude-worker-net \
    --cap-drop ALL \
    --cap-add NET_RAW \
    --security-opt no-new-privileges \
    --tmpfs "/tmp:rw,noexec,nosuid,size=2g" \
    --tmpfs "/home/claude:rw,noexec,nosuid,size=500m,uid=${HOST_UID},gid=${HOST_GID}" \
    --tmpfs "/repo/node_modules:rw,exec,nosuid,size=4g,uid=${HOST_UID},gid=${HOST_GID}" \
    -v "${REPO_ROOT}:/repo:rw" \
    -v "${SECRETS_BASE}:/secrets:ro" \
    -v "${PNPM_STORE}:/home/claude/pnpm-store:rw" \
    -v "${SHARED_CREDS}:/home/claude/.claude:rw" \
    "${IMAGE}" > /dev/null

ok "Container created"

# --------------------------------------------------------------------------
# Start container and wait for readiness
# --------------------------------------------------------------------------
log "Starting container..."
docker start "${CONTAINER_NAME}" > /dev/null

log "Waiting for worker readiness marker (/tmp/worker-ready)..."
READY_TIMEOUT=600
READY_ELAPSED=0
while [ ${READY_ELAPSED} -lt ${READY_TIMEOUT} ]; do
    if docker exec "${CONTAINER_NAME}" test -f /tmp/worker-ready 2>/dev/null; then
        ok "Worker ready after ${READY_ELAPSED}s"
        break
    fi
    sleep 2
    READY_ELAPSED=$((READY_ELAPSED + 2))

    # Show progress every 30s
    if [ $((READY_ELAPSED % 30)) -eq 0 ]; then
        log "Still waiting... (${READY_ELAPSED}s elapsed)"
        docker logs --tail 3 "${CONTAINER_NAME}" 2>&1 | sed 's/^/  │ /'
    fi
done

if [ ${READY_ELAPSED} -ge ${READY_TIMEOUT} ]; then
    fail "Worker readiness timeout after ${READY_TIMEOUT}s"
    docker logs --tail 30 "${CONTAINER_NAME}" 2>&1
    exit 1
fi

# --------------------------------------------------------------------------
# Phase 1: Verify basics
# --------------------------------------------------------------------------
log "=== PHASE 1: Basic Verification ==="

ARCH=$(docker exec "${CONTAINER_NAME}" uname -m 2>/dev/null)
LIBC=$(docker exec "${CONTAINER_NAME}" ldd --version 2>&1 | head -1 || docker exec "${CONTAINER_NAME}" sh -c "ls /lib/ld-* 2>/dev/null | head -1" || echo "unknown")
CLAUDE_VER=$(docker exec "${CONTAINER_NAME}" claude --version 2>/dev/null || echo "unknown")
CLAUDE_BIN=$(docker exec "${CONTAINER_NAME}" file /usr/local/bin/claude 2>/dev/null || echo "unknown")
RG_VER=$(docker exec "${CONTAINER_NAME}" rg --version 2>/dev/null | head -1 || echo "not found")
NODE_VER=$(docker exec "${CONTAINER_NAME}" node --version 2>/dev/null)

echo ""
echo "  Architecture:  ${ARCH}"
echo "  Libc:          ${LIBC}"
echo "  Claude CLI:    ${CLAUDE_VER}"
echo "  Claude binary: ${CLAUDE_BIN}"
echo "  Ripgrep:       ${RG_VER}"
echo "  Node.js:       ${NODE_VER}"
echo ""

# --------------------------------------------------------------------------
# Phase 2: Run Claude attempt (the actual test)
# --------------------------------------------------------------------------
log "=== PHASE 2: Running Claude Attempt (run-attempt via docker exec) ==="
log "This mimics how the orchestrator invokes: /entrypoint.sh run-attempt"

# Start exec in background, capture output
ATTEMPT_LOG="/tmp/claude-poc-attempt-${VARIANT}.log"
ATTEMPT_START=$(date +%s)

docker exec \
    --env "CLAUDE_CONTINUE=0" \
    --user "${HOST_UID}:${HOST_GID}" \
    --workdir / \
    "${CONTAINER_NAME}" \
    /entrypoint.sh run-attempt \
    > "${ATTEMPT_LOG}" 2>&1 &
EXEC_PID=$!

log "Exec PID: ${EXEC_PID} — monitoring..."

# Monitor in real-time
MONITOR_INTERVAL=5
while kill -0 ${EXEC_PID} 2>/dev/null; do
    sleep ${MONITOR_INTERVAL}
    ELAPSED=$(( $(date +%s) - ATTEMPT_START ))

    # Check for debug logs inside container
    DEBUG_FILES=$(docker exec "${CONTAINER_NAME}" ls -t /home/claude/.claude/debug/ 2>/dev/null | head -1)
    if [ -n "${DEBUG_FILES}" ] && [ "${DEBUG_FILES}" != "latest" ]; then
        LAST_LINE=$(docker exec "${CONTAINER_NAME}" tail -1 "/home/claude/.claude/debug/${DEBUG_FILES}" 2>/dev/null || echo "")
        OAUTH_COUNT=$(docker exec "${CONTAINER_NAME}" grep -c "OAuth token check" "/home/claude/.claude/debug/${DEBUG_FILES}" 2>/dev/null || echo "0")
        RG_STATUS=$(docker exec "${CONTAINER_NAME}" grep "Ripgrep" "/home/claude/.claude/debug/${DEBUG_FILES}" 2>/dev/null || echo "not yet")

        echo -e "  [${ELAPSED}s] debug=${DEBUG_FILES:0:8}... oauth_checks=${OAUTH_COUNT} rg=${RG_STATUS}"
    else
        echo -e "  [${ELAPSED}s] waiting for debug log..."
    fi

    # Timeout after 5 minutes
    if [ ${ELAPSED} -gt 300 ]; then
        warn "Attempt timeout after 300s — killing"
        kill ${EXEC_PID} 2>/dev/null || true
        break
    fi
done

# Capture exit code
wait ${EXEC_PID} 2>/dev/null
EXIT_CODE=$?

ATTEMPT_DURATION=$(( $(date +%s) - ATTEMPT_START ))

echo ""
log "=== PHASE 3: Results ==="
echo ""

if [ ${EXIT_CODE} -eq 139 ] || [ ${EXIT_CODE} -eq 11 ]; then
    fail "SEGFAULT DETECTED (exit code ${EXIT_CODE}) after ${ATTEMPT_DURATION}s"
    echo ""
    echo "  Last 20 lines of attempt output:"
    tail -20 "${ATTEMPT_LOG}" | sed 's/^/  │ /'
elif [ ${EXIT_CODE} -eq 0 ]; then
    ok "Claude completed successfully (exit code 0) in ${ATTEMPT_DURATION}s"
else
    warn "Claude exited with code ${EXIT_CODE} after ${ATTEMPT_DURATION}s"
    echo ""
    echo "  Last 20 lines of attempt output:"
    tail -20 "${ATTEMPT_LOG}" | sed 's/^/  │ /'
fi

# --------------------------------------------------------------------------
# Phase 3: Debug log analysis
# --------------------------------------------------------------------------
echo ""
log "=== Debug Log Analysis ==="

LATEST_DEBUG=$(docker exec "${CONTAINER_NAME}" ls -t /home/claude/.claude/debug/ 2>/dev/null | grep -v latest | head -1)
if [ -n "${LATEST_DEBUG}" ]; then
    TOTAL_LINES=$(docker exec "${CONTAINER_NAME}" wc -l "/home/claude/.claude/debug/${LATEST_DEBUG}" 2>/dev/null | awk '{print $1}')
    OAUTH_COUNT=$(docker exec "${CONTAINER_NAME}" grep -c "OAuth token check" "/home/claude/.claude/debug/${LATEST_DEBUG}" 2>/dev/null || echo "0")
    RG_LINE=$(docker exec "${CONTAINER_NAME}" grep "Ripgrep first use" "/home/claude/.claude/debug/${LATEST_DEBUG}" 2>/dev/null || echo "N/A")
    SEGFAULT_LINE=$(docker exec "${CONTAINER_NAME}" grep -i "segfault\|SIGSEGV\|signal" "/home/claude/.claude/debug/${LATEST_DEBUG}" 2>/dev/null || echo "none")

    echo "  Debug file:     ${LATEST_DEBUG}"
    echo "  Total lines:    ${TOTAL_LINES}"
    echo "  OAuth checks:   ${OAUTH_COUNT}"
    echo "  Ripgrep status: ${RG_LINE}"
    echo "  Crash signals:  ${SEGFAULT_LINE}"
    echo ""
    echo "  Last 5 lines of debug log:"
    docker exec "${CONTAINER_NAME}" tail -5 "/home/claude/.claude/debug/${LATEST_DEBUG}" 2>/dev/null | sed 's/^/  │ /'
else
    warn "No debug logs found"
fi

echo ""
log "Full attempt log saved to: ${ATTEMPT_LOG}"
log "Container '${CONTAINER_NAME}' is still running for further investigation"
echo ""

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo "======================================"
echo " POC TEST RESULT: ${VARIANT}"
echo " Exit Code: ${EXIT_CODE}"
echo " Duration:  ${ATTEMPT_DURATION}s"
echo " Segfault:  $([ ${EXIT_CODE} -eq 139 ] || [ ${EXIT_CODE} -eq 11 ] && echo 'YES' || echo 'NO')"
echo "======================================"
