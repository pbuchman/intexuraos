#!/bin/bash
# LOG: Record Bash command end time and calculate duration
# Exit 0 = always allow (this is observational, not blocking)

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="${CLAUDE_CMD_TIMING_DIR:-/tmp/claude-cmd-timing}"
LOG_FILE="${SCRIPT_DIR}/commands.log"
SESSION_COMMANDS_FILE="${SCRIPT_DIR}/session-commands.log"

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

# Find the correlation ID from the pending file (FIFO: use oldest/first entry).
COMMAND_ONLY_HASH=$(hash_command "$COMMAND")
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
        # bc outputs ".4" instead of "0.4" for values < 1 - fix it
        [[ "$DURATION_SEC" == .* ]] && DURATION_SEC="0${DURATION_SEC}"
        rm -f "$START_FILE"
    fi
fi

# Commands frequently contain inline credentials or private paths. Persist only the one-way timing
# correlation hash; the raw command stays in the transient hook input and never reaches the log.
printf "[%s] %6s command_hash=%s\n" "$TIMESTAMP_ISO" "${DURATION_SEC}s" "$COMMAND_ONLY_HASH" >> "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

# Append to session log (atomic append, safe for concurrent hooks)
echo "1" >> "$SESSION_COMMANDS_FILE" 2>/dev/null || true
chmod 600 "$SESSION_COMMANDS_FILE" 2>/dev/null || true

exit 0
