#!/bin/bash
# PostToolUse Hook: Detect common anti-patterns after file edits
# Consolidated checker for patterns that cause CI failures:
#
# TypeScript patterns:
# - Result type usage without .ok check before .value access
# - Import without .js extension (ESM requirement)
# - | undefined in type position (should use ?:)
#
# Sentry/Logging patterns:
# - Direct pino import in apps/ (should use createAppLogger)
#
# Response contract patterns:
# - Raw reply.send() in routes (should use reply.ok/fail)
#
# Migration patterns:
# - Modification of existing migration files (immutable)
#
# Coverage patterns:
# - v8 ignore comment added without writing tests first
#
# BEHAVIOR: Soft block (JSON decision) - forces acknowledgment before continuing
# SUPPRESSION: Use inline comments to suppress false positives:
#   // @allow-missing-js -- reason
#   // @allow-undefined-type -- reason
#   // @allow-result-access -- reason
#   // @allow-pino-import -- reason
#   // @allow-raw-send -- reason
#   (v8 ignore has no suppression - always reminds)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared libraries
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"
# shellcheck source=lib/checks.sh
source "${SCRIPT_DIR}/lib/checks.sh"

cd "$SCRIPT_DIR/../.." || exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[[ -z "$FILE_PATH" ]] && exit 0

# Make path relative to repo root
FILE_PATH="${FILE_PATH#$(pwd)/}"

# Skip hook test fixture files
[[ "$FILE_PATH" =~ \.claude/hooks/__tests__/fixtures/ ]] && exit 0

# Skip node_modules
[[ "$FILE_PATH" =~ node_modules/ ]] && exit 0

# Skip if file doesn't exist (for Write operations on truly new files)
[[ ! -f "$FILE_PATH" ]] && exit 0

ISSUES=""
HOOK_NAME="detect-common-patterns"

# ═══════════════════════════════════════════════════════════════════════════════
# MIGRATION CHECK (runs on .mjs files)
# ═══════════════════════════════════════════════════════════════════════════════
if [[ "$FILE_PATH" =~ \.mjs$ ]]; then
    MIGRATION_ISSUES=$(check_migration_immutable "$FILE_PATH" "$TOOL_NAME")
    ISSUES+="$MIGRATION_ISSUES"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TYPESCRIPT CHECKS (only for .ts/.tsx files, not .d.ts)
# ═══════════════════════════════════════════════════════════════════════════════
if [[ "$FILE_PATH" =~ \.(ts|tsx)$ ]] && [[ ! "$FILE_PATH" =~ \.d\.ts$ ]]; then

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: Pino import in apps/ (should use createAppLogger)
    # ─────────────────────────────────────────────────────────────────────────────
    PINO_ISSUES=$(check_pino_import "$FILE_PATH")
    ISSUES+="$PINO_ISSUES"

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: Raw reply.send() in routes (should use reply.ok/fail)
    # ─────────────────────────────────────────────────────────────────────────────
    REPLY_ISSUES=$(check_reply_send "$FILE_PATH")
    ISSUES+="$REPLY_ISSUES"

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: v8 ignore comment added (write test first)
    # ─────────────────────────────────────────────────────────────────────────────
    V8_IGNORE_ISSUES=$(check_v8_ignore_added "$FILE_PATH" "$TOOL_NAME" "$INPUT")
    ISSUES+="$V8_IGNORE_ISSUES"

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: Import from local files without .js extension
    # ─────────────────────────────────────────────────────────────────────────────
    while IFS= read -r LINE_INFO; do
        [[ -z "$LINE_INFO" ]] && continue

        LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
        LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
        IMPORT_PATH=$(echo "$LINE_INFO" | sed -E "s/.*from ['\"]([^'\"]+)['\"].*/\1/")

        # Check for suppression comment
        if echo "$LINE_CONTENT" | grep -qE "@allow-missing-js" 2>/dev/null; then
            log_info "$HOOK_NAME" "suppressed-missing-js" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-missing-js"
            continue
        fi

        ISSUES+="missing-js-extension at $FILE_PATH:$LINE_NUM - from '$IMPORT_PATH' (add .js extension or suppress with // @allow-missing-js -- reason)\n"
        log_warned "$HOOK_NAME" "missing-js-extension" "$FILE_PATH" \
            "Line $LINE_NUM: from '$IMPORT_PATH'" \
            "Change to: from '$IMPORT_PATH.js'"
    done < <(grep -nE "from ['\"]\.\.?/[^'\"]+['\"]" "$FILE_PATH" 2>/dev/null | grep -vE "\.js['\"]" | grep -vE "\.json['\"]" || true)

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: | undefined in type annotation (should use ?: for optional)
    # ─────────────────────────────────────────────────────────────────────────────
    while IFS= read -r LINE_INFO; do
        [[ -z "$LINE_INFO" ]] && continue

        LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
        LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)
        PROP_NAME=$(echo "$LINE_INFO" | sed -E "s/^\s*(\w+):.*/\1/")

        # Check for suppression comment
        if echo "$LINE_CONTENT" | grep -qE "@allow-undefined-type" 2>/dev/null; then
            log_info "$HOOK_NAME" "suppressed-undefined-type" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-undefined-type"
            continue
        fi

        ISSUES+="bad-undefined-type at $FILE_PATH:$LINE_NUM - '$PROP_NAME: Type | undefined' (use ?: instead or suppress with // @allow-undefined-type -- reason)\n"
        log_warned "$HOOK_NAME" "bad-undefined-type" "$FILE_PATH" \
            "Line $LINE_NUM: $PROP_NAME: Type | undefined" \
            "Use: $PROP_NAME?: Type instead"
    done < <(grep -nE "^\s+\w+:\s+\w+\s*\|\s*undefined" "$FILE_PATH" 2>/dev/null || true)

    # ─────────────────────────────────────────────────────────────────────────────
    # Check: Accessing .value on Result without checking .ok
    # ─────────────────────────────────────────────────────────────────────────────
    while IFS= read -r LINE_INFO; do
        [[ -z "$LINE_INFO" ]] && continue

        LINE_NUM=$(echo "$LINE_INFO" | cut -d: -f1)
        LINE_CONTENT=$(sed -n "${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)

        # Check for suppression comment
        if echo "$LINE_CONTENT" | grep -qE "@allow-result-access" 2>/dev/null; then
            log_info "$HOOK_NAME" "suppressed-result-access" "$FILE_PATH:$LINE_NUM" "Intentionally allowed via @allow-result-access"
            continue
        fi

        # Check if there's an .ok check in the same function context (simplified: same 30 lines)
        START=$((LINE_NUM - 15))
        [ "$START" -lt 1 ] && START=1
        CONTEXT=$(sed -n "${START},${LINE_NUM}p" "$FILE_PATH" 2>/dev/null || true)

        if ! echo "$CONTEXT" | grep -qE "\.ok\s*(===|!==|\)|\?|&&|\|\|)"; then
            ISSUES+="result-value-without-ok at $FILE_PATH:$LINE_NUM - accessing .value without .ok check (narrow Result first or suppress with // @allow-result-access -- reason)\n"
            log_warned "$HOOK_NAME" "result-value-without-ok" "$FILE_PATH" \
                "Line $LINE_NUM: $(echo "$LINE_CONTENT" | xargs)" \
                "Narrow Result type before accessing .value: if (!result.ok) return result;"
        fi
    done < <(grep -nE "result\w*\.value" "$FILE_PATH" 2>/dev/null || true)

fi  # End TypeScript checks

# ═══════════════════════════════════════════════════════════════════════════════
# OUTPUT RESULTS
# ═══════════════════════════════════════════════════════════════════════════════
if [ -n "$ISSUES" ]; then
    # Output to stderr for visibility
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
