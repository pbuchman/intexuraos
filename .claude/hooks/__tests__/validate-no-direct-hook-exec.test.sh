#!/bin/bash
# Tests for validate-no-direct-hook-exec.sh hook
# Ensures hook scripts cannot be executed directly via Bash tool

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
HOOK_SCRIPT="$HOOKS_DIR/validate-no-direct-hook-exec.sh"

# Source test helpers
source "$SCRIPT_DIR/test-helpers.sh"

# Run hook with simulated Bash command
run_bash_hook() {
    local command="$1"

    local input
    input=$(cat <<EOF
{
    "tool_name": "Bash",
    "tool_input": {
        "command": "$command"
    }
}
EOF
)

    echo "$input" | "$HOOK_SCRIPT" 2>&1
    echo "EXIT:$?"
}

# ═══════════════════════════════════════════════════════════════════════════════
init_tests "validate-no-direct-hook-exec.sh"
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# BLOCK: Direct hook execution
# ─────────────────────────────────────────────────────────────────────────────

test_start "Blocks: bash .claude/hooks/detect-common-patterns.sh"
OUTPUT=$(run_bash_hook "bash .claude/hooks/detect-common-patterns.sh file.ts")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: bash with flags (bash -x)"
OUTPUT=$(run_bash_hook "bash -x .claude/hooks/detect-common-patterns.sh file.ts 2>&1")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: sh instead of bash"
OUTPUT=$(run_bash_hook "sh .claude/hooks/validate-polling.sh")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: source command"
OUTPUT=$(run_bash_hook "source .claude/hooks/validate-polling.sh")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: dot-source command"
OUTPUT=$(run_bash_hook ". .claude/hooks/validate-polling.sh")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: chained after &&"
OUTPUT=$(run_bash_hook "echo test && bash .claude/hooks/detect-common-patterns.sh file.ts")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: chained after ;"
OUTPUT=$(run_bash_hook "echo test; bash .claude/hooks/detect-common-patterns.sh file.ts")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: piped execution"
OUTPUT=$(run_bash_hook "echo test | bash .claude/hooks/detect-common-patterns.sh")
assert_contains "$OUTPUT" "BLOCKED"

test_start "Blocks: absolute path to hook"
OUTPUT=$(run_bash_hook "bash /home/user/project/.claude/hooks/detect-common-patterns.sh file.ts")
assert_contains "$OUTPUT" "BLOCKED"

# ─────────────────────────────────────────────────────────────────────────────
# ALLOW: Non-execution commands referencing hooks
# ─────────────────────────────────────────────────────────────────────────────

test_start "Allows: normal pnpm commands"
OUTPUT=$(run_bash_hook "pnpm run test")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: cat (reading) hook files"
OUTPUT=$(run_bash_hook "cat .claude/hooks/detect-common-patterns.sh")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: ls hook directory"
OUTPUT=$(run_bash_hook "ls -la .claude/hooks/")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: cp hook files"
OUTPUT=$(run_bash_hook "cp .claude/hooks/detect-common-patterns.sh /tmp/backup.sh")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: grep inside hook files"
OUTPUT=$(run_bash_hook "grep -n INPUT .claude/hooks/detect-common-patterns.sh")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: git diff on hook files"
OUTPUT=$(run_bash_hook "git diff .claude/hooks/detect-common-patterns.sh")
assert_not_contains "$OUTPUT" "BLOCKED"

# ─────────────────────────────────────────────────────────────────────────────
# ALLOW: Commands not involving hooks at all
# ─────────────────────────────────────────────────────────────────────────────

test_start "Allows: git status"
OUTPUT=$(run_bash_hook "git status")
assert_not_contains "$OUTPUT" "BLOCKED"

test_start "Allows: pnpm build"
OUTPUT=$(run_bash_hook "pnpm build")
assert_not_contains "$OUTPUT" "BLOCKED"

# ─────────────────────────────────────────────────────────────────────────────
# Exit code verification
# ─────────────────────────────────────────────────────────────────────────────

test_start "Exit code 2 when blocked"
OUTPUT=$(run_bash_hook "bash .claude/hooks/detect-common-patterns.sh file.ts")
assert_contains "$OUTPUT" "EXIT:2"

test_start "Exit code 0 when allowed"
OUTPUT=$(run_bash_hook "pnpm run test")
assert_contains "$OUTPUT" "EXIT:0"

# ═══════════════════════════════════════════════════════════════════════════════
print_summary
