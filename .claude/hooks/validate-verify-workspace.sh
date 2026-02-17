#!/bin/bash
# BLOCK: verify:workspace commands with -- before workspace name
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-verify-workspace"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# BLOCK: Direct script execution (must use pnpm script)
if echo "$COMMAND" | grep -qE '^node[[:space:]]+scripts/verify-workspace'; then

    log_blocked "$HOOK_NAME" "direct-script-execution" \
        "Using node directly instead of pnpm script" \
        "Use: pnpm run verify:workspace:tracked <name>"

    cat >&2 << 'EOF'

BLOCKED: Use pnpm script instead of direct node execution.

WRONG:  node scripts/verify-workspace-tracked.mjs <name>
RIGHT:  pnpm run verify:workspace:tracked <name>
EOF
    exit 2
fi

# Only check verify:workspace commands
if ! echo "$COMMAND" | grep -qE 'verify:workspace'; then
    exit 0
fi

# BLOCK: verify:workspace with -- before workspace name
if echo "$COMMAND" | grep -qE 'verify:workspace[^\|]*--\s+\w'; then

    log_blocked "$HOOK_NAME" "double-dash-workspace-name" \
        "Using '--' before workspace name which is incorrect" \
        "Use: pnpm run verify:workspace:tracked <name> (no --)"

    cat >&2 << 'EOF'
BLOCKED: Don't use "--" before workspace name.

WRONG:  pnpm run verify:workspace:tracked -- code-agent
CORRECT: pnpm run verify:workspace:tracked code-agent
EOF
    exit 2
fi

exit 0
