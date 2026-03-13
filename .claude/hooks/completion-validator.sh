#!/bin/bash

# Completion Validator Hook (INT-522)
# Validates worker phase-final contracts in the last assistant message.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

HOOK_NAME="completion-validator"

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Only run in worker mode (env var set by orchestrator docker-provider)
if [[ "${CLAUDE_WORKER_MODE:-}" != "1" ]]; then
  exit 0
fi

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  exit 0
fi

TRANSCRIPT=$(cat "$TRANSCRIPT_PATH" 2>/dev/null) || true
if [[ -z "$TRANSCRIPT" ]]; then
  exit 0
fi

PHASE="unknown"
if echo "$TRANSCRIPT" | grep -q '\[PHASE:1\]'; then
  PHASE="1"
elif echo "$TRANSCRIPT" | grep -q '\[PHASE:2\]'; then
  PHASE="2"
fi

# No phase marker = informational task, allow stop without validation
if [[ "$PHASE" == "unknown" ]]; then
  log_info "$HOOK_NAME" "skipped" "No phase marker found, allowing stop"
  exit 0
fi

RECENT_RESPONSES=$(jq -rs '
  [.[] | select(.type == "assistant")] | .[-4:] |
  map(.message.content // [] | map(.text // empty) | join("\n")) |
  join("\n")
' "$TRANSCRIPT_PATH" 2>/dev/null) || true

if [[ -z "$RECENT_RESPONSES" ]]; then
  exit 0
fi

MISSING=()

if [[ "$PHASE" == "1" ]]; then
  if ! echo "$RECENT_RESPONSES" | grep -q 'PHASE1_FINAL:'; then
    MISSING+=("PHASE1_FINAL block")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Linear label set: (code-task|unclear)$'; then
    MISSING+=("Linear label set line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Phase 2 ready: (yes|no)$'; then
    MISSING+=("Phase 2 ready line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Linear issue: https://linear\.app/.+'; then
    MISSING+=("Linear issue URL line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Summary: .+'; then
    MISSING+=("Summary line")
  fi

  LABEL=$(echo "$RECENT_RESPONSES" | sed -nE 's/^- Linear label set: (code-task|unclear)$/\1/p' | tail -n1)
  READY=$(echo "$RECENT_RESPONSES" | sed -nE 's/^- Phase 2 ready: (yes|no)$/\1/p' | tail -n1)

  if [[ "$LABEL" == "code-task" && "$READY" != "yes" ]]; then
    MISSING+=("code-task requires Phase 2 ready: yes")
  fi
  if [[ "$LABEL" == "unclear" && "$READY" != "no" ]]; then
    MISSING+=("unclear requires Phase 2 ready: no")
  fi
fi

if [[ "$PHASE" == "2" ]]; then
  if ! echo "$RECENT_RESPONSES" | grep -q 'PHASE2_FINAL:'; then
    MISSING+=("PHASE2_FINAL block")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- PR: https://github\.com/.+/pull/[0-9]+$'; then
    MISSING+=("PR URL line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- CI evidence: pnpm run ci:tracked successful$'; then
    MISSING+=("CI evidence line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Linear issue: https://linear\.app/.+'; then
    MISSING+=("Linear issue URL line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Review iterations: [0-9]+$'; then
    MISSING+=("Review iterations line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Turn summary: .+'; then
    MISSING+=("Turn summary line")
  fi

  if ! echo "$RECENT_RESPONSES" | grep -qE '^- Summary: .+'; then
    MISSING+=("Summary line")
  fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  MISSING_STR=$(printf '%s, ' "${MISSING[@]}")
  MISSING_STR="${MISSING_STR%, }"

  log_blocked "$HOOK_NAME" "incomplete" \
    "Missing: ${MISSING_STR}" \
    "Phase ${PHASE} final contract not met"

  if [[ "$PHASE" == "1" ]]; then
    EXAMPLE="PHASE1_FINAL:\n- Linear label set: code-task\n- Phase 2 ready: yes\n- Linear issue: https://linear.app/pbuchman/issue/INT-XXX\n- Summary: Prepared issue for phase 2"
  else
    EXAMPLE="PHASE2_FINAL:\n- PR: https://github.com/intexuraos/intexuraos/pull/XXX\n- CI evidence: pnpm run ci:tracked successful\n- Linear issue: https://linear.app/pbuchman/issue/INT-XXX\n- Review iterations: 2\n- Turn summary: Planned auth refactor | Wrote 8 tests | Implemented changes | Review clean after 2 iterations | PR ready\n- Summary: Implemented requested changes"
  fi

  cat << EOF2
{
  "decision": "block",
  "reason": "⚠️ COMPLETION INCOMPLETE (Phase ${PHASE}): Missing: ${MISSING_STR}.\\n\\nYour final message MUST contain this block:\\n\\n${EXAMPLE}"
}
EOF2
  exit 0
fi

SENTINEL_FILE="${SCRIPT_DIR}/validation-passed"
log_info "$HOOK_NAME" "completed" "Hook completed (phase ${PHASE} allowed)"
echo "PASSED $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SENTINEL_FILE"

exit 0
