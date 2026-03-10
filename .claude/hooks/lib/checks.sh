#!/bin/bash
# Shared check functions for detect-common-patterns.sh
# Each function returns issues found (empty = no issues)

# Check for direct pino import in apps/ (should use createAppLogger)
# Args: $1 = file_path, $2 = file_content
# Returns: issue string or empty
check_pino_import() {
    local file_path="$1"
    local hook_name="detect-common-patterns"

    # Only check apps/ source files (not tests, not server.ts)
    [[ ! "$file_path" =~ ^apps/ ]] && return 0
    [[ "$file_path" =~ /__tests__/ ]] && return 0
    [[ "$file_path" =~ /server\.ts$ ]] && return 0
    [[ "$file_path" =~ \.test\.ts$ ]] && return 0

    local issues=""

    while IFS= read -r line_info; do
        [[ -z "$line_info" ]] && continue

        local line_num
        line_num=$(echo "$line_info" | cut -d: -f1)
        local line_content
        line_content=$(sed -n "${line_num}p" "$file_path" 2>/dev/null || true)

        # Skip type-only imports (import type { Logger } from 'pino' is OK)
        if echo "$line_content" | grep -qE "import\s+type\s+"; then
            continue
        fi

        # Check for suppression (on same line or previous line)
        if echo "$line_content" | grep -qE "@allow-pino-import"; then
            log_info "$hook_name" "suppressed-pino-import" "$file_path:$line_num" "Allowed via @allow-pino-import"
            continue
        fi
        local prev_line
        prev_line=$(sed -n "$((line_num - 1))p" "$file_path" 2>/dev/null || true)
        if echo "$prev_line" | grep -qE "@allow-pino-import"; then
            log_info "$hook_name" "suppressed-pino-import" "$file_path:$line_num" "Allowed via @allow-pino-import on previous line"
            continue
        fi

        issues+="pino-import at $file_path:$line_num - Direct pino import forbidden in apps/ (use createAppLogger from @intexuraos/infra-sentry or suppress with // @allow-pino-import -- reason)\n"
        log_warned "$hook_name" "pino-import" "$file_path" \
            "Line $line_num: $(echo "$line_content" | xargs)" \
            "Use: import { createAppLogger } from '@intexuraos/infra-sentry'"
    done < <(grep -nE "import\s+.*\s+from\s+['\"]pino['\"]" "$file_path" 2>/dev/null || true)

    echo -e "$issues"
}

# Check for raw reply.send() in routes (should use reply.ok/fail)
# Args: $1 = file_path
# Returns: issue string or empty
check_reply_send() {
    local file_path="$1"
    local hook_name="detect-common-patterns"

    # Only check route files in apps/
    [[ ! "$file_path" =~ ^apps/.*/routes/.*\.ts$ ]] && return 0
    [[ "$file_path" =~ /__tests__/ ]] && return 0
    [[ "$file_path" =~ \.test\.ts$ ]] && return 0

    local issues=""

    while IFS= read -r line_info; do
        [[ -z "$line_info" ]] && continue

        local line_num
        line_num=$(echo "$line_info" | cut -d: -f1)
        local line_content
        line_content=$(sed -n "${line_num}p" "$file_path" 2>/dev/null || true)

        # Allow reply.status(204).send() - HTTP No Content
        if echo "$line_content" | grep -qE "\.status\s*\(\s*204\s*\)"; then
            continue
        fi

        # Allow empty send() - typically used with 204
        if echo "$line_content" | grep -qE "\.send\s*\(\s*\)"; then
            continue
        fi

        # Check for suppression
        if echo "$line_content" | grep -qE "@allow-raw-send"; then
            log_info "$hook_name" "suppressed-reply-send" "$file_path:$line_num" "Allowed via @allow-raw-send"
            continue
        fi

        # Check previous line for suppression too
        local prev_line
        prev_line=$(sed -n "$((line_num - 1))p" "$file_path" 2>/dev/null || true)
        if echo "$prev_line" | grep -qE "@allow-raw-send"; then
            log_info "$hook_name" "suppressed-reply-send" "$file_path:$line_num" "Allowed via @allow-raw-send on previous line"
            continue
        fi

        # Check previous 3 lines for status(204)
        local found_204=false
        for i in 1 2 3; do
            local check_line
            check_line=$(sed -n "$((line_num - i))p" "$file_path" 2>/dev/null || true)
            if echo "$check_line" | grep -qE "reply\.status\s*\(\s*204\s*\)"; then
                found_204=true
                break
            fi
        done
        [[ "$found_204" == "true" ]] && continue

        issues+="reply-send at $file_path:$line_num - Raw reply.send() forbidden in routes (use reply.ok(data) or reply.fail(code, msg) or suppress with // @allow-raw-send -- reason)\n"
        log_warned "$hook_name" "reply-send" "$file_path" \
            "Line $line_num: $(echo "$line_content" | xargs)" \
            "Use: reply.ok(data) or reply.fail(code, message)"
    done < <(grep -nE "reply\.send\s*\(" "$file_path" 2>/dev/null || true)

    echo -e "$issues"
}

# Check for modification of existing migration files
# Args: $1 = file_path, $2 = tool_name (Edit vs Write)
# Returns: issue string or empty
check_migration_immutable() {
    local file_path="$1"
    local tool_name="$2"
    local hook_name="detect-common-patterns"

    # Only check migrations directory
    [[ ! "$file_path" =~ ^migrations/.*\.mjs$ ]] && return 0
    # Skip test files
    [[ "$file_path" =~ /__tests__/ ]] && return 0

    # For Edit tool, the file must already exist - that's a modification
    if [[ "$tool_name" == "Edit" ]]; then
        local issues="migration-immutable at $file_path - Migrations are IMMUTABLE. Create a new migration file instead of modifying existing ones.\n"
        log_warned "$hook_name" "migration-immutable" "$file_path" \
            "Attempted to modify existing migration" \
            "Create a new migration file: migrations/NNN-description.mjs"
        echo -e "$issues"
        return 0
    fi

    # For Write tool, check if file already exists
    if [[ "$tool_name" == "Write" && -f "$file_path" ]]; then
        local issues="migration-immutable at $file_path - Migrations are IMMUTABLE. Create a new migration file instead of overwriting existing ones.\n"
        log_warned "$hook_name" "migration-immutable" "$file_path" \
            "Attempted to overwrite existing migration" \
            "Create a new migration file: migrations/NNN-description.mjs"
        echo -e "$issues"
    fi
}

# Check for v8 ignore comments being added (should write tests first)
# Args: $1 = file_path, $2 = tool_name, $3 = raw JSON input
# Returns: issue string or empty
check_v8_ignore_added() {
    local file_path="$1"
    local tool_name="$2"
    local raw_input="$3"
    local hook_name="detect-common-patterns"

    # Skip non-TypeScript files
    [[ ! "$file_path" =~ \.(ts|tsx)$ ]] && return 0
    # Skip type definitions
    [[ "$file_path" =~ \.d\.ts$ ]] && return 0
    # Skip test files
    [[ "$file_path" =~ \.test\.(ts|tsx)$ ]] && return 0
    [[ "$file_path" =~ /__tests__/ ]] && return 0
    # Skip skill files
    [[ "$file_path" =~ \.claude/skills/ ]] && return 0

    local content=""

    if [[ "$tool_name" == "Edit" ]]; then
        content=$(echo "$raw_input" | jq -r '.tool_input.new_string // ""')
    elif [[ "$tool_name" == "Write" ]]; then
        content=$(echo "$raw_input" | jq -r '.tool_input.content // ""')
    else
        return 0
    fi

    if echo "$content" | grep -q "v8 ignore"; then
        local issues=""

        # Extract explanation text (after "-- " category+colon and before " @preserve")
        local explanation
        explanation=$(echo "$content" | grep -o '\-\-[^@]*@preserve' | head -1 | sed 's/^--[[:space:]]*//' | sed 's/[[:space:]]*@preserve$//')
        # Strip category prefix (e.g., "ts-type: " or "test-infra: ")
        explanation=$(echo "$explanation" | sed 's/^[a-z-]*:[[:space:]]*//')

        # Check 1: Explanation too short (<20 chars)
        local explanation_len=${#explanation}
        if [[ -n "$explanation" ]] && [[ $explanation_len -lt 20 ]]; then
            issues+="v8-ignore-short-explanation at $file_path - Explanation too short (${explanation_len} chars, minimum 20). Name the BLOCKER, not just the code.\n"
            issues+="\n"
            issues+="  BAD:  'error handling'\n"
            issues+="  GOOD: 'FakeFirestore has no fault injection for subcollection queries'\n"

            log_warned "$hook_name" "v8-ignore-short-explanation" "$file_path" \
                "Explanation: '$explanation'" \
                "Name the specific blocker: which fake/mock/tool cannot produce the needed state?"

            echo -e "$issues"
            return 0
        fi

        # Check 2: Explanation describes code behavior, not testing blocker
        local bad_patterns=(
            "error handling"
            "error path"
            "conditional requires"
            "optional field check"
            "creates type narrowing"
            "type narrowing branch"
            "optional property check"
            "string literal comparison"
            "validation branch"
            "null check"
            "guard clause"
            "fallback value"
            "safety check"
            "defensive check"
        )

        local matched_bad=""
        for bad in "${bad_patterns[@]}"; do
            if echo "$explanation" | grep -qi "$bad"; then
                matched_bad="$bad"
                break
            fi
        done

        if [[ -n "$matched_bad" ]]; then
            issues+="v8-ignore-describes-code at $file_path - Explanation describes code ('$matched_bad') instead of naming the blocker.\n"
            issues+="\n"
            issues+="  BAD:  'error handling for database failures'\n"
            issues+="  GOOD: 'FakeFirestore has no fault injection for subcollection queries'\n"
            issues+="\n"
            issues+="  Name the BLOCKER: which fake/mock/tool cannot produce the needed state?\n"
            issues+="  Use words like: cannot, unable, always returns, no support, does not expose\n"

            log_warned "$hook_name" "v8-ignore-describes-code" "$file_path" \
                "Explanation describes code: '$matched_bad'" \
                "Name the blocker instead. See .claude/reference/coverage-exemptions.md"

            echo -e "$issues"
            return 0
        fi

        # Check 3: Generic reminder (for explanations that pass checks 1 & 2)
        issues+="v8-ignore-added at $file_path - Adding v8 ignore comment. Did you write a test first?\n"
        issues+="\n"
        issues+="  REQUIRED WORKFLOW before using v8 ignore:\n"
        issues+="  1. Write a failing test that exercises this branch\n"
        issues+="  2. Confirm the branch is GENUINELY untestable (not just inconvenient)\n"
        issues+="  3. Verify the explanation names the BLOCKER, not the code\n"
        issues+="\n"
        issues+="  NEVER valid for v8 ignore: catch blocks, error paths, validation branches,\n"
        issues+="  conditional returns, if/else branches, default switch cases, null guards.\n"
        issues+="  These are ALL testable — mock the dependency or pass different input.\n"

        log_warned "$hook_name" "v8-ignore-added" "$file_path" \
            "v8 ignore comment being added" \
            "Write a test first, then add v8 ignore only if genuinely untestable"

        echo -e "$issues"
    fi
}
