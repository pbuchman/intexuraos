#!/bin/bash
# PostToolUse hook to track when GLM-generated files are manually edited
# This helps measure the true quality of GLM output

HOOK_EVENT="$1"
TOOL_NAME="$2"
TOOL_INPUT="$3"

# Only track Edit and Write tools
if [[ "$TOOL_NAME" != "Edit" && "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

# Extract file path from tool input
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .filePath // ""' 2>/dev/null)

if [[ -z "$FILE_PATH" || "$FILE_PATH" == "null" ]]; then
  exit 0
fi

METRICS_DIR="$HOME/.glm-coder"
METRICS_FILE="$METRICS_DIR/metrics.jsonl"
POST_HOC_FILE="$METRICS_DIR/post-hoc.jsonl"

# Check if metrics file exists
if [[ ! -f "$METRICS_FILE" ]]; then
  exit 0
fi

# Look for recent GLM calls (last 5 minutes) that targeted this file
FIVE_MIN_AGO=$(date -v-5M +%Y-%m-%dT%H:%M 2>/dev/null || date -d '5 minutes ago' +%Y-%m-%dT%H:%M 2>/dev/null)

# Find matching GLM call IDs for this file
MATCHING_CALL=$(tail -20 "$METRICS_FILE" 2>/dev/null | \
  jq -r --arg file "$FILE_PATH" --arg since "$FIVE_MIN_AGO" \
  'select(.targetFile == $file and .timestamp >= $since) | .id' 2>/dev/null | \
  tail -1)

if [[ -n "$MATCHING_CALL" && "$MATCHING_CALL" != "null" ]]; then
  # Record that manual edits were made to GLM-generated code
  mkdir -p "$METRICS_DIR"

  EVENT=$(jq -n \
    --arg callId "$MATCHING_CALL" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg editedFile "$FILE_PATH" \
    '{callId: $callId, manualEditsRequired: true, timestamp: $timestamp, editedFile: $editedFile}')

  echo "$EVENT" >> "$POST_HOC_FILE"
  echo "[glm-tracker] Recorded manual edit for GLM call: $MATCHING_CALL" >&2
fi

exit 0
