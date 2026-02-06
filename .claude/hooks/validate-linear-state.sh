#!/bin/bash
# BLOCK: Linear MCP state transitions to QA or Done
# Agents can only move issues to "In Review" at most
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-linear-state"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only check Linear update_issue tools
if [[ "$TOOL_NAME" != "mcp__linear__update_issue" && "$TOOL_NAME" != "mcp__linear-server__update_issue" ]]; then
    exit 0
fi

# Get the state being set
STATE=$(echo "$INPUT" | jq -r '.tool_input.state // ""')

# If no state change, allow
[[ -z "$STATE" ]] && exit 0

# Normalize to lowercase for comparison
STATE_LOWER=$(echo "$STATE" | tr '[:upper:]' '[:lower:]')

# Block QA and Done states (by name or type)
# IntexuraOS status IDs:
# - QA: 0834f4c6-ed6b-4992-8340-023648f472d6
# - Done: e95d5420-217a-4085-a8ea-3d01b4926e90
BLOCKED_STATES="qa|done|0834f4c6-ed6b-4992-8340-023648f472d6|e95d5420-217a-4085-a8ea-3d01b4926e90"

if echo "$STATE_LOWER" | grep -qE "^($BLOCKED_STATES)$"; then
    log_blocked "$HOOK_NAME" "forbidden-state-transition" \
        "Agent attempted to move issue to '$STATE'" \
        "Maximum agent-controlled state is 'In Review'"

    cat >&2 << 'EOF'

BLOCKED: Agents cannot move Linear issues to QA or Done.

The maximum state an agent can set is "In Review".
Moving to QA or Done requires explicit user instruction.

Allowed transitions:
  - Backlog/Todo → In Progress
  - In Progress → In Review

Forbidden transitions:
  - Any → QA
  - Any → Done

If QA or Done is needed, ask the user to update the issue manually.
EOF
    exit 2
fi

exit 0
