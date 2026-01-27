#!/bin/bash
# BLOCK: verify:workspace commands with -- before workspace name
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-verify-workspace"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Only check verify:workspace commands
if ! echo "$COMMAND" | grep -qE 'verify:workspace'; then
    exit 0
fi

# BLOCK: verify:workspace with -- before workspace name
if echo "$COMMAND" | grep -qE 'verify:workspace[^\|]*--\s+\w'; then
    cat >&2 << 'EOF'
BLOCKED: Don't use "--" before workspace name.

WRONG:  pnpm run verify:workspace:tracked -- code-agent
CORRECT: pnpm run verify:workspace:tracked code-agent
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
