#!/bin/bash
# Hook test runner
# Runs all hook tests and reports results

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"

cd "$HOOKS_DIR/../.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo ""
echo "╔════════════════════════════════════════╗"
echo "║       Claude Hooks Test Suite          ║"
echo "╚════════════════════════════════════════╝"
echo ""

TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=0

# Run each test file
for test_file in "$SCRIPT_DIR"/*.test.sh; do
    [[ -f "$test_file" ]] || continue

    ((TOTAL_SUITES++)) || true

    if bash "$test_file"; then
        ((PASSED_SUITES++)) || true
    else
        ((FAILED_SUITES++)) || true
    fi
done

echo ""
echo "╔════════════════════════════════════════╗"
echo "║           Final Results                ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "  Test suites: $TOTAL_SUITES"
echo -e "  ${GREEN}Passed${NC}:       $PASSED_SUITES"
if [[ $FAILED_SUITES -gt 0 ]]; then
    echo -e "  ${RED}Failed${NC}:       $FAILED_SUITES"
    exit 1
else
    echo "  Failed:       0"
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
fi
