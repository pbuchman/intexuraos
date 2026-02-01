#!/bin/bash

# Ownership Violation Detector
# Checks Claude's response for forbidden ownership-deflecting language
# Forces Claude to rephrase if detected

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# IMPORTANT: Associative array declarations must come before set -u
# because bash with set -u parses ["key"] as potential ${key-...} expansion
declare -A PATTERNS=(
  ["pre_existing"]="pre-existing condition/issue language"
  ["already_broken"]="deflecting blame to prior state"
  ["legacy_issue"]="deflecting to legacy as excuse"
  ["ci_should_pass"]="assuming CI passes without verification"
)

declare -A SEARCH_PATTERNS=(
  ["pre_existing"]="pre-existing"
  ["already_broken"]="already broken"
  ["legacy_issue"]="legacy issue"
  ["ci_should_pass"]="CI should now pass"
)

# Now enable strict mode after declarations
set -euo pipefail

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
done

exit 0
