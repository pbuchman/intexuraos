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
START_TIME=$(date +%s%N 2>/dev/null || date +%s)

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# WORKAROUND: Brief delay to ensure transcript file is fully written to disk.
# Stop hooks can trigger before the filesystem flush completes (race condition).
# Ideally, Claude Code should either:
#   1. Pass response text directly in hook input, or
#   2. Ensure file is flushed before triggering Stop hooks
# See: https://github.com/anthropics/claude-code/issues/XXX (if filed)
sleep 0.1

# Get text content from RECENT assistant messages (last 2 to catch current turn)
# This addresses the issue where the "last" message might be a tool_use with no text.
# We check 2 recent messages to catch text while avoiding re-flagging old violations.
# NOTE: Use -s (slurp) because transcripts are JSONL format (one object per line).
RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")] | .[-2:] |
  map(.message.content // [] | map(.text // .thinking // empty) | join("\n")) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$RECENT_RESPONSES" ]]; then
  exit 0
fi

# Check each pattern (avoiding associative arrays for Bash 3.2 compatibility)
check_pattern() {
  local pattern="$1"
  local description="$2"

  if echo "$RECENT_RESPONSES" | grep -iqE "$pattern"; then
    # Skip false positives: pattern inside backticks (code/discussion)
    # Check if the pattern itself appears between backticks on the SAME line
    # This handles cases like: "The `config` file had issues" - only skips if
    # the pattern itself (not other words) is inside backticks
    while IFS= read -r line; do
      if echo "$line" | grep -iqE "$pattern"; then
        # Check if this specific line has the pattern inside backticks
        if echo "$line" | grep -qE "\`[^\`]*${pattern}[^\`]*\`"; then
          continue  # This line has pattern in backticks, check next line
        fi
        # Found pattern NOT in backticks - this is a violation

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
        # Log duration
        END_TIME=$(date +%s%N 2>/dev/null || date +%s)
        if [[ "$START_TIME" =~ ^[0-9]+$ ]] && [[ "$END_TIME" =~ ^[0-9]+$ ]]; then
          DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))
          log_info "$HOOK_NAME" "timing" "Hook completed in ${DURATION_MS}ms (blocked)"
        fi
        exit 0
      fi
    done <<< "$RECENT_RESPONSES"
    return 1
  fi
  return 1
}

check_pattern "pre-existing" "deflecting to prior state" || true
check_pattern "already broken" "deflecting blame to prior state" || true
check_pattern "legacy issue" "deflecting to legacy as excuse" || true
check_pattern "CI should now pass" "assuming CI passes without verification" || true

# Log successful completion with timing
END_TIME=$(date +%s%N 2>/dev/null || date +%s)
if [[ "$START_TIME" =~ ^[0-9]+$ ]] && [[ "$END_TIME" =~ ^[0-9]+$ ]] && [[ ${#START_TIME} -gt 10 ]]; then
  DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))
  log_info "$HOOK_NAME" "timing" "Hook completed in ${DURATION_MS}ms (allowed)"
fi

exit 0
