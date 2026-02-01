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
LAST_RESPONSE=$(jq -rs '
  [.[] | select(.type == "assistant")] | last |
  .message.content // [] |
  map(select(.type == "text") | .text) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null)

if [[ -z "$LAST_RESPONSE" ]]; then
  exit 0
fi

# Forbidden ownership-deflecting patterns (keys are search patterns, values are descriptions)
# Use spaces instead of hyphens in keys to avoid bash variable expansion with set -u
declare -A PATTERNS=(
  ["pre existing"]="pre-existing condition/issue language"
  ["already broken"]="deflecting blame to prior state"
  ["legacy issue"]="deflecting to legacy as excuse"
  ["CI should now pass"]="assuming CI passes without verification"
)

# Map safe keys to actual search patterns (with hyphens)
declare -A SEARCH_PATTERNS=(
  ["pre existing"]="pre-existing|pre existing"
  ["already broken"]="already broken"
  ["legacy issue"]="legacy issue"
  ["CI should now pass"]="CI should now pass"
)

for key in "${!PATTERNS[@]}"; do
  pattern="${SEARCH_PATTERNS[$key]}"
  description="${PATTERNS[$key]}"

  # Check if pattern exists in response
  if echo "$LAST_RESPONSE" | grep -iqE "$pattern"; then
    # Skip false positives: pattern inside backticks (code/discussion)
    if echo "$LAST_RESPONSE" | grep -qE "\`[^\`]*${pattern}[^\`]*\`"; then
      continue
    fi

    # Log the ownership violation
    log_blocked "$HOOK_NAME" "ownership-violation" \
        "Used forbidden language: '$key'" \
        "See CLAUDE.md: Ownership Mindset (MANDATORY)"

    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: You used '$key' in your response. This violates the Ownership Mindset rules in CLAUDE.md. Please acknowledge this warning and rephrase without ownership-deflecting language. See: Ownership Mindset (MANDATORY) section."
}
EOF
    exit 0
  fi
done

exit 0
