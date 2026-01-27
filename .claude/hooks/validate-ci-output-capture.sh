#!/bin/bash
# BLOCK: CI and test commands without proper tee output capture
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-ci-output-capture"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Check pnpm ci, verify:workspace, test commands, and direct vitest invocations
# Matches: pnpm run ci, pnpm run ci:tracked, pnpm run verify:workspace, pnpm run test, pnpm test, pnpm vitest, etc.
if ! echo "$COMMAND" | grep -qE 'pnpm\s+(run\s+(ci(:tracked)?|verify:workspace(:tracked)?|test)|test|vitest|--filter\s+\S+\s+(test|vitest))'; then
    exit 0
fi

# ALLOW: Commands with tee capturing to /tmp/ci-output-*
if echo "$COMMAND" | grep -qE '\|\s*tee\s+/tmp/ci-output-'; then
    exit 0
fi

# BLOCK: CI commands piped to grep/tail/head/awk/sed (without tee)
if echo "$COMMAND" | grep -qE '\|\s*(grep|tail|head|awk|sed)'; then
    cat >&2 << 'EOF'
BLOCKED: Piping test output to grep/tail loses context and wastes ~80s per run.

INSTEAD: Capture first, then analyze:
  pnpm run test 2>&1 | tee /tmp/ci-output-$(date +%H%M%S).txt
  pnpm vitest run 2>&1 | tee /tmp/ci-output-$(date +%H%M%S).txt
  rg "error|FAIL" /tmp/ci-output-*.txt -C3

Or read the test file directly to find the test name you need.
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# BLOCK: CI commands with no output handling (just running bare)
# This is less severe - we want to encourage capture but not strictly require it
# for simple "just run and see" cases. Only block explicit bad patterns above.

exit 0
