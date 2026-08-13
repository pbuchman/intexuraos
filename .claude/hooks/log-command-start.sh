#!/bin/bash
# LOG: Record Bash command start time for duration tracking
# Exit 0 = always allow (this is observational, not blocking)

set -euo pipefail
umask 077

TEMP_DIR="${CLAUDE_CMD_TIMING_DIR:-/tmp/claude-cmd-timing}"

mkdir -p "$TEMP_DIR"
chmod 700 "$TEMP_DIR"

hash_command() {
    if command -v sha256sum &>/dev/null; then
        printf '%s' "$1" | sha256sum | awk '{print substr($1, 1, 12)}'
    elif command -v shasum &>/dev/null; then
        printf '%s' "$1" | shasum -a 256 | awk '{print substr($1, 1, 12)}'
    elif command -v openssl &>/dev/null; then
        printf '%s' "$1" | openssl dgst -sha256 2>/dev/null | awk '{print substr($NF, 1, 12)}'
    else
        printf '%s' "$1" | cksum | awk '{print substr($1, 1, 12)}'
    fi
}

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
# Hashes are correlation identifiers only; raw commands never leave hook memory.
CMD_HASH=$(hash_command "${COMMAND}${TIMESTAMP_NANO}")

# Store start time in temp file for PostToolUse correlation
# Use >> in case file already exists (shouldn't, but defensive)
echo "$TIMESTAMP_NANO" >> "${TEMP_DIR}/${CMD_HASH}.start"

# Store hash in pending file so PostToolUse can correlate
COMMAND_ONLY_HASH=$(hash_command "$COMMAND")
echo "$CMD_HASH" >> "${TEMP_DIR}/${COMMAND_ONLY_HASH}.pending"

exit 0
