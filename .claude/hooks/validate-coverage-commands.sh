#!/bin/bash
# BLOCK: Coverage analysis with grep instead of jq on coverage-summary.json
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-coverage-commands"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern: RUNNING coverage tools + piping to text processors (FORBIDDEN)
COVERAGE_TOOL_PATTERN='(vitest\s+.*--coverage|pnpm\s+(run\s+)?(test:)?coverage|npm\s+(run\s+)?(test:)?coverage|npx\s+.*--coverage)'

if echo "$COMMAND" | grep -qE "$COVERAGE_TOOL_PATTERN" && \
   echo "$COMMAND" | grep -qE '\|\s*(grep|tail|head|awk|sed)'; then

    log_blocked "$HOOK_NAME" "coverage-with-grep" \
        "Parsing coverage output with grep/tail causes truncation errors" \
        "Use jq on the JSON summary: jq '.total.branches.pct' coverage/coverage-summary.json"

    cat >&2 << 'EOF'

BLOCKED: Parsing coverage output with grep/tail causes truncation errors.

INSTEAD: Use jq on the JSON summary:
  jq '.total.branches.pct' coverage/coverage-summary.json
  jq -r 'to_entries[] | select(.value.branches.pct < 100) | .key' coverage/coverage-summary.json
EOF
    exit 2
fi

exit 0
