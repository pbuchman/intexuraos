#!/bin/bash
# PostToolUse Hook: Rebuild package after editing source files
# Triggers targeted rebuild when packages/*/src/ files are edited.
# This catches 70%+ of CI failures (no-unsafe-* lint errors from stale types).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/rebuild-on-package-edit.log"

cd "$SCRIPT_DIR/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[[ -z "$FILE_PATH" ]] && exit 0

# Make path relative to repo root
FILE_PATH="${FILE_PATH#$(pwd)/}"

# Check if file is in a buildable package's src/
if [[ "$FILE_PATH" =~ ^packages/([^/]+)/src/ ]]; then
  PACKAGE_NAME="${BASH_REMATCH[1]}"
  PACKAGE_DIR="packages/$PACKAGE_NAME"

  # Verify package has a build script
  if [ -f "$PACKAGE_DIR/package.json" ]; then
    HAS_BUILD=$(jq -r '.scripts.build // empty' "$PACKAGE_DIR/package.json" 2>/dev/null) || true
    if [ -n "$HAS_BUILD" ]; then
      # Get the package name from package.json for --filter
      PKG_JSON_NAME=$(jq -r '.name // empty' "$PACKAGE_DIR/package.json" 2>/dev/null) || true
      if [ -n "$PKG_JSON_NAME" ]; then
        echo "Rebuilding $PKG_JSON_NAME after edit..." >&2
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] REBUILD: $PKG_JSON_NAME ($FILE_PATH)" >> "$LOG_FILE"
        pnpm --filter "$PKG_JSON_NAME" build >&2 2>&1 || true
      fi
    fi
  fi
fi

exit 0
