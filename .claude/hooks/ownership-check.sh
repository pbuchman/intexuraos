#!/bin/bash

# Ownership Violation Detector
# Checks Claude's response for forbidden ownership-deflecting language
# Forces Claude to rephrase if detected

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="ownership-check"

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Get text content from the last assistant message
# Extract .text and .thinking from ALL content blocks to catch
# patterns in thinking blocks (.thinking field) and text blocks (.text field)
LAST_RESPONSE=$(jq -rs '
  [.[] | select(.type == "assistant")] | last |
  .message.content // [] |
  map(.text // .thinking // empty) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null)

if [[ -z "$LAST_RESPONSE" ]]; then
  exit 0
fi

# Check each pattern (avoiding associative arrays for Bash 3.2 compatibility)
check_pattern() {
  local pattern="$1"
  local description="$2"

  if echo "$LAST_RESPONSE" | grep -iqE "$pattern"; then
    # Skip false positives: pattern inside backticks (code/discussion)
    if echo "$LAST_RESPONSE" | grep -qE "\`[^\`]*${pattern}[^\`]*\`"; then
      return 1
    fi

    # Log the ownership violation
    log_blocked "$HOOK_NAME" "ownership-violation" \
        "Used forbidden language: '$pattern'" \
        "See CLAUDE.md: Ownership Mindset (MANDATORY)"

    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: You used '$pattern' in your response. This violates the Ownership Mindset rules in CLAUDE.md. Please acknowledge this warning and rephrase without ownership-deflecting language. See: Ownership Mindset (MANDATORY) section."
}
EOF
    exit 0
  fi
  return 1
}

check_pattern "pre-existing" "pre-existing condition/issue language" || true
check_pattern "already broken" "deflecting blame to prior state" || true
check_pattern "legacy issue" "deflecting to legacy as excuse" || true
check_pattern "CI should now pass" "assuming CI passes without verification" || true

exit 0
