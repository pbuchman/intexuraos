#!/bin/bash
# BLOCK: Inefficient polling patterns for GitHub checks
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-polling"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern 1: Block sleep + gh pr checks (polling pattern)
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+.*gh[[:space:]]+(pr[[:space:]]+)?checks'; then
    cat >&2 << 'EOF'

BLOCKED: Polling pattern detected. Use --watch flag instead.

WRONG:  sleep 60 && gh pr checks 123
RIGHT:  gh pr checks 123 --watch

The --watch flag:
  - Blocks until checks complete
  - Uses 2-5x fewer tokens than polling
  - Exits immediately on completion

For background monitoring:
  gh pr checks 123 --watch &
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 2: Block loop-based polling (while/for with gh checks)
if echo "$COMMAND" | grep -qE '(while|for)[[:space:]].*gh[[:space:]]+(pr[[:space:]]+)?checks'; then
    cat >&2 << 'EOF'

BLOCKED: Loop-based polling detected. Use --watch flag instead.

WRONG:  while true; do gh pr checks 123; sleep 60; done
RIGHT:  gh pr checks 123 --watch

The --watch flag handles waiting automatically.
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 3: Block gh run view polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gh[[:space:]]+run[[:space:]]+view'; then
    cat >&2 << 'EOF'

BLOCKED: Polling gh run view. Use gh run watch instead.

WRONG:  sleep 60 && gh run view 12345
RIGHT:  gh run watch 12345
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 4: Block gh run list polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gh[[:space:]]+run[[:space:]]+list'; then
    cat >&2 << 'EOF'

BLOCKED: Polling gh run list. Use gh run watch instead.

WRONG:  sleep 60 && gh run list --workflow e2e.yml
RIGHT:  gh run watch <run-id>

Get the run ID first, then watch it directly.
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 5: Block gcloud builds describe polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gcloud[[:space:]]+builds[[:space:]]+describe'; then
    cat >&2 << 'EOF'

BLOCKED: Polling gcloud builds describe. Use streaming logs instead.

WRONG:  sleep 300 && gcloud builds describe <id> --format="value(status)"
RIGHT:  gcloud builds log <build-id> --stream --region=<region>

The --stream flag tails logs until build completes.
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
