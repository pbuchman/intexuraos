#!/bin/bash
# WARN: Modifications to vitest.config.ts require explicit approval
# Exit 0 = allow (with warning), Exit 2 = block

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="validate-coverage-config"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

if echo "$FILE_PATH" | grep -qE 'vitest\.config\.(ts|js)$'; then
    log_warned "$HOOK_NAME" "vitest-config-edit" "$FILE_PATH" \
        "Editing vitest.config.ts requires explicit approval" \
        "If lowering coverage: STOP. Write tests instead."

    cat >&2 << 'EOF'

WARNING: Editing vitest.config.ts

Changes to coverage thresholds/exclusions require explicit user approval.
Unapproved changes will be rejected and cause the task to fail.

If lowering coverage to pass CI: STOP. Write tests instead.
EOF
fi

exit 0
