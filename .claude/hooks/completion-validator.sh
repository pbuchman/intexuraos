#!/bin/bash

# Completion Validator Hook (INT-522)
# Validates worker task completion artifacts based on execution phase.
#
# Phase 1: Validates that code-task OR unclear label was added
# Phase 2: Validates PR, CI passed, and Linear update were mentioned
#
# Only runs in worker mode (detected via [WORKER-MODE] marker in transcript)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="completion-validator"
START_TIME=$(date +%s%N 2>/dev/null || date +%s)

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Canary: prove hook execution in Docker containers (stdout → log forwarder → /internal/logs)
echo "[HOOK-CANARY] completion-validator fired at $(date -u +%Y-%m-%dT%H:%M:%SZ) | transcript_path=${TRANSCRIPT_PATH:-none}"

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

# Brief delay to ensure transcript file is fully written (same as ownership-check.sh)
sleep 0.1

# Read full transcript content
TRANSCRIPT=$(cat "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

# Check for worker mode marker - skip if not in worker mode
if ! echo "$TRANSCRIPT" | grep -q '\[WORKER-MODE\]'; then
  # Interactive session, skip validation
  exit 0
fi

# Detect phase from transcript
PHASE=""
if echo "$TRANSCRIPT" | grep -q '\[PHASE:1\]'; then
  PHASE="1"
elif echo "$TRANSCRIPT" | grep -q '\[PHASE:2\]'; then
  PHASE="2"
fi

if [[ -z "$PHASE" ]]; then
  # No phase marker found, skip validation
  exit 0
fi

# Get recent assistant messages for validation
# Use jq to extract text content from last 3 assistant messages
RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")] | .[-3:] |
  map(.message.content // [] | map(.text // empty) | join("\n")) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$RECENT_RESPONSES" ]]; then
  exit 0
fi

# Validation functions
validate_phase1() {
  local missing=()

  # Check if code-task or unclear label was mentioned as added
  if ! echo "$RECENT_RESPONSES" | grep -iqE "(added|created|applied).*(code-task|unclear)|label.*(code-task|unclear)|(code-task|unclear).*label"; then
    # Also check for explicit label addition patterns
    if ! echo "$RECENT_RESPONSES" | grep -iqE "code-task.*added|unclear.*added|added.*code-task|added.*unclear"; then
      missing+=("Label (code-task OR unclear)")
    fi
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_blocked "$HOOK_NAME" "phase1-incomplete" \
        "Missing: ${missing[*]}" \
        "Phase 1 requires adding code-task or unclear label"

    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ PHASE 1 INCOMPLETE: You must add either 'code-task' or 'unclear' label to the Linear issue before stopping. Missing: ${missing[*]}. Use Linear MCP to add the appropriate label."
}
EOF
    return 1
  fi

  return 0
}

validate_phase2() {
  # PR link is the ONLY hard requirement enforced by hooks.
  # CI status and Linear updates are handled by webhooks between GitHub and Linear.
  if ! echo "$RECENT_RESPONSES" | grep -qE "https://github\.com/[^/]+/[^/]+/pull/[0-9]+"; then
    log_blocked "$HOOK_NAME" "phase2-no-pr-link" \
        "No GitHub PR link found in response" \
        "A PR link (https://github.com/.../pull/NNN) is ALWAYS required"

    cat << EOF
{
  "decision": "block",
  "reason": "⚠️ PR REQUIRED: You MUST include a GitHub PR link before finalizing. A pull request is ALWAYS required — no exceptions. Include the full URL (e.g. https://github.com/owner/repo/pull/123) in your response, then stop again."
}
EOF
    return 1
  fi

  return 0
}

# Execute phase-specific validation
VALIDATION_RESULT=0
if [[ "$PHASE" == "1" ]]; then
  validate_phase1 || VALIDATION_RESULT=1
elif [[ "$PHASE" == "2" ]]; then
  validate_phase2 || VALIDATION_RESULT=1
fi

# Always log completion (sentinel for container lifecycle management)
if [[ $VALIDATION_RESULT -eq 0 ]]; then
  log_info "$HOOK_NAME" "completed" "Hook completed (phase ${PHASE:-none} allowed)"
fi

exit 0
