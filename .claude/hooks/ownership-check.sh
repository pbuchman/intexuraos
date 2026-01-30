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

# Forbidden patterns that indicate ownership deflection
FORBIDDEN_PATTERNS=(
  "pre-existing"
  "not my fault"
  "not my responsibility"
  "unrelated to my changes"
  "was already broken"
  "legacy issue"
  "other services"
  "other workspaces"
  "my code passes"
  "my part passes"
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  if echo "$LAST_RESPONSE" | grep -iq "$pattern"; then
    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: You used '$pattern' in your response. This phrase deflects responsibility. Please acknowledge this warning and rephrase your previous response without ownership-deflecting language. Remember: discovery = ownership."
}
EOF
    exit 0
  fi
done

exit 0
