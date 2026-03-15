#!/bin/bash
# SOFT-BLOCK: Recommend modern CLI tools over legacy ones
# Suggests: grep -r → rg, find -name → fd/Glob
#
# BEHAVIOR: Soft block (JSON decision: block, exit 0) — educates, doesn't enforce
# Uses log_warned level since these are suggestions, not hard blocks.
#
# Conservative patterns to avoid false positives:
#   - grep: Only blocks recursive flags (-r, -rn, --recursive), not pipe filtering
#   - find: Only blocks search-only usage (-name/-iname/-type), not action usage (-exec/-delete)
#
# Reference: CLAUDE.md → Bash tool description recommends built-in tools (Grep, Read, Glob)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="tool-recommendations"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# ═══════════════════════════════════════════════════════════════════════════════
# Pattern 1: grep with recursive flags → suggest rg or Grep tool
# Match: grep -r, grep -rn, grep -rl, grep -rnE, grep --recursive
# Allow: | grep (pipeline), grep -q (conditional), git grep, grep on single file
# ═══════════════════════════════════════════════════════════════════════════════

# Check for standalone grep with recursive flags (not piped, not git grep)
# Exclude piped usage: "| grep -r" should be allowed since it's filtering output
if echo "$COMMAND" | grep -qE '(^|[;&]\s*)grep\s+(-[a-zA-Z]*r[a-zA-Z]*\s|--recursive)' && \
   ! echo "$COMMAND" | grep -qE '\|\s*grep\s'; then

    log_warned "$HOOK_NAME" "grep-recursive" "-" \
        "Using grep with recursive flags for code search" \
        "Use the built-in Grep tool or rg command instead"

    cat << 'EOF'
{
  "decision": "block",
  "reason": "Use the built-in Grep tool or `rg` instead of `grep -r` for code search. The Grep tool is faster, respects .gitignore, and provides better output. See CLAUDE.md: 'Content search: Use Grep (NOT grep or rg)'."
}
EOF
    exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Pattern 3: find for file search → suggest Glob tool or fd
# Match: find <path> -name/-iname/-type (search-only)
# Allow: find with -exec, find with -delete (action-oriented)
# ═══════════════════════════════════════════════════════════════════════════════

# Check for find with search flags, but not when combined with action flags
if echo "$COMMAND" | grep -qE '(^|[;&|]\s*)find\s+\S+\s+.*(-name|-iname|-type)\s' && \
   ! echo "$COMMAND" | grep -qE '(-exec|-delete|-print0\s*\|)'; then

    log_warned "$HOOK_NAME" "find-search" "-" \
        "Using find for file search" \
        "Use the built-in Glob tool or fd command instead"

    cat << 'EOF'
{
  "decision": "block",
  "reason": "Use the built-in Glob tool or `fd` instead of `find` for file searches. The Glob tool is faster and supports glob patterns natively. See CLAUDE.md: 'File search: Use Glob (NOT find or ls)'."
}
EOF
    exit 0
fi

exit 0
