#!/bin/bash

# Evidence Check Detector
# Checks Claude's response for speculative/unverified language
# Forces Claude to either provide proof or rephrase with "I haven't verified yet"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="evidence-check"
START_TIME=$(date +%s%N 2>/dev/null || date +%s)

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# WORKAROUND: Brief delay to ensure transcript file is fully written to disk.
# Stop hooks can trigger before the filesystem flush completes (race condition).
sleep 0.1

# Get text content from the CURRENT assistant message only
# Checking only the latest message avoids re-flagging violations from previous turns
# which would create an infinite loop once a violation is triggered.
# NOTE: Use -s (slurp) because transcripts are JSONL format (one object per line).
RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")]
  | map(select(.message.content[]? | .type == "text"))
  | .[-1]
  | .message.content // [] | map(select(.type == "text") | .text) | join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$RECENT_RESPONSES" ]]; then
  exit 0
fi

# Collect all violations (avoiding associative arrays for Bash 3.2 compatibility)
VIOLATIONS=""

check_pattern() {
  local pattern="$1"
  local description="$2"

  if echo "$RECENT_RESPONSES" | grep -iqE "$pattern"; then
    # Strip fenced code blocks (``` ... ```) before checking
    local stripped
    stripped=$(echo "$RECENT_RESPONSES" | sed '/^```/,/^```/d')

    # Check remaining text line by line
    local found_violation=false
    while IFS= read -r line; do
      if echo "$line" | grep -iqE "$pattern"; then
        # Skip if pattern is inside inline backticks on this line
        local no_backticks
        no_backticks=$(echo "$line" | sed 's/`[^`]*`//g')
        if echo "$no_backticks" | grep -iqE "$pattern"; then
          found_violation=true
          break
        fi
      fi
    done <<< "$stripped"

    if [[ "$found_violation" == "true" ]]; then
      log_blocked "$HOOK_NAME" "evidence-violation" \
          "Used speculative language: '$pattern' ($description)" \
          "Provide evidence or say 'I haven't verified yet'"

      VIOLATIONS+="• '$pattern' ($description)\n"
    fi
  fi
}

check_pattern "likely" "speculative without evidence"
check_pattern "should work" "assuming without verification — prove it works, don't guess"
check_pattern "probably" "speculative without evidence"

# Output all violations at once
if [[ -n "$VIOLATIONS" ]]; then
  cat << EOF
{
  "decision": "block",
  "reason": "⚠️ EVIDENCE CHECK: Your response contains speculative/unverified language:\n${VIOLATIONS}\nThe 'Evidence Before Assertions' rule requires proof for every claim. No proof = no claim.\n\nTo continue, you MUST either:\n1. Provide evidence: Run a command, show output, cite a file\n2. Rephrase honestly: 'I haven't verified yet, but my hypothesis is...'\n\nSee CLAUDE.md: Evidence Before Assertions section.\nWRONG: [make change] → 'This should work now.'\nRIGHT: [make change] → [run test] → 'Verified: [exact output]'"
}
EOF

  # Log duration
  END_TIME=$(date +%s%N 2>/dev/null || date +%s)
  if [[ "$START_TIME" =~ ^[0-9]+$ ]] && [[ "$END_TIME" =~ ^[0-9]+$ ]] && [[ ${#START_TIME} -gt 10 ]]; then
    DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))
    log_info "$HOOK_NAME" "timing" "Hook completed in ${DURATION_MS}ms (blocked)"
  fi
  exit 0
fi

# Always log completion (sentinel for container lifecycle management)
log_info "$HOOK_NAME" "completed" "Hook completed (allowed)"

exit 0
