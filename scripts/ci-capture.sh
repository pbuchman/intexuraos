#!/bin/bash
# CI output capture with branch-safe naming
# Prevents collisions between parallel CI runs and enables output reuse

set -e

BRANCH=$(git branch --show-current | sed 's/\//-/g')
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT="/tmp/ci-output-${BRANCH}-${TIMESTAMP}.txt"

echo "Capturing CI output to: $OUTPUT"
echo ""

pnpm run ci:tracked 2>&1 | tee "$OUTPUT"
EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CI output captured to: $OUTPUT"
echo ""
echo "Reuse with grep (do NOT re-run CI):"
echo "  grep -E \"(error|Error|ERROR)\" /tmp/ci-output-${BRANCH}-*.txt"
echo "  grep -E \"FAIL\" /tmp/ci-output-${BRANCH}-*.txt"
echo "  grep -E \"Coverage for\" /tmp/ci-output-${BRANCH}-*.txt"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit $EXIT_CODE
