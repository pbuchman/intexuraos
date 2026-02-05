#!/usr/bin/env bash
#
# post-summary.sh
# Posts a summary comment to a PR with the nitpick-nuker results
#
# Usage: ./post-summary.sh <pr_number> <summary_json_file>
#
# The summary JSON file should have this structure:
# {
#   "pr_number": 123,
#   "timestamp": "2026-02-05T10:00:00Z",
#   "commit_sha": "abc1234",
#   "fixed": [
#     { "id": "...", "author": "...", "url": "...", "details": "..." }
#   ],
#   "skipped": [
#     { "id": "...", "author": "...", "url": "...", "reason": "..." }
#   ]
# }

set -euo pipefail

PR_NUMBER="${1:-}"
SUMMARY_FILE="${2:-}"

if [[ -z "$PR_NUMBER" || -z "$SUMMARY_FILE" ]]; then
  echo "Usage: $0 <pr_number> <summary_json_file>" >&2
  exit 1
fi

if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo "ERROR: Summary file not found: $SUMMARY_FILE" >&2
  exit 1
fi

# Read summary data
SUMMARY=$(cat "$SUMMARY_FILE")

# Extract values
TIMESTAMP=$(echo "$SUMMARY" | jq -r '.timestamp')
COMMIT_SHA=$(echo "$SUMMARY" | jq -r '.commit_sha')
FIXED=$(echo "$SUMMARY" | jq '.fixed // []')
SKIPPED=$(echo "$SUMMARY" | jq '.skipped // []')

FIXED_COUNT=$(echo "$FIXED" | jq 'length')
SKIPPED_COUNT=$(echo "$SKIPPED" | jq 'length')

# Build fixed rows
FIXED_ROWS=""
if [[ "$FIXED_COUNT" -gt 0 ]]; then
  while IFS= read -r item; do
    URL=$(echo "$item" | jq -r '.url')
    AUTHOR=$(echo "$item" | jq -r '.author')
    DETAILS=$(echo "$item" | jq -r '.details // "Fixed"')
    FIXED_ROWS+="| [view](${URL}) | @${AUTHOR} | ${DETAILS} |"$'\n'
  done < <(echo "$FIXED" | jq -c '.[]')
else
  FIXED_ROWS="| - | - | No fixes applied |"$'\n'
fi

# Build skipped rows
SKIPPED_ROWS=""
if [[ "$SKIPPED_COUNT" -gt 0 ]]; then
  while IFS= read -r item; do
    URL=$(echo "$item" | jq -r '.url')
    AUTHOR=$(echo "$item" | jq -r '.author')
    REASON=$(echo "$item" | jq -r '.reason // "No action needed"')
    SKIPPED_ROWS+="| [view](${URL}) | @${AUTHOR} | ${REASON} |"$'\n'
  done < <(echo "$SKIPPED" | jq -c '.[]')
else
  SKIPPED_ROWS="| - | - | All comments addressed |"$'\n'
fi

# Get template path (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/../templates/summary-comment.md"

# Read template and substitute variables
if [[ -f "$TEMPLATE_FILE" ]]; then
  COMMENT_BODY=$(cat "$TEMPLATE_FILE")
else
  # Fallback template if file not found
  COMMENT_BODY='## 🚀 Nitpick Nuker Report

**PR:** #${PR_NUMBER} | **Run:** ${TIMESTAMP} | **Commit:** `${COMMIT_SHA}`

### ✅ Fixed (${FIXED_COUNT})

| Comment | Author | Action |
|---------|--------|--------|
${FIXED_ROWS}

### ⏭️ Skipped (${SKIPPED_COUNT})

| Comment | Author | Reason |
|---------|--------|--------|
${SKIPPED_ROWS}

---
*🚀 reactions added to all processed comments*'
fi

# Perform substitutions
COMMENT_BODY="${COMMENT_BODY//\$\{PR_NUMBER\}/$PR_NUMBER}"
COMMENT_BODY="${COMMENT_BODY//\$\{TIMESTAMP\}/$TIMESTAMP}"
COMMENT_BODY="${COMMENT_BODY//\$\{COMMIT_SHA\}/$COMMIT_SHA}"
COMMENT_BODY="${COMMENT_BODY//\$\{FIXED_COUNT\}/$FIXED_COUNT}"
COMMENT_BODY="${COMMENT_BODY//\$\{SKIPPED_COUNT\}/$SKIPPED_COUNT}"
COMMENT_BODY="${COMMENT_BODY//\$\{FIXED_ROWS\}/$FIXED_ROWS}"
COMMENT_BODY="${COMMENT_BODY//\$\{SKIPPED_ROWS\}/$SKIPPED_ROWS}"

# Post comment to PR
gh pr comment "$PR_NUMBER" --body "$COMMENT_BODY"

echo "Posted summary comment to PR #$PR_NUMBER"
