#!/bin/bash
# Test helpers for hook testing
# Provides assertion functions and test utilities

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_TEST=""

# Initialize test suite
init_tests() {
    TESTS_RUN=0
    TESTS_PASSED=0
    TESTS_FAILED=0
    echo ""
    echo "━━━ Running: $1 ━━━"
    echo ""
}

# Start a test
test_start() {
    CURRENT_TEST="$1"
    TESTS_RUN=$((TESTS_RUN + 1))
}

# Assert that command exits with expected code
assert_exit_code() {
    local expected="$1"
    local actual="$2"

    if [[ "$actual" == "$expected" ]]; then
        echo -e "  ${GREEN}✓${NC} $CURRENT_TEST"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $CURRENT_TEST"
        echo -e "    Expected exit code: $expected, got: $actual"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Assert that output contains expected string
assert_contains() {
    local output="$1"
    local expected="$2"

    if echo "$output" | grep -q "$expected"; then
        echo -e "  ${GREEN}✓${NC} $CURRENT_TEST"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $CURRENT_TEST"
        echo -e "    Expected output to contain: $expected"
        echo -e "    Got: ${output:0:200}..."
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Assert that output does NOT contain string
assert_not_contains() {
    local output="$1"
    local unexpected="$2"

    if ! echo "$output" | grep -q "$unexpected"; then
        echo -e "  ${GREEN}✓${NC} $CURRENT_TEST"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $CURRENT_TEST"
        echo -e "    Expected output NOT to contain: $unexpected"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Assert that JSON output has decision=block
assert_blocked() {
    local output="$1"

    if echo "$output" | grep -q '"decision": "block"'; then
        echo -e "  ${GREEN}✓${NC} $CURRENT_TEST"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $CURRENT_TEST"
        echo -e "    Expected JSON block decision"
        echo -e "    Got: ${output:0:200}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Assert that command produces no block (passes)
assert_not_blocked() {
    local output="$1"

    if ! echo "$output" | grep -q '"decision": "block"'; then
        echo -e "  ${GREEN}✓${NC} $CURRENT_TEST"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${RED}✗${NC} $CURRENT_TEST"
        echo -e "    Expected NO block, but got blocked"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Create a temporary test file
create_temp_file() {
    local path="$1"
    local content="$2"

    mkdir -p "$(dirname "$path")"
    echo "$content" > "$path"
}

# Clean up temporary test files
cleanup_temp_files() {
    local dir="$1"
    rm -rf "$dir"
}

# Run hook with simulated input
run_hook() {
    local hook_script="$1"
    local tool_name="$2"
    local file_path="$3"

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

    echo "$input" | "$hook_script" 2>&1
}

# Print test summary
print_summary() {
    echo ""
    echo "━━━ Summary ━━━"
    echo -e "  Total:  $TESTS_RUN"
    echo -e "  ${GREEN}Passed${NC}: $TESTS_PASSED"
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo -e "  ${RED}Failed${NC}: $TESTS_FAILED"
    else
        echo -e "  Failed: 0"
    fi
    echo ""

    if [[ $TESTS_FAILED -gt 0 ]]; then
        return 1
    fi
    return 0
}
