#!/bin/bash
# BLOCK: Linear MCP guardrails
# 1. State transitions to QA or Done (agents stop at "In Review")
# 2. Setting assignee or delegate (user-only responsibility)
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-linear-state"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only check Linear issue mutation tools
if [[ "$TOOL_NAME" != "mcp__linear__update_issue" && \
      "$TOOL_NAME" != "mcp__linear-server__update_issue" && \
      "$TOOL_NAME" != "mcp__linear__save_issue" && \
      "$TOOL_NAME" != "mcp__linear-server__save_issue" ]]; then
    exit 0
fi

# --- Assignment check (block assignee and delegate) ---

ASSIGNEE=$(echo "$INPUT" | jq -r '.tool_input.assignee // .tool_input.assigneeId // ""')
DELEGATE=$(echo "$INPUT" | jq -r '.tool_input.delegate // ""')

if [[ -n "$ASSIGNEE" ]]; then
    log_blocked "$HOOK_NAME" "forbidden-assignment" \
        "Agent attempted to set assignee to '$ASSIGNEE'" \
        "Issue assignment is the user's responsibility"

    cat >&2 << 'EOF'

BLOCKED: Agents cannot assign Linear issues.

Setting assignee, assigneeId, or delegate is forbidden.
Issue assignment is exclusively the user's responsibility.

Remove the assignee/assigneeId field from your tool call and retry.
EOF
    exit 2
fi

if [[ -n "$DELEGATE" ]]; then
    log_blocked "$HOOK_NAME" "forbidden-delegation" \
        "Agent attempted to set delegate to '$DELEGATE'" \
        "Issue delegation is the user's responsibility"

    cat >&2 << 'EOF'

BLOCKED: Agents cannot delegate Linear issues.

Setting the delegate field is forbidden.
Issue delegation is exclusively the user's responsibility.

Remove the delegate field from your tool call and retry.
EOF
    exit 2
fi

# --- State transition check ---

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
