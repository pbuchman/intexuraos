#!/bin/bash
# BLOCK: Prevent direct execution of hook scripts via Bash tool
# Hook scripts expect JSON on stdin from the hook framework.
# Running them directly hangs forever (cat on stdin with no EOF).
# Exit 0 = allow, Exit 2 = block with stderr message

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$COMMAND" | grep -qE '(^|&&|;|\|)\s*(bash|sh|source|\.)\s+.*\.claude/hooks/[^/]+\.sh'; then
    echo "BLOCKED: Do not run hook scripts directly — they expect JSON on stdin from the hook framework and will hang." >&2
    echo "Instead, read the hook's source code to understand what it checks." >&2
    exit 2
fi

exit 0
