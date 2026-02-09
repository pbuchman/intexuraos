#!/bin/bash

# Completion Validator Hook (INT-522)
# Validates worker task completion artifacts via structured ---COMPLETION--- block.
#
# Detection: Uses CLAUDE_WORKER_MODE env var (set by orchestrator docker-provider)
# No phase marker: skip validation (informational/utility tasks)
# Phase 1: Linear URL + Label (code-task or unclear). PR optional.
# Phase 2: PR URL + Linear URL + CI: passed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source shared logging library
# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="completion-validator"

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Only run in worker mode (env var set by orchestrator)
if [[ "${CLAUDE_WORKER_MODE:-}" != "1" ]]; then
  exit 0
fi

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

sleep 0.1

TRANSCRIPT=$(cat "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

# Detect phase from transcript
PHASE="unknown"
if echo "$TRANSCRIPT" | grep -q '\[PHASE:1\]'; then
  PHASE="1"
elif echo "$TRANSCRIPT" | grep -q '\[PHASE:2\]'; then
  PHASE="2"
fi

# Get recent assistant messages for validation
RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")] | .[-3:] |
  map(.message.content // [] | map(.text // empty) | join("\n")) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$RECENT_RESPONSES" ]]; then
  exit 0
fi

# No phase marker = informational task, allow stop without validation
if [[ "$PHASE" == "unknown" ]]; then
  log_info "$HOOK_NAME" "skipped" "No phase marker found, allowing stop"
  exit 0
fi

# Extract the ---COMPLETION--- block from recent responses
COMPLETION_BLOCK=$(echo "$RECENT_RESPONSES" | sed -n '/---COMPLETION---/,/---END---/p')

MISSING=()

if [[ -z "$COMPLETION_BLOCK" ]]; then
  MISSING+=("---COMPLETION--- block")
else
  # Linear URL is required in both phases
  if ! echo "$COMPLETION_BLOCK" | grep -qE '^Linear: https://linear\.app/'; then
    MISSING+=("Linear URL")
  fi

  if [[ "$PHASE" == "1" ]]; then
    # Phase 1: Label required
    if ! echo "$COMPLETION_BLOCK" | grep -qE '^Label: (code-task|unclear)$'; then
      MISSING+=("Label (code-task or unclear)")
    fi
  elif [[ "$PHASE" == "2" ]]; then
    # Phase 2: PR + CI required
    if ! echo "$COMPLETION_BLOCK" | grep -qE '^PR: https://github\.com/.+/pull/[0-9]+'; then
      MISSING+=("PR URL")
    fi
    if ! echo "$COMPLETION_BLOCK" | grep -qE '^CI: passed$'; then
      MISSING+=("CI: passed")
    fi
  fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  MISSING_STR=$(printf '%s, ' "${MISSING[@]}")
  MISSING_STR="${MISSING_STR%, }"

  log_blocked "$HOOK_NAME" "incomplete" \
      "Missing: ${MISSING_STR}" \
      "Phase ${PHASE} requires structured completion block"

  if [[ "$PHASE" == "1" ]]; then
    EXAMPLE="---COMPLETION---\nPhase: 1\nLinear: https://linear.app/intexura/issue/INT-XXX\nLabel: code-task\n---END---"
  else
    EXAMPLE="---COMPLETION---\nPhase: 2\nPR: https://github.com/intexura/intexuraos/pull/XXX\nLinear: https://linear.app/intexura/issue/INT-XXX\nCI: passed\n---END---"
  fi

  cat << EOF
{
  "decision": "block",
  "reason": "⚠️ COMPLETION INCOMPLETE (Phase ${PHASE}): Missing: ${MISSING_STR}.\n\nYour final message MUST contain this block:\n\n${EXAMPLE}\n\nPaste actual URLs, then try stopping again."
}
EOF
  exit 0
fi

# Sentinel for container lifecycle management
SENTINEL_FILE="${SCRIPT_DIR}/validation-passed"
log_info "$HOOK_NAME" "completed" "Hook completed (phase ${PHASE} allowed)"
echo "PASSED $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SENTINEL_FILE"

exit 0
