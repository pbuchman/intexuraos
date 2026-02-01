#!/bin/bash
# BLOCK: CI and test commands without proper tee output capture
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-ci-output-capture"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Check pnpm ci, verify:workspace, test commands, and direct vitest invocations
if ! echo "$COMMAND" | grep -qE 'pnpm\s+(run\s+(ci(:tracked)?|verify:workspace(:tracked)?|test)|test|vitest|exec\s+vitest|--filter\s+\S+\s+(test|vitest))'; then
    exit 0
fi

# ALLOW: Commands with tee capturing to /tmp/ci-output-*
if echo "$COMMAND" | grep -qE '\|\s*tee\s+/tmp/ci-output-'; then
    exit 0
fi

# BLOCK: CI commands piped to grep/tail/head/awk/sed (without tee)
if echo "$COMMAND" | grep -qE '\|\s*(grep|tail|head|awk|sed)'; then

    log_blocked "$HOOK_NAME" "output-truncation" \
        "Piping output to grep/tail loses CI failure details" \
        "Use: 2>&1 | tee /tmp/ci-output-\$(date +%s).log"

    cat >&2 << 'EOF'

BLOCKED: Piping output to grep/tail loses context and wastes time.

INSTEAD: Capture first, then analyze:
  pnpm run test 2>&1 | tee /tmp/ci-output-$(date +%H%M%S).txt
  pnpm vitest run 2>&1 | tee /tmp/ci-output-$(date +%H%M%S).txt
  rg "error|FAIL" /tmp/ci-output-*.txt -C3

Or read the test file directly to find the test name you need.
EOF
    exit 2
fi

exit 0
