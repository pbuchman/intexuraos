#!/bin/bash
# PostToolUse Hook: Incremental typecheck after editing TypeScript files
# Runs tsc --noEmit on the edited file to catch type errors immediately.
# This catches ~20% of CI failures (property does not exist, exactOptionalPropertyTypes).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/typecheck-after-edit.log"

cd "$SCRIPT_DIR/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[[ -z "$FILE_PATH" ]] && exit 0

# Make path relative to repo root
FILE_PATH="${FILE_PATH#$(pwd)/}"

# Only check TypeScript files (not .d.ts)
[[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]] && exit 0
[[ "$FILE_PATH" =~ \.d\.ts$ ]] && exit 0

# Skip node_modules and dist
[[ "$FILE_PATH" =~ node_modules/ ]] && exit 0
[[ "$FILE_PATH" =~ /dist/ ]] && exit 0

# Find the workspace root for this file (apps/X or packages/X or workers/X)
WORKSPACE_DIR=""
if [[ "$FILE_PATH" =~ ^(apps/[^/]+)/ ]]; then
  WORKSPACE_DIR="${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ ^(packages/[^/]+)/ ]]; then
  WORKSPACE_DIR="${BASH_REMATCH[1]}"
elif [[ "$FILE_PATH" =~ ^(workers/[^/]+)/ ]]; then
  WORKSPACE_DIR="${BASH_REMATCH[1]}"
fi

# If no workspace found, skip (e.g., root-level scripts)
[[ -z "$WORKSPACE_DIR" ]] && exit 0

# Check if workspace has tsconfig.json
[[ ! -f "$WORKSPACE_DIR/tsconfig.json" ]] && exit 0

# Run incremental typecheck using workspace tsconfig
# --skipLibCheck for speed, errors go to stderr
OUTPUT=$(cd "$WORKSPACE_DIR" && npx tsc --noEmit --skipLibCheck 2>&1) || {
  ERROR_COUNT=$(echo "$OUTPUT" | grep -c "error TS" || echo "0")
  if [ "$ERROR_COUNT" -gt 0 ]; then
    echo "" >&2
    echo "⚠️  TypeScript errors detected in $WORKSPACE_DIR ($ERROR_COUNT errors):" >&2
    echo "$OUTPUT" | grep -A2 "error TS" | head -20 >&2
    echo "" >&2
    echo "Run 'pnpm --filter $(basename $WORKSPACE_DIR) typecheck' for full output." >&2
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERRORS: $FILE_PATH ($ERROR_COUNT errors)" >> "$LOG_FILE"
  fi
}

exit 0
