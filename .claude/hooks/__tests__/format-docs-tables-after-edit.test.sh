#!/bin/bash
# Tests for format-docs-tables-after-edit.sh hook

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$HOOKS_DIR/../.." && pwd)"
HOOK_SCRIPT="$HOOKS_DIR/format-docs-tables-after-edit.sh"

# Source test helpers
source "$SCRIPT_DIR/test-helpers.sh"

# Run hook with simulated input, capture exit code
run_hook_with_code() {
    local tool_name="$1"
    local file_path="$2"

    cd "$REPO_ROOT"

    local input
    input=$(cat <<EOF
{
    "tool_name": "$tool_name",
    "tool_input": {
        "file_path": "$file_path"
    }
}
EOF
)

    local exit_code=0
    echo "$input" | "$HOOK_SCRIPT" 2>&1 || exit_code=$?
    echo "EXIT_CODE=$exit_code"
}

# ═══════════════════════════════════════════════════════════════════════════════
init_tests "format-docs-tables-after-edit.sh"
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# SKIP CONDITIONS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Skips non-Edit/Write tools (Read)"
OUTPUT=$(run_hook_with_code "Read" "docs/README.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Skips non-Edit/Write tools (Bash)"
OUTPUT=$(run_hook_with_code "Bash" "docs/README.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Skips empty file path"
INPUT='{"tool_name": "Edit", "tool_input": {}}'
EXIT_CODE=0
echo "$INPUT" | "$HOOK_SCRIPT" 2>&1 || EXIT_CODE=$?
assert_exit_code "0" "$EXIT_CODE"

test_start "Skips non-markdown files (.ts)"
OUTPUT=$(run_hook_with_code "Edit" "/home/user/project/apps/service/src/index.ts")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Skips non-markdown files (.json)"
OUTPUT=$(run_hook_with_code "Write" "/home/user/project/package.json")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Skips non-markdown files (.yml)"
OUTPUT=$(run_hook_with_code "Edit" "/home/user/project/.github/workflows/ci.yml")
assert_contains "$OUTPUT" "EXIT_CODE=0"

# ─────────────────────────────────────────────────────────────────────────────
# TRIGGER CONDITIONS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Runs on Edit to .md file (exit 0)"
OUTPUT=$(run_hook_with_code "Edit" "$REPO_ROOT/docs/README.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Runs on Write to .md file (exit 0)"
OUTPUT=$(run_hook_with_code "Write" "$REPO_ROOT/docs/README.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Runs on CLAUDE.md edit (exit 0)"
OUTPUT=$(run_hook_with_code "Edit" "$REPO_ROOT/.claude/CLAUDE.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

test_start "Runs on nested .md file (exit 0)"
OUTPUT=$(run_hook_with_code "Edit" "$REPO_ROOT/docs/patterns/response-contract.md")
assert_contains "$OUTPUT" "EXIT_CODE=0"

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

print_summary
