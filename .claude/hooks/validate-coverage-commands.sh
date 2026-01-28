#!/bin/bash
# BLOCK: Coverage analysis with grep instead of jq on coverage-summary.json
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-coverage-commands"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern: RUNNING coverage tools + piping to text processors (FORBIDDEN)
# Only match actual coverage tool execution, not "coverage" in branch names, paths, or searches
#
# BLOCKED:
#   vitest --coverage | grep ...
#   pnpm run test:coverage | tail ...
#   pnpm run coverage | head ...
#
# ALLOWED:
#   git pull origin branch-with-coverage | tail    (branch name)
#   ls coverage/ | head                            (directory listing)
#   cat coverage/summary.json | head               (file inspection)
#   grep -r "coverage" . | head                    (code search)
#
COVERAGE_TOOL_PATTERN='(vitest\s+.*--coverage|pnpm\s+(run\s+)?(test:)?coverage|npm\s+(run\s+)?(test:)?coverage|npx\s+.*--coverage)'
if echo "$COMMAND" | grep -qE "$COVERAGE_TOOL_PATTERN" && \
   echo "$COMMAND" | grep -qE '\|\s*(grep|tail|head|awk|sed)'; then
    cat >&2 << 'EOF'

BLOCKED: Parsing coverage output with grep/tail causes truncation errors.

INSTEAD: Use jq on the JSON summary:
  jq '.total.branches.pct' coverage/coverage-summary.json
  jq -r 'to_entries[] | select(.value.branches.pct < 100) | .key' coverage/coverage-summary.json
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
