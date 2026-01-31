#!/bin/bash
# PostToolUse Hook: Detect common TypeScript anti-patterns after file edits
# Scans written file content for patterns that cause CI failures:
# - Result type usage without .ok check before .value access
# - Import without .js extension (ESM requirement)
# - | undefined in type position (should use ?:)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/detect-common-patterns.log"

cd "$SCRIPT_DIR/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[[ -z "$FILE_PATH" ]] && exit 0

# Make path relative to repo root
FILE_PATH="${FILE_PATH#$(pwd)/}"

# Only check TypeScript files
[[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]] && exit 0
[[ "$FILE_PATH" =~ \.d\.ts$ ]] && exit 0
[[ "$FILE_PATH" =~ node_modules/ ]] && exit 0

# Skip if file doesn't exist
[[ ! -f "$FILE_PATH" ]] && exit 0

WARNINGS=""

# Pattern 1: Import from local files without .js extension
# Match: from './foo' or from '../bar' (without .js)
# Exclude: from '@...' (packages), from '...' (external)
MISSING_EXT=$(grep -nE "from ['\"]\.\.?/[^'\"]+['\"]" "$FILE_PATH" 2>/dev/null | grep -vE "\.js['\"]" | grep -vE "\.json['\"]" || true)
if [ -n "$MISSING_EXT" ]; then
  WARNINGS+="
⚠️  Missing .js extension in imports (ESM requires explicit extensions):
$(echo "$MISSING_EXT" | head -5)
"
fi

# Pattern 2: | undefined in type annotation (should use ?: for optional)
# Match: propertyName: Type | undefined (not in generic position)
# This catches: foo: string | undefined (should be foo?: string)
BAD_UNDEFINED=$(grep -nE "^\s+\w+:\s+\w+\s*\|\s*undefined" "$FILE_PATH" 2>/dev/null || true)
if [ -n "$BAD_UNDEFINED" ]; then
  WARNINGS+="
⚠️  Using '| undefined' instead of optional property (exactOptionalPropertyTypes):
$(echo "$BAD_UNDEFINED" | head -5)
  Consider: 'prop?: Type' instead of 'prop: Type | undefined'
"
fi

# Pattern 3: Accessing .value on Result without checking .ok
# This is harder to detect statically, but we can flag suspicious patterns
# Match lines that have both "result" and ".value" but no ".ok" check nearby
# Simplified: just warn about direct .value access patterns
RESULT_ACCESS=$(grep -nE "result\w*\.value" "$FILE_PATH" 2>/dev/null | head -3 || true)
if [ -n "$RESULT_ACCESS" ]; then
  # Check if there's an .ok check in the same function context (simplified: same 10 lines)
  for LINE_INFO in $RESULT_ACCESS; do
    LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
    START=$((LINE_NUM - 5))
    [ "$START" -lt 1 ] && START=1
    CONTEXT=$(sed -n "${START},${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
    if ! echo "$CONTEXT" | grep -qE "\.ok\s*(===|!==|\)|\?|&&|\|\|)"; then
      WARNINGS+="
⚠️  Possible Result.value access without .ok check (line $LINE_NUM):
$(sed -n "${LINE_NUM}p" "$FILE_PATH")
  Narrow Result type before accessing .value: if (!result.ok) return result;
"
      break
    fi
  done
fi

if [ -n "$WARNINGS" ]; then
  echo "" >&2
  echo "━━━ Pattern Detection: $FILE_PATH ━━━" >&2
  echo "$WARNINGS" >&2
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNED: $FILE_PATH" >> "$LOG_FILE"
fi

exit 0
