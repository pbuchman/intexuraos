#!/bin/bash
# Login to Codex CLI for orchestrator (separate from user credentials)
set -euo pipefail

SHARED_AUTH_DIR="$HOME/.code-orchestrator/codex-auth"
WORKER_IMAGE="${INTEXURAOS_CODE_WORKER_IMAGE:-europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest}"

mkdir -p "$SHARED_AUTH_DIR"

echo "=== Codex Orchestrator Login ==="
echo "Shared auth dir: $SHARED_AUTH_DIR"
echo ""

if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY detected."
  echo "The container will run 'codex login --with-api-key' automatically."
  echo "You will stay in the container afterward so you can verify 'codex login status'."
  echo ""

  docker run -it --rm \
    --name codex-orchestrator-login \
    -e OPENAI_API_KEY \
    -v "$SHARED_AUTH_DIR:/home/claude/.codex:rw" \
    --user "$(id -u):$(id -g)" \
    --tmpfs "/home/claude:rw,noexec,nosuid,size=100m,uid=$(id -u),gid=$(id -g)" \
    --entrypoint /bin/bash \
    "$WORKER_IMAGE" \
    -lc 'mkdir -p /home/claude/.codex && printenv OPENAI_API_KEY | codex login --with-api-key && exec bash'
else
  echo "No OPENAI_API_KEY detected."
  echo "You will be dropped into a Docker container."
  echo "Run one of:"
  echo "  codex login --with-api-key"
  echo "  codex login --device-auth"
  echo ""

  docker run -it --rm \
    --name codex-orchestrator-login \
    -v "$SHARED_AUTH_DIR:/home/claude/.codex:rw" \
    --user "$(id -u):$(id -g)" \
    --tmpfs "/home/claude:rw,noexec,nosuid,size=100m,uid=$(id -u),gid=$(id -g)" \
    --entrypoint /bin/bash \
    "$WORKER_IMAGE" \
    -lc 'mkdir -p /home/claude/.codex && exec bash'
fi

if [ -f "$SHARED_AUTH_DIR/auth.json" ]; then
  echo ""
  echo "Credentials saved to $SHARED_AUTH_DIR"
  echo "Orchestrator can mount this auth file for Codex-backed workers."
else
  echo ""
  echo "No Codex auth found. Run login again inside the container."
  exit 1
fi
