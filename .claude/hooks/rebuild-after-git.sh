#!/bin/bash
# PostToolUse Hook: Rebuild packages after git operations
# Triggers pnpm build if git pull/merge/checkout/rebase/reset/stash changed buildable packages.

set -euo pipefail

cd "$(dirname "$0")/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only check git commands that change working tree
if ! echo "$COMMAND" | grep -qE '^git (pull|merge|checkout|rebase|reset|stash)'; then
  exit 0
fi

# Check if any buildable package source changed
# Using HEAD@{1} to compare before/after the git operation
CHANGED=$(git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -E '^packages/(internal-clients|llm-prompts|llm-utils)/src/' || true)

if [ -n "$CHANGED" ]; then
  echo "Buildable package changed by git operation, rebuilding..." >&2
  pnpm build >&2
fi

exit 0
