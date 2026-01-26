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
╔══════════════════════════════════════════════════════════════════════════════╗
║  ❌ COVERAGE ANALYSIS VIOLATION                                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT'S WRONG:                                                               ║
║  You are using grep/tail/head/awk/sed to parse coverage output.              ║
║  This causes truncation and parsing errors.                                  ║
║                                                                              ║
║  CORRECT APPROACH:                                                           ║
║  1. Run: pnpm run test:coverage --coverage.reporter=json-summary             ║
║  2. Parse: jq '.total.branches.pct' coverage/coverage-summary.json           ║
║  3. Filter files: jq 'to_entries | map(select(.value.branches.pct < 100))'   ║
║                                                                              ║
║  EXAMPLE - Check if coverage passes 95%:                                     ║
║    BRANCHES=$(jq '.total.branches.pct' coverage/coverage-summary.json)       ║
║    if (( $(echo "$BRANCHES < 95" | bc -l) )); then                           ║
║      echo "Coverage failed: $BRANCHES%"                                      ║
║    fi                                                                        ║
║                                                                              ║
║  EXAMPLE - Find files below threshold:                                       ║
║    jq -r 'to_entries[]                                                       ║
║      | select(.key != "total")                                               ║
║      | select(.value.branches.pct < 100)                                     ║
║      | "\(.key): \(.value.branches.pct)%"' coverage/coverage-summary.json    ║
║                                                                              ║
║  REFERENCE: .claude/skills/coverage/workflows/targeted-audit.md              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
