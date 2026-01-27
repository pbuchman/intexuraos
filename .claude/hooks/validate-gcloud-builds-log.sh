#!/bin/bash
# BLOCK: gcloud builds log piped to grep/tail/head (network-heavy pattern hunting)
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-gcloud-builds-log"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern: gcloud builds log piped directly to grep/tail/head/awk/sed
# Each invocation re-downloads the entire log from GCP (3-10s per fetch)
if echo "$COMMAND" | grep -qE 'gcloud[[:space:]]+builds[[:space:]]+log[[:space:]]' && \
   echo "$COMMAND" | grep -qE '\|[[:space:]]*(grep|tail|head|awk|sed)'; then
    cat >&2 << 'EOF'
BLOCKED: gcloud builds log piped to grep/tail re-downloads the entire log each time.

Each gcloud builds log call fetches the full log from GCP (3-10s).
Hunting for patterns by piping to different grep/tail commands wastes network calls.

CORRECT: Capture once, then analyze locally:
  gcloud builds log BUILD_ID --region=europe-central2 2>&1 | tee /tmp/build-log.txt

  # Then analyze instantly (unlimited queries):
  grep error /tmp/build-log.txt
  grep "failed" /tmp/build-log.txt
  tail -100 /tmp/build-log.txt
  rg "FAIL|ERROR" /tmp/build-log.txt -C3
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
