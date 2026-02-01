#!/bin/bash
# BLOCK: Inefficient polling patterns for GitHub checks
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-polling"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern 1: Block sleep + gh pr checks (polling pattern)
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+.*gh[[:space:]]+(pr[[:space:]]+)?checks'; then

    log_blocked "$HOOK_NAME" "gh-pr-checks-polling" \
        "Using sleep + gh pr checks polling wastes tokens" \
        "Use: gh pr checks 123 --watch (blocks until complete)"

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
    exit 2
fi

# Pattern 2: Block loop-based polling (while/for with gh checks)
if echo "$COMMAND" | grep -qE '(while|for)[[:space:]].*gh[[:space:]]+(pr[[:space:]]+)?checks'; then

    log_blocked "$HOOK_NAME" "gh-checks-loop-polling" \
        "Using loop-based gh checks polling is inefficient" \
        "Use: gh pr checks 123 --watch"

    cat >&2 << 'EOF'

BLOCKED: Loop-based polling detected. Use --watch flag instead.

WRONG:  while true; do gh pr checks 123; sleep 60; done
RIGHT:  gh pr checks 123 --watch

The --watch flag handles waiting automatically.
EOF
    exit 2
fi

# Pattern 3: Block gh run view polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gh[[:space:]]+run[[:space:]]+view'; then

    log_blocked "$HOOK_NAME" "gh-run-view-polling" \
        "Using sleep + gh run view polling wastes tokens" \
        "Use: gh run watch <run-id>"

    cat >&2 << 'EOF'

BLOCKED: Polling gh run view. Use gh run watch instead.

WRONG:  sleep 60 && gh run view 12345
RIGHT:  gh run watch 12345
EOF
    exit 2
fi

# Pattern 4: Block gh run list polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gh[[:space:]]+run[[:space:]]+list'; then

    log_blocked "$HOOK_NAME" "gh-run-list-polling" \
        "Using sleep + gh run list polling is inefficient" \
        "Use: gh run watch <run-id>"

    cat >&2 << 'EOF'

BLOCKED: Polling gh run list. Use gh run watch instead.

WRONG:  sleep 60 && gh run list --workflow e2e.yml
RIGHT:  gh run watch <run-id>

Get the run ID first, then watch it directly.
EOF
    exit 2
fi

# Pattern 5: Block gcloud builds describe polling
if echo "$COMMAND" | grep -qE 'sleep[[:space:]]+[0-9]+' && \
   echo "$COMMAND" | grep -qE 'gcloud[[:space:]]+builds[[:space:]]+describe'; then

    log_blocked "$HOOK_NAME" "gcloud-builds-polling" \
        "Using sleep + gcloud builds describe polling is inefficient" \
        "Use: gcloud builds log <id> --stream --region=<region>"

    cat >&2 << 'EOF'

BLOCKED: Polling gcloud builds describe. Use streaming logs instead.

WRONG:  sleep 300 && gcloud builds describe <id> --format="value(status)"
RIGHT:  gcloud builds log <build-id> --stream --region=<region>

The --stream flag tails logs until build completes.
EOF
    exit 2
fi

exit 0
