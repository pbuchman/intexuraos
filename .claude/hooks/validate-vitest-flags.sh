#!/bin/bash
# BLOCK: Redundant/incorrect vitest flags
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-vitest-flags"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Pattern 1: Block --coverage.reporter= (already configured in vitest.config.ts)
# Only match in actual vitest/pnpm test commands, not in heredocs/markdown
if echo "$COMMAND" | grep -qE '(vitest|pnpm[[:space:]]+(run[[:space:]]+)?test)' && \
   echo "$COMMAND" | grep -q -- '--coverage.reporter='; then
    cat >&2 << 'EOF'

BLOCKED: Redundant --coverage.reporter flag.

Coverage reporters are already configured in vitest.config.ts:
  reporter: ['text', 'json', 'json-summary', 'html']

Use: pnpm run test:coverage [path]
Inspect: jq '.total' coverage/coverage-summary.json
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 2: Block raw --coverage flag on pnpm test (but allow test:coverage script)
if echo "$COMMAND" | grep -qE 'pnpm[[:space:]]+(run[[:space:]]+)?test[[:space:]]' && \
   echo "$COMMAND" | grep -q -- '--coverage' && \
   ! echo "$COMMAND" | grep -q 'test:coverage'; then
    cat >&2 << 'EOF'
BLOCKED: Use test:coverage script instead of --coverage flag.

WRONG:  pnpm run test -- --coverage
RIGHT:  pnpm run test:coverage

For specific workspace:
  pnpm run test:coverage apps/research-agent
EOF
    log_blocked "$COMMAND"
    exit 2
fi

# Pattern 3: Block --reporter=verbose (unnecessary)
# Only match in actual vitest/pnpm test commands, not in heredocs/markdown
if echo "$COMMAND" | grep -qE '(vitest|pnpm[[:space:]]+(run[[:space:]]+)?test)' && \
   echo "$COMMAND" | grep -q -- '--reporter=verbose'; then
    cat >&2 << 'EOF'
BLOCKED: --reporter=verbose is unnecessary.

Default vitest output is sufficient. If you need specific info:
  - Test names: default output shows them
  - Coverage: jq '.total' coverage/coverage-summary.json
  - Failures: output already shows full error details
EOF
    log_blocked "$COMMAND"
    exit 2
fi

exit 0
