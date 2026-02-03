#!/bin/bash
# PostToolUse Hook: Rebuild packages after git operations
# Triggers pnpm build if git pull/merge/checkout/rebase/reset/stash changed buildable packages.
# Also warns if packages are missing dist/ after branch switch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="rebuild-after-git"

cd "$SCRIPT_DIR/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only check git commands that change working tree
if ! echo "$COMMAND" | grep -qE '^git (pull|merge|checkout|switch|rebase|reset|stash)'; then
  exit 0
fi

# Check if any buildable package source changed
# Using HEAD@{1} to compare before/after the git operation
CHANGED=$(git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -E '^packages/(internal-clients|llm-prompts|llm-utils)/src/' || true)

if [ -n "$CHANGED" ]; then
  echo "Buildable package changed by git operation, rebuilding..." >&2
  log_info "$HOOK_NAME" "rebuild-triggered" "Git operation changed packages, rebuilding"
  # Skip actual build in test mode (set by hook tests)
  if [ "${HOOK_DRY_RUN:-}" != "1" ]; then
    pnpm build >&2
  fi
  exit 0
fi

# After branch switch (checkout/switch), check if any package is missing dist/
# This catches cases where switching to a branch requires a rebuild
if echo "$COMMAND" | grep -qE '^git (checkout|switch)'; then
  MISSING_DIST=""
  for pkg in packages/*/; do
    if [ -f "$pkg/package.json" ]; then
      HAS_BUILD=$(jq -r '.scripts.build // empty' "$pkg/package.json" 2>/dev/null) || true
      if [ -n "$HAS_BUILD" ] && [ ! -d "$pkg/dist" ]; then
        PKG_NAME=$(basename "$pkg")
        MISSING_DIST+="$PKG_NAME "
      fi
    fi
  done

  if [ -n "$MISSING_DIST" ]; then
    echo "" >&2
    echo "⚠️  WARNING: After branch switch, these packages need rebuild:" >&2
    echo "   $MISSING_DIST" >&2
    echo "   Run: pnpm build" >&2
    echo "" >&2
    log_warned "$HOOK_NAME" "missing-dist-after-switch" "-" \
        "Packages missing dist/ after branch switch: $MISSING_DIST" \
        "Run: pnpm build"
  fi
fi

exit 0
