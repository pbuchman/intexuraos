#!/bin/bash
# WARN: Modifications to vitest.config.ts require explicit approval
# Exit 0 = allow (with warning), Exit 2 = block

HOOK_NAME="validate-coverage-config"
LOG_FILE="$(dirname "$0")/${HOOK_NAME}.log"

log_warned() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNED: $1" >> "$LOG_FILE"
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

if echo "$FILE_PATH" | grep -qE 'vitest\.config\.(ts|js)$'; then
    cat >&2 << 'EOF'
WARNING: Editing vitest.config.ts

Changes to coverage thresholds/exclusions require explicit user approval.
Unapproved changes will be rejected and cause the task to fail.

If lowering coverage to pass CI: STOP. Write tests instead.
EOF
    log_warned "$FILE_PATH"
fi

exit 0
