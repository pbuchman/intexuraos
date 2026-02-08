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

# Get text content from the CURRENT assistant message only
# Checking only the latest message avoids re-flagging violations from previous turns
# which would create an infinite loop once a violation is triggered.
# NOTE: Use -s (slurp) because transcripts are JSONL format (one object per line).
RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")] | .[-1] |
  .message.content // [] | map(.text // .thinking // empty) | join("\n")
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

        # Log each ownership violation
        log_blocked "$HOOK_NAME" "ownership-violation" \
            "Used forbidden language: '$pattern' ($description)" \
            "State ownership explicitly with action"

        # Collect violation for final message
        VIOLATIONS+="• '$pattern' ($description)\n"
        break  # Only count each pattern once
      fi
    done <<< "$RECENT_RESPONSES"
  fi
}

check_pattern "pre-existing" "deflecting to prior state"
check_pattern "already broken" "deflecting blame to prior state"
check_pattern "legacy issue" "deflecting to legacy as excuse"
check_pattern "CI should now pass" "assuming CI passes without verification"

# Output all violations at once
if [[ -n "$VIOLATIONS" ]]; then
  cat << EOF
{
  "decision": "block",
  "reason": "⚠️ OWNERSHIP CHECK: Your response contains ownership-deflecting language:\n${VIOLATIONS}\nTo continue, you MUST:\n1. Acknowledge the issue: 'I own [specific problem]'\n2. State your action: '[What I will do to fix it]'\n\nExample: 'I own the failing tests in auth-service. Fixing them now.'\n\nSee CLAUDE.md: Ownership Mindset (MANDATORY) section."
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
