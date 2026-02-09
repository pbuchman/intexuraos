#!/bin/bash

# Completion Validator Hook (INT-522)
# Validates worker task completion artifacts.
#
# Detection: Uses CLAUDE_WORKER_MODE env var (set by orchestrator docker-provider)
# Phase 1: PR link + Linear link + label (code-task or unclear)
# Phase 2: PR link + Linear link

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

# Validation: check for explicit URLs and labels in recent responses
MISSING=()

# PR link is always required
if ! echo "$RECENT_RESPONSES" | grep -qE 'https://github\.com/[^/]+/[^/]+/pull/[0-9]+'; then
  MISSING+=("PR link (https://github.com/.../pull/NNN)")
fi

# Linear link is always required
if ! echo "$RECENT_RESPONSES" | grep -qE 'https://linear\.app/[^/]+/issue/INT-[0-9]+'; then
  MISSING+=("Linear link (https://linear.app/.../issue/INT-NNN)")
fi

# Phase 1 additionally requires a label mention
if [[ "$PHASE" == "1" ]]; then
  if ! echo "$RECENT_RESPONSES" | grep -qE '\bcode-task\b|\bunclear\b'; then
    MISSING+=("Label (code-task or unclear)")
  fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  MISSING_STR=$(printf '%s, ' "${MISSING[@]}")
  MISSING_STR="${MISSING_STR%, }"

  log_blocked "$HOOK_NAME" "incomplete" \
      "Missing: ${MISSING_STR}" \
      "Phase ${PHASE} requires all completion artifacts"

  LABEL_HINT=""
  if [[ "$PHASE" == "1" ]]; then
    LABEL_HINT="- Label: code-task or unclear\n"
  fi

  cat << EOF
{
  "decision": "block",
  "reason": "⚠️ COMPLETION INCOMPLETE (Phase ${PHASE}): Missing: ${MISSING_STR}.\n\nYour final message MUST contain:\n- PR: full GitHub PR URL\n- Linear: full Linear issue URL\n${LABEL_HINT}Paste the actual URLs, then try stopping again."
}
EOF
  exit 0
fi

# Sentinel for container lifecycle management
SENTINEL_FILE="${SCRIPT_DIR}/validation-passed"
log_info "$HOOK_NAME" "completed" "Hook completed (phase ${PHASE} allowed)"
echo "PASSED $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SENTINEL_FILE"

exit 0
