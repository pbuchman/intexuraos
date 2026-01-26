#!/bin/bash
# LOG: Record Bash command end time and calculate duration
# Exit 0 = always allow (this is observational, not blocking)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="/tmp/claude-cmd-timing"
LOG_FILE="${SCRIPT_DIR}/commands.log"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[[ -z "$COMMAND" ]] && exit 0

# Get high-precision timestamp (macOS compatible)
if command -v gdate &>/dev/null; then
    TIMESTAMP_NANO=$(gdate +%s%N)
    TIMESTAMP_ISO=$(gdate -u +%Y-%m-%dT%H:%M:%S.%3NZ)
elif [[ "$(uname)" == "Darwin" ]]; then
    TIMESTAMP_NANO=$(python3 -c 'import time; print(int(time.time() * 1000000000))')
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
else
    TIMESTAMP_NANO=$(date +%s%N)
    TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
fi

# Find the correlation ID from the pending file (FIFO: use oldest/first entry)
COMMAND_ONLY_HASH=$(echo -n "$COMMAND" | md5 | cut -c1-12)
PENDING_FILE="${TEMP_DIR}/${COMMAND_ONLY_HASH}.pending"

DURATION_SEC="?"

if [[ -f "$PENDING_FILE" ]]; then
    CMD_HASH=$(head -n1 "$PENDING_FILE")

    # Remove entry from pending (FIFO)
    tail -n +2 "$PENDING_FILE" > "${PENDING_FILE}.tmp" 2>/dev/null && \
        mv "${PENDING_FILE}.tmp" "$PENDING_FILE" || \
        rm -f "$PENDING_FILE"
    [[ -f "$PENDING_FILE" && ! -s "$PENDING_FILE" ]] && rm -f "$PENDING_FILE"

    # Calculate duration
    START_FILE="${TEMP_DIR}/${CMD_HASH}.start"
    if [[ -f "$START_FILE" ]]; then
        START_NANO=$(cat "$START_FILE")
        DURATION_NANO=$((TIMESTAMP_NANO - START_NANO))
        DURATION_SEC=$(echo "scale=1; $DURATION_NANO / 1000000000" | bc)
        rm -f "$START_FILE"
    fi
fi

# Single-line log: [timestamp] duration command
echo "[${TIMESTAMP_ISO}] ${DURATION_SEC}s ${COMMAND}" >> "$LOG_FILE"

exit 0
