#!/bin/bash
# PostToolUse Hook: Detect common TypeScript anti-patterns after file edits
# Scans written file content for patterns that cause CI failures:
# - Result type usage without .ok check before .value access
# - Import without .js extension (ESM requirement)
# - | undefined in type position (should use ?:)
#
# BEHAVIOR: Soft block (JSON decision) - forces acknowledgment before continuing
# SUPPRESSION: Use inline comments to suppress false positives:
#   // @allow-missing-js -- reason
#   // @allow-undefined-type -- reason
#   // @allow-result-access -- reason

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
# Skip hook test files (they contain intentional test fixtures with "bad" patterns)
[[ "$FILE_PATH" =~ \.claude/hooks/__tests__/ ]] && exit 0

# Skip if file doesn't exist
[[ ! -f "$FILE_PATH" ]] && exit 0

ISSUES=""
HOOK_NAME="detect-common-patterns"

# Helper function to check if a line has a suppression comment
# Usage: has_suppression "pattern-name" "line_content"
has_suppression() {
    local pattern="$1"
    local line="$2"
    echo "$line" | grep -qE "@allow-${pattern}(\s+--|$)" 2>/dev/null
}

# Pattern 1: Import from local files without .js extension
while IFS= read -r LINE_INFO; do
    [[ -z "$LINE_INFO" ]] && continue

    LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
    LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
    IMPORT_PATH=$(echo "$LINE_INFO" | sed -E "s/.*from ['\"]([^'\"]+)['\"].*/\1/")

    # Check for suppression comment
    if has_suppression "missing-js" "$LINE_CONTENT"; then
        log_info "$HOOK_NAME" "suppressed-missing-js" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-missing-js"
        continue
    fi

    ISSUES+="missing-js-extension at $FILE_PATH:$LINE_NUM - from '$IMPORT_PATH' (add .js extension or suppress with // @allow-missing-js -- reason)\n"
    log_warned "$HOOK_NAME" "missing-js-extension" "$FILE_PATH" \
        "Line $LINE_NUM: from '$IMPORT_PATH'" \
        "Change to: from '$IMPORT_PATH.js'"
done < <(grep -nE "from ['\"]\.\.?/[^'\"]+['\"]" "$FILE_PATH" 2>/dev/null | grep -vE "\.js['\"]" | grep -vE "\.json['\"]" || true)

# Pattern 2: | undefined in type annotation (should use ?: for optional)
while IFS= read -r LINE_INFO; do
    [[ -z "$LINE_INFO" ]] && continue

    LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
    LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
    PROP_NAME=$(echo "$LINE_INFO" | sed -E "s/^\s*(\w+):.*/\1/")

    # Check for suppression comment
    if has_suppression "undefined-type" "$LINE_CONTENT"; then
        log_info "$HOOK_NAME" "suppressed-undefined-type" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-undefined-type"
        continue
    fi

    ISSUES+="bad-undefined-type at $FILE_PATH:$LINE_NUM - '$PROP_NAME: Type | undefined' (use ?: instead or suppress with // @allow-undefined-type -- reason)\n"
    log_warned "$HOOK_NAME" "bad-undefined-type" "$FILE_PATH" \
        "Line $LINE_NUM: $PROP_NAME: Type | undefined" \
        "Use: $PROP_NAME?: Type instead"
done < <(grep -nE "^\s+\w+:\s+\w+\s*\|\s*undefined" "$FILE_PATH" 2>/dev/null || true)

# Pattern 3: Accessing .value on Result without checking .ok
while IFS= read -r LINE_INFO; do
    [[ -z "$LINE_INFO" ]] && continue

    LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
    LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)

    # Check for suppression comment
    if has_suppression "result-access" "$LINE_CONTENT"; then
        log_info "$HOOK_NAME" "suppressed-result-access" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-result-access"
        continue
    fi

    # Check if there's an .ok check in the same function context (simplified: same 10 lines)
    START=$((LINE_NUM - 5))
    [ "$START" -lt 1 ] && START=1
    CONTEXT=$(sed -n "${START},${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)

    if ! echo "$CONTEXT" | grep -qE "\.ok\s*(===|!==|\)|\?|&&|\|\|)"; then
        ISSUES+="result-value-without-ok at $FILE_PATH:$LINE_NUM - accessing .value without .ok check (narrow Result first or suppress with // @allow-result-access -- reason)\n"
        log_warned "$HOOK_NAME" "result-value-without-ok" "$FILE_PATH" \
            "Line $LINE_NUM: $(echo "$LINE_CONTENT" | xargs)" \
            "Narrow Result type before accessing .value: if (!result.ok) return result;"
    fi
done < <(grep -nE "result\w*\.value" "$FILE_PATH" 2>/dev/null | head -3 || true)

# If issues found, output JSON soft block decision
if [ -n "$ISSUES" ]; then
    # Also output to stderr for visibility
    echo "" >&2
    echo "━━━ Pattern Detection: $FILE_PATH ━━━" >&2
    echo -e "$ISSUES" >&2
    echo "" >&2
    echo "Fix these issues or add suppression comments before continuing." >&2

    # Output JSON decision to stdout (soft block)
    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ PATTERN DETECTION: Found anti-patterns in $FILE_PATH that will cause CI failures. Fix them or add suppression comments (@allow-<pattern> -- reason) before continuing. See stderr for details."
}
EOF
fi

exit 0
