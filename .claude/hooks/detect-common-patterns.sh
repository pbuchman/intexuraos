#!/bin/bash
# PostToolUse Hook: Detect common TypeScript anti-patterns after file edits
# Scans written file content for patterns that cause CI failures:
# - Result type usage without .ok check before .value access
# - Import without .js extension (ESM requirement)
# - | undefined in type position (should use ?:)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

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
HOOK_NAME="detect-common-patterns"

# Pattern 1: Import from local files without .js extension
MISSING_EXT=$(grep -nE "from ['\"]\.\.?/[^'\"]+['\"]" "$FILE_PATH" 2>/dev/null | grep -vE "\.js['\"]" | grep -vE "\.json['\"]" || true)
if [ -n "$MISSING_EXT" ]; then
    FIRST_LINE=$(echo "$MISSING_EXT" | head -1)
    LINE_NUM=$(echo "$FIRST_LINE" | cut -d: -f1)
    IMPORT_PATH=$(echo "$FIRST_LINE" | sed -E "s/.*from ['\"]([^'\"]+)['\"].*/\1/")

    WARNINGS+="
⚠️  Missing .js extension in imports (ESM requires explicit extensions):
$(echo "$MISSING_EXT" | head -5)
"
    log_warned "$HOOK_NAME" "missing-js-extension" "$FILE_PATH" \
        "Line $LINE_NUM: from '$IMPORT_PATH'" \
        "Change to: from '$IMPORT_PATH.js'"
fi

# Pattern 2: | undefined in type annotation (should use ?: for optional)
BAD_UNDEFINED=$(grep -nE "^\s+\w+:\s+\w+\s*\|\s*undefined" "$FILE_PATH" 2>/dev/null || true)
if [ -n "$BAD_UNDEFINED" ]; then
    FIRST_LINE=$(echo "$BAD_UNDEFINED" | head -1)
    LINE_NUM=$(echo "$FIRST_LINE" | cut -d: -f1)
    PROP_NAME=$(echo "$FIRST_LINE" | sed -E "s/^\s*(\w+):.*/\1/")

    WARNINGS+="
⚠️  Using '| undefined' instead of optional property (exactOptionalPropertyTypes):
$(echo "$BAD_UNDEFINED" | head -5)
"
    log_warned "$HOOK_NAME" "bad-undefined-type" "$FILE_PATH" \
        "Line $LINE_NUM: $PROP_NAME: Type | undefined" \
        "Use: $PROP_NAME?: Type instead"
fi

# Pattern 3: Accessing .value on Result without checking .ok
RESULT_ACCESS=$(grep -nE "result\w*\.value" "$FILE_PATH" 2>/dev/null | head -3 || true)
if [ -n "$RESULT_ACCESS" ]; then
    # Check if there's an .ok check in the same function context (simplified: same 10 lines)
    for LINE_INFO in $RESULT_ACCESS; do
        LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
        START=$((LINE_NUM - 5))
        [ "$START" -lt 1 ] && START=1
        CONTEXT=$(sed -n "${START},${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
        if ! echo "$CONTEXT" | grep -qE "\.ok\s*(===|!==|\)|\?|&&|\|\|)"; then
            CODE_LINE=$(sed -n "${LINE_NUM}p" "$FILE_PATH")
            WARNINGS+="
⚠️  Possible Result.value access without .ok check (line $LINE_NUM):
$CODE_LINE
"
            log_warned "$HOOK_NAME" "result-value-without-ok" "$FILE_PATH" \
                "Line $LINE_NUM: $(echo "$CODE_LINE" | xargs)" \
                "Narrow Result type before accessing .value: if (!result.ok) return result;"
            break
        fi
    done
fi

if [ -n "$WARNINGS" ]; then
    echo "" >&2
    echo "━━━ Pattern Detection: $FILE_PATH ━━━" >&2
    echo "$WARNINGS" >&2
fi

exit 0
