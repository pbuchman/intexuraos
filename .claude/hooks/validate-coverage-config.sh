#!/bin/bash
# BLOCK: Modifications to vitest.config.ts coverage settings
# Exit 0 = allow, Exit 2 = block with stderr message

HOOK_NAME="validate-coverage-config"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_blocked() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] BLOCKED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

if echo "$FILE_PATH" | grep -qE 'vitest\.config\.(ts|js)$'; then
    cat >&2 << 'EOF'
╔══════════════════════════════════════════════════════════════════════════════╗
║  ❌ COVERAGE CONFIG MODIFICATION FORBIDDEN                                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  WHAT'S WRONG:                                                               ║
║  You are trying to modify vitest.config.ts.                                  ║
║  Coverage thresholds and exclusions must NEVER be changed.                   ║
║                                                                              ║
║  CORRECT APPROACH:                                                           ║
║  Write tests to increase coverage, not lower thresholds.                     ║
║                                                                              ║
║  IF COVERAGE IS FAILING:                                                     ║
║  1. Run: jq '.total.branches.pct' coverage/coverage-summary.json             ║
║  2. Find gaps: jq 'to_entries[] | select(.value.branches.pct < 100)'         ║
║  3. Write tests for uncovered branches                                       ║
║  4. If branch is truly unreachable, document in:                             ║
║     .claude/skills/coverage/unreachable/<service-name>.md                    ║
║                                                                              ║
║  REFERENCE: .claude/skills/coverage/SKILL.md                                 ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
EOF
    log_blocked "$FILE_PATH"
    exit 2
fi

exit 0
