#!/bin/bash
# BLOCK: CI commands without proper tee output capture
# Exit 0 = allow, Exit 2 = block with stderr message

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
[[ -z "$COMMAND" ]] && exit 0

# Only check pnpm run ci and verify:workspace commands
if ! echo "$COMMAND" | grep -qE 'pnpm\s+run\s+(ci|verify:workspace)'; then
    exit 0
fi

# ALLOW: Commands with tee capturing to /tmp/ci-output-*
if echo "$COMMAND" | grep -qE '\|\s*tee\s+/tmp/ci-output-'; then
    exit 0
fi

# BLOCK: CI commands piped to grep/tail/head/awk/sed (without tee)
if echo "$COMMAND" | grep -qE '\|\s*(grep|tail|head|awk|sed)'; then
    cat >&2 << 'EOF'
╔══════════════════════════════════════════════════════════════════════════════╗
║  ❌ CI OUTPUT CAPTURE VIOLATION                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT'S WRONG:                                                               ║
║  You are piping CI output directly to grep/tail/head without capturing it.   ║
║  This loses the full output and makes debugging impossible.                  ║
║                                                                              ║
║  CORRECT APPROACH - Capture with tee first:                                  ║
║                                                                              ║
║    BRANCH=$(git branch --show-current | sed 's/\//-/g')                      ║
║    pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-${BRANCH}-$(date +%Y%m%d-%H%M%S).txt
║                                                                              ║
║  THEN analyze the saved file using proper tools:                             ║
║                                                                              ║
║  PREFERRED TOOLS (in order):                                                 ║
║    1. bat /tmp/ci-output-*.txt           # Syntax highlighting, paging       ║
║    2. rg "error|Error|FAIL" /tmp/ci-*    # Ripgrep - fast, smart search      ║
║    3. jq (for JSON files like coverage-summary.json)                         ║
║    4. grep (fallback only if above unavailable)                              ║
║                                                                              ║
║  EXAMPLE - Find errors with ripgrep:                                         ║
║    rg -i "error|fail" /tmp/ci-output-*.txt --context 3                       ║
║                                                                              ║
║  EXAMPLE - View with syntax highlighting:                                    ║
║    bat /tmp/ci-output-*.txt --paging=never | head -100                       ║
║                                                                              ║
║  REFERENCE: .claude/reference/ci-output-analysis.md                          ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    exit 2
fi

# BLOCK: CI commands with no output handling (just running bare)
# This is less severe - we want to encourage capture but not strictly require it
# for simple "just run and see" cases. Only block explicit bad patterns above.

exit 0
