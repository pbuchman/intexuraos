#!/usr/bin/env bash
#
# watch-ci.sh
# Watches CI checks on a PR until all complete, ignoring specified workflow
#
# Usage: ./watch-ci.sh <pr_number> [--ignore <workflow_name>]
#        Default ignore: zai-claude-code-review.yml
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
#   2 - Error (invalid input, API error, etc.)

set -euo pipefail

PR_NUMBER="${1:-}"
IGNORE_WORKFLOW="zai-claude-code-review.yml"

# Parse arguments
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ignore)
      IGNORE_WORKFLOW="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PR_NUMBER" ]]; then
  echo "Usage: $0 <pr_number> [--ignore <workflow_name>]" >&2
  exit 2
fi

echo "Watching CI for PR #$PR_NUMBER (ignoring: $IGNORE_WORKFLOW)"

# Poll interval in seconds
POLL_INTERVAL=30

# Maximum wait time (30 minutes)
MAX_WAIT=1800
ELAPSED=0

while true; do
  # Get all checks
  CHECKS=$(gh pr checks "$PR_NUMBER" --json name,state,conclusion,workflowName 2>/dev/null || echo "[]")

  if [[ "$CHECKS" == "[]" || -z "$CHECKS" ]]; then
    echo "No checks found yet, waiting..."
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
    if [[ $ELAPSED -ge $MAX_WAIT ]]; then
      echo "ERROR: Timeout waiting for checks" >&2
      exit 2
    fi
    continue
  fi

  # Filter out ignored workflow
  RELEVANT_CHECKS=$(echo "$CHECKS" | jq --arg ignore "$IGNORE_WORKFLOW" '
    [.[] | select(.workflowName != $ignore and .name != $ignore)]
  ')

  # Count by state
  PENDING=$(echo "$RELEVANT_CHECKS" | jq '[.[] | select(.state == "PENDING" or .state == "QUEUED" or .state == "IN_PROGRESS")] | length')
  FAILED=$(echo "$RELEVANT_CHECKS" | jq '[.[] | select(.conclusion == "FAILURE" or .conclusion == "CANCELLED" or .conclusion == "TIMED_OUT")] | length')
  PASSED=$(echo "$RELEVANT_CHECKS" | jq '[.[] | select(.conclusion == "SUCCESS" or .conclusion == "SKIPPED" or .conclusion == "NEUTRAL")] | length')
  TOTAL=$(echo "$RELEVANT_CHECKS" | jq 'length')

  echo "Checks: $PASSED passed, $FAILED failed, $PENDING pending (of $TOTAL total)"

  # If any failed and none pending, report failure
  if [[ "$PENDING" -eq 0 && "$FAILED" -gt 0 ]]; then
    echo ""
    echo "❌ CI Failed! Failed checks:"
    echo "$RELEVANT_CHECKS" | jq -r '
      .[] | select(.conclusion == "FAILURE" or .conclusion == "CANCELLED" or .conclusion == "TIMED_OUT") |
      "  - \(.name): \(.conclusion)"
    '
    exit 1
  fi

  # If all passed and none pending, success
  if [[ "$PENDING" -eq 0 && "$FAILED" -eq 0 ]]; then
    echo ""
    echo "✅ All CI checks passed!"
    exit 0
  fi

  # Still pending, wait
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "ERROR: Timeout waiting for checks to complete" >&2
    echo "Pending checks:"
    echo "$RELEVANT_CHECKS" | jq -r '
      .[] | select(.state == "PENDING" or .state == "QUEUED" or .state == "IN_PROGRESS") |
      "  - \(.name): \(.state)"
    '
    exit 2
  fi
done
