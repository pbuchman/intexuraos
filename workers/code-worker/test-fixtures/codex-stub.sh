#!/bin/bash
# ==============================================================================
# Codex CLI Stub for E2E Testing
# ==============================================================================
# Simulates Codex CLI for E2E tests without making real API calls.
# Supports `codex exec` and `codex exec resume` subcommands.
# Streams output line-by-line to stdout (matching real Codex behavior).

set -euo pipefail

# Parse subcommand
SUBCOMMAND="${1:-}"
if [ "$SUBCOMMAND" != "exec" ]; then
  echo "[codex-stub] ERROR: Unknown subcommand '$SUBCOMMAND'" >&2
  exit 1
fi
shift

# Parse exec subcommand (optional "resume")
RESUME_MODE=false
if [ "${1:-}" = "resume" ]; then
  RESUME_MODE=true
  shift
fi

# Parse remaining flags
THREAD_ID=""
PROMPT_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox)
      shift
      ;;
    -c)
      shift 2 # skip flag + value
      ;;
    -)
      # Read prompt from stdin
      PROMPT_FILE="stdin"
      shift
      ;;
    *)
      # Remaining positional arg is thread ID
      THREAD_ID="$1"
      shift
      ;;
  esac
done

echo "[codex-stub] Started"
echo "[codex-stub] Mode: $(if $RESUME_MODE; then echo 'resume'; else echo 'exec'; fi)"
if [ -n "$THREAD_ID" ]; then
  echo "[codex-stub] Thread ID: $THREAD_ID"
fi

# Read and echo prompt from stdin (simulates streaming output)
if [ "$PROMPT_FILE" = "stdin" ]; then
  echo "[codex-stub] Reading prompt from stdin..."
  PROMPT_CONTENT=""
  while IFS= read -r line || [ -n "$line" ]; do
    PROMPT_CONTENT="${PROMPT_CONTENT}${line}
"
  done
  echo "[codex-stub] Prompt received ($(echo "$PROMPT_CONTENT" | wc -l) lines)"
fi

# Simulate streaming output (each line is emitted immediately)
echo "[codex-stub] Processing task..."
echo "[codex-stub] Task completed successfully"

# Exit with CODEX_STUB_EXIT_CODE if set (for exit code testing), default 0
exit "${CODEX_STUB_EXIT_CODE:-0}"
