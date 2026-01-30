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

# Forbidden ownership-deflecting patterns
FORBIDDEN_PATTERNS=(
  "pre-existing"
  "already broken"
  "legacy issue"
)

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  # Check if pattern exists in response
  if echo "$LAST_RESPONSE" | grep -iq "$pattern"; then
    # Skip false positives: pattern inside backticks (code/discussion)
    if echo "$LAST_RESPONSE" | grep -qE "\`[^\`]*${pattern}[^\`]*\`"; then
      continue
    fi
    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: You used '$pattern' in your response. This violates the Ownership Mindset rules in CLAUDE.md. Please acknowledge this warning and rephrase without ownership-deflecting language. See: Ownership Mindset (MANDATORY) section."
}
EOF
    exit 0
  fi
done

exit 0
