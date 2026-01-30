#!/bin/bash

# Ownership Violation Detector
# Checks Claude's response for forbidden ownership-deflecting language
# Forces Claude to rephrase if detected

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Get text content from the last assistant message
# Content is an array of blocks - extract only text blocks
LAST_RESPONSE=$(jq -rs '
  [.[] | select(.type == "assistant")] | last |
  .message.content // [] |
  map(select(.type == "text") | .text) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null)

if [[ -z "$LAST_RESPONSE" ]]; then
  exit 0
fi

# Check for "pre-existing" (ownership-deflecting language)
if echo "$LAST_RESPONSE" | grep -iq "pre-existing"; then
  cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: You used 'pre-existing' in your response. This violates the Ownership Mindset rules in CLAUDE.md. Please acknowledge this warning and rephrase without ownership-deflecting language. See: Ownership Mindset (MANDATORY) section."
}
EOF
  exit 0
fi

exit 0
