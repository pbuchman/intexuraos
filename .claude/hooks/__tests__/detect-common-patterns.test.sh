#!/bin/bash
# Tests for detect-common-patterns.sh hook
# Tests pattern detection, escape hatches, and scope rules

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$HOOKS_DIR/../.." && pwd)"
HOOK_SCRIPT="$HOOKS_DIR/detect-common-patterns.sh"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

# Source test helpers
source "$SCRIPT_DIR/test-helpers.sh"

# Create test directories IN the repo (paths must match scope checks like apps/...)
# Use a hidden test service to avoid conflicts
TEST_APP_DIR="$REPO_ROOT/apps/.test-hook-service"
TEST_MIGRATION_DIR="$REPO_ROOT/migrations/.test-hooks"

cleanup_test_dirs() {
    rm -rf "$TEST_APP_DIR" "$TEST_MIGRATION_DIR" 2>/dev/null || true
}

trap cleanup_test_dirs EXIT

setup_temp_apps() {
    cleanup_test_dirs
    mkdir -p "$TEST_APP_DIR/src/routes"
    mkdir -p "$TEST_APP_DIR/src/infra"
    mkdir -p "$TEST_APP_DIR/src/__tests__"
    mkdir -p "$TEST_MIGRATION_DIR"
}

# Run hook with simulated input
run_hook_on_file() {
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

    echo "$input" | "$HOOK_SCRIPT" 2>&1 || true
}

# ═══════════════════════════════════════════════════════════════════════════════
init_tests "detect-common-patterns.sh"
# ═══════════════════════════════════════════════════════════════════════════════

setup_temp_apps

# ─────────────────────────────────────────────────────────────────────────────
# PINO IMPORT CHECKS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Pino import: blocks direct import in apps/"
cp "$FIXTURES_DIR/invalid/pino-import.ts" "$TEST_APP_DIR/src/infra/logger.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/infra/logger.ts")
assert_contains "$OUTPUT" "pino-import"

test_start "Pino import: allows type-only import"
cp "$FIXTURES_DIR/valid/pino-type-import.ts" "$TEST_APP_DIR/src/infra/types.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/infra/types.ts")
assert_not_contains "$OUTPUT" "pino-import"

test_start "Pino import: respects @allow-pino-import suppression"
cp "$FIXTURES_DIR/valid/pino-suppressed.ts" "$TEST_APP_DIR/src/infra/special.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/infra/special.ts")
assert_not_contains "$OUTPUT" "decision"

test_start "Pino import: skips test files"
cp "$FIXTURES_DIR/invalid/pino-import.ts" "$TEST_APP_DIR/src/__tests__/logger.test.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/__tests__/logger.test.ts")
assert_not_contains "$OUTPUT" "pino-import"

# ─────────────────────────────────────────────────────────────────────────────
# REPLY.SEND() CHECKS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Reply.send: blocks raw send in routes"
cp "$FIXTURES_DIR/invalid/reply-send.ts" "$TEST_APP_DIR/src/routes/handler.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/routes/handler.ts")
assert_contains "$OUTPUT" "reply-send"

test_start "Reply.send: allows reply.ok()"
cp "$FIXTURES_DIR/valid/reply-ok.ts" "$TEST_APP_DIR/src/routes/good.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/routes/good.ts")
assert_not_contains "$OUTPUT" "reply-send"

test_start "Reply.send: allows 204 status"
cp "$FIXTURES_DIR/valid/reply-204.ts" "$TEST_APP_DIR/src/routes/delete.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/routes/delete.ts")
assert_not_contains "$OUTPUT" "reply-send"

test_start "Reply.send: respects @allow-raw-send suppression"
cp "$FIXTURES_DIR/valid/reply-suppressed.ts" "$TEST_APP_DIR/src/routes/webhook.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/routes/webhook.ts")
assert_not_contains "$OUTPUT" "decision"

test_start "Reply.send: skips non-route files"
cp "$FIXTURES_DIR/invalid/reply-send.ts" "$TEST_APP_DIR/src/infra/client.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/infra/client.ts")
assert_not_contains "$OUTPUT" "reply-send"

# ─────────────────────────────────────────────────────────────────────────────
# MISSING .JS EXTENSION CHECKS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Missing .js: blocks imports without extension"
cp "$FIXTURES_DIR/invalid/missing-js.ts" "$TEST_APP_DIR/src/index.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/index.ts")
assert_contains "$OUTPUT" "missing-js-extension"

test_start "Missing .js: allows imports with .js extension"
cp "$FIXTURES_DIR/valid/with-js-extension.ts" "$TEST_APP_DIR/src/good.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/good.ts")
assert_not_contains "$OUTPUT" "missing-js-extension"

# ─────────────────────────────────────────────────────────────────────────────
# MIGRATION IMMUTABILITY CHECKS
# ─────────────────────────────────────────────────────────────────────────────

test_start "Migration: blocks Edit on existing migration"
echo "// existing migration" > "$TEST_MIGRATION_DIR/001-initial.mjs"
OUTPUT=$(run_hook_on_file "Edit" "$TEST_MIGRATION_DIR/001-initial.mjs")
assert_contains "$OUTPUT" "migration-immutable"

test_start "Migration: blocks Write (overwrite) on existing migration"
echo "// existing migration" > "$TEST_MIGRATION_DIR/002-users.mjs"
OUTPUT=$(run_hook_on_file "Write" "$TEST_MIGRATION_DIR/002-users.mjs")
assert_contains "$OUTPUT" "migration-immutable"

test_start "Migration: allows Write on new migration file"
rm -f "$TEST_MIGRATION_DIR/003-new.mjs"
OUTPUT=$(run_hook_on_file "Write" "$TEST_MIGRATION_DIR/003-new.mjs")
assert_not_contains "$OUTPUT" "migration-immutable"

# ─────────────────────────────────────────────────────────────────────────────
# SCOPE AND EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

test_start "Scope: skips non-Edit/Write tools"
INPUT='{"tool_name": "Read", "tool_input": {"file_path": "test.ts"}}'
OUTPUT=$(echo "$INPUT" | "$HOOK_SCRIPT" 2>&1 || true)
assert_not_contains "$OUTPUT" "decision"

test_start "Scope: skips .d.ts files"
echo "declare const x: any;" > "$TEST_APP_DIR/src/types.d.ts"
OUTPUT=$(run_hook_on_file "Write" "$TEST_APP_DIR/src/types.d.ts")
assert_not_contains "$OUTPUT" "decision"

test_start "Scope: skips fixture files in __tests__/fixtures/"
OUTPUT=$(run_hook_on_file "Write" "$REPO_ROOT/.claude/hooks/__tests__/fixtures/invalid/pino-import.ts")
assert_not_contains "$OUTPUT" "decision"

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

print_summary
