#!/bin/bash
# PostToolUse Hook: Format markdown tables after editing .md files
# Runs pnpm format:docs-tables to keep table alignment consistent.

set -euo pipefail

cd "$(dirname "$0")/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[[ -z "$FILE_PATH" ]] && exit 0

# Only trigger for markdown files
[[ "$FILE_PATH" != *.md ]] && exit 0

pnpm run format:docs-tables >/dev/null 2>&1 || true

exit 0
