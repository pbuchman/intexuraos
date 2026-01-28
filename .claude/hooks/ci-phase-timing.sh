#!/bin/bash
# LOG: Extract per-phase CI timing from ci:tracked output
# Exit 0 = always allow (observational hook)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOG_FILE="${SCRIPT_DIR}/ci-phases.log"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[[ "$COMMAND" != *"ci:tracked"* ]] && exit 0

TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_result // ""')
[[ -z "$TOOL_OUTPUT" ]] && exit 0

PHASE_TIMINGS=$(echo "$TOOL_OUTPUT" | grep -o '@@PHASE_TIMING@@.*' || true)
[[ -z "$PHASE_TIMINGS" ]] && exit 0

BRANCH=$(cd "$PROJECT_DIR" && git branch --show-current 2>/dev/null || echo "unknown")

RUN_NUMBER=""
if [[ "$TOOL_OUTPUT" =~ CI\ Run\ \#([0-9]+) ]]; then
    RUN_NUMBER="${BASH_REMATCH[1]}"
fi

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

{
    echo "[${TIMESTAMP}] CI Run #${RUN_NUMBER} on ${BRANCH}"

    TOTAL_MS=0
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue

        PHASE_DATA="${line#@@PHASE_TIMING@@}"
        IFS='|' read -r NAME NUMBER STATUS DURATION_MS <<< "$PHASE_DATA"

        DURATION_SEC=$(echo "scale=1; $DURATION_MS / 1000" | bc)
        [[ "$DURATION_SEC" == .* ]] && DURATION_SEC="0${DURATION_SEC}"

        if [[ "$STATUS" == "pass" ]]; then
            STATUS_ICON="✓"
        else
            STATUS_ICON="✗ FAILED"
        fi

        printf "  Phase %s: %-20s %6ss  %s\n" "$NUMBER" "$NAME" "$DURATION_SEC" "$STATUS_ICON"

        TOTAL_MS=$((TOTAL_MS + DURATION_MS))
    done <<< "$PHASE_TIMINGS"

    TOTAL_SEC=$(echo "scale=1; $TOTAL_MS / 1000" | bc)
    [[ "$TOTAL_SEC" == .* ]] && TOTAL_SEC="0${TOTAL_SEC}"
    echo "  Total: ${TOTAL_SEC}s"
    echo ""
} >> "$LOG_FILE"

exit 0
