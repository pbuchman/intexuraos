#!/bin/bash

# Ownership Violation Detector
# Checks Claude's FINAL response for forbidden word: "pre-existing"

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Get ONLY the last assistant message (final response)
LAST_RESPONSE=$(jq -r '
  [.[] | select(.type == "assistant")] | last | .message.content // empty
' "$TRANSCRIPT_PATH" 2>/dev/null)

if [[ -z "$LAST_RESPONSE" ]]; then
  exit 0
fi

# Check for "pre-existing" (case-insensitive)
if echo "$LAST_RESPONSE" | grep -iq "pre-existing"; then
  cat << 'EOF'
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP VIOLATION: You said 'pre-existing'. You are WRONG.\n\nThis is YOUR problem now. Fix it.\n\nRequired loop:\n1. Investigate the reason for failure\n2. Implement the fix\n3. Run verification (pnpm run ci:tracked)\n4. If CI passes → done\n5. If CI fails → go to step 1\n\nDo not stop until CI passes."
}
EOF
  exit 0
fi

exit 0
