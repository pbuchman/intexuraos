#!/bin/bash
# LOG: Record Bash command start time for duration tracking
# Exit 0 = always allow (this is observational, not blocking)

set -euo pipefail

TEMP_DIR="/tmp/claude-cmd-timing"

mkdir -p "$TEMP_DIR"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[[ -z "$COMMAND" ]] && exit 0

# Generate unique ID: hash of command + nanosecond timestamp (or fallback)
# This prevents collision even for parallel identical commands
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
CMD_HASH=$(echo -n "${COMMAND}${TIMESTAMP_NANO}" | md5 | cut -c1-12)

# Store start time in temp file for PostToolUse correlation
echo "$TIMESTAMP_NANO" > "${TEMP_DIR}/${CMD_HASH}.start"

# Store hash in pending file so PostToolUse can correlate
COMMAND_ONLY_HASH=$(echo -n "$COMMAND" | md5 | cut -c1-12)
echo "$CMD_HASH" >> "${TEMP_DIR}/${COMMAND_ONLY_HASH}.pending"

exit 0
