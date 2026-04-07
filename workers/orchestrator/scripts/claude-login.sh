#!/bin/bash
# Login to Claude Code for orchestrator (separate from user credentials)
set -euo pipefail

SHARED_CREDS_DIR="$HOME/.code-orchestrator/claude-creds"
WORKER_IMAGE="${INTEXURAOS_CODE_WORKER_IMAGE:-europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest}"

mkdir -p "$SHARED_CREDS_DIR"

echo "=== Claude Orchestrator Login ==="
echo "You'll be dropped into a Docker container."
echo "Run 'claude login' and follow the prompts."
echo ""

docker run -it --rm \
  --name claude-orchestrator-login \
  -v "$SHARED_CREDS_DIR:/home/claude/.claude:rw" \
  --user "$(id -u):$(id -g)" \
  --tmpfs "/home/claude:rw,noexec,nosuid,size=100m,uid=$(id -u),gid=$(id -g)" \
  --entrypoint /bin/bash \
  "$WORKER_IMAGE" \
  -c 'cp -rn /opt/claude-defaults/. /home/claude/ 2>/dev/null; exec bash'

# Verify
if [ -f "$SHARED_CREDS_DIR/.credentials.json" ]; then
  echo ""
  echo "Credentials saved to $SHARED_CREDS_DIR"
  echo "Orchestrator will use these for worker tasks."
else
  echo ""
  echo "No credentials found. Run 'claude login' inside the container."
  exit 1
fi
