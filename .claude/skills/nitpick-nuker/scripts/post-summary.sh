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
#   "roast_line": "I've seen better error handling in a fortune cookie.",
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

# Normalize markdown table cells so rows never break due to pipes/newlines.
sanitize_table_cell() {
  local value="$1"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  value="${value//|/\\|}"
  echo "$value"
}

# Enforce strict GitHub Markdown table format:
# - no blank lines within a table block
# - each row starts/ends with "|"
# - each row has the expected number of columns
validate_table_rows() {
  local label="$1"
  local expected_columns="$2"
  local rows="$3"
  local row
  local line_no=0
  local expected_pipes=$((expected_columns + 1))

  while IFS= read -r row; do
    line_no=$((line_no + 1))
    [[ -z "$row" ]] && continue

    if [[ ! "$row" =~ ^\|.*\|$ ]]; then
      echo "ERROR: ${label} row ${line_no} must start and end with '|': ${row}" >&2
      exit 1
    fi

    local row_without_escaped
    row_without_escaped="${row//\\|/}"
    local pipe_count
    pipe_count=$(awk -F'|' '{print NF-1}' <<< "$row_without_escaped")
    if [[ "$pipe_count" -ne "$expected_pipes" ]]; then
      echo "ERROR: ${label} row ${line_no} has ${pipe_count} pipe delimiters; expected ${expected_pipes}: ${row}" >&2
      exit 1
    fi
  done <<< "$rows"
}

# Read summary data
SUMMARY=$(cat "$SUMMARY_FILE")

# Extract values
TIMESTAMP=$(echo "$SUMMARY" | jq -r '.timestamp')
COMMIT_SHA=$(echo "$SUMMARY" | jq -r '.commit_sha')
ROAST_LINE=$(echo "$SUMMARY" | jq -r '.roast_line // "I reviewed this code so you dont have to. Youre welcome."')
FIXED=$(echo "$SUMMARY" | jq '.fixed // []')
SKIPPED=$(echo "$SUMMARY" | jq '.skipped // []')

FIXED_COUNT=$(echo "$FIXED" | jq 'length')
SKIPPED_COUNT=$(echo "$SKIPPED" | jq 'length')

if [[ "$SKIPPED_COUNT" -eq 0 ]]; then
  STATUS_LINE="All comments addressed — good to merge ✅"
else
  STATUS_LINE="${SKIPPED_COUNT} comment(s) skipped — review before merging ⚠️"
fi

# Build fixed rows
FIXED_ROWS=""
if [[ "$FIXED_COUNT" -gt 0 ]]; then
  while IFS= read -r item; do
    URL=$(echo "$item" | jq -r '.url')
    AUTHOR=$(echo "$item" | jq -r '.author')
    DETAILS=$(echo "$item" | jq -r '.details // "Fixed"')
    DETAILS=$(sanitize_table_cell "$DETAILS")
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
    REASON=$(sanitize_table_cell "$REASON")
    SKIPPED_ROWS+="| [view](${URL}) | @${AUTHOR} | ${REASON} |"$'\n'
  done < <(echo "$SKIPPED" | jq -c '.[]')
else
  SKIPPED_ROWS="| - | - | All comments addressed |"$'\n'
fi

# 3-column tables: Comment | Author | Action/Reason
validate_table_rows "fixed" 3 "$FIXED_ROWS"
validate_table_rows "skipped" 3 "$SKIPPED_ROWS"

# Get template path (relative to script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/../templates/summary-comment.md"

# Read template and substitute variables
if [[ -f "$TEMPLATE_FILE" ]]; then
  COMMENT_BODY=$(cat "$TEMPLATE_FILE")
else
  # Fallback template if file not found
  COMMENT_BODY='## 😄 Nitpick Nuker Report

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

**Status:** ${STATUS_LINE}'
fi

# Perform substitutions
COMMENT_BODY="${COMMENT_BODY//\$\{PR_NUMBER\}/$PR_NUMBER}"
COMMENT_BODY="${COMMENT_BODY//\$\{TIMESTAMP\}/$TIMESTAMP}"
COMMENT_BODY="${COMMENT_BODY//\$\{COMMIT_SHA\}/$COMMIT_SHA}"
COMMENT_BODY="${COMMENT_BODY//\$\{ROAST_LINE\}/$ROAST_LINE}"
COMMENT_BODY="${COMMENT_BODY//\$\{FIXED_COUNT\}/$FIXED_COUNT}"
COMMENT_BODY="${COMMENT_BODY//\$\{SKIPPED_COUNT\}/$SKIPPED_COUNT}"
COMMENT_BODY="${COMMENT_BODY//\$\{FIXED_ROWS\}/$FIXED_ROWS}"
COMMENT_BODY="${COMMENT_BODY//\$\{SKIPPED_ROWS\}/$SKIPPED_ROWS}"
COMMENT_BODY="${COMMENT_BODY//\$\{STATUS_LINE\}/$STATUS_LINE}"

# Strip blank lines between table separator and data rows.
# Prettier inserts blank lines after | --- | which breaks GitHub table rendering.
COMMENT_BODY=$(echo "$COMMENT_BODY" | sed -E '/^\| -+ \|.*\|$/{ N; s/\n$//; }')

# Post comment to PR via file to preserve markdown newlines exactly.
COMMENT_TMP_FILE="$(mktemp /tmp/nitpick-summary-comment.XXXXXX.md)"
trap 'rm -f "$COMMENT_TMP_FILE"' EXIT
printf '%s\n' "$COMMENT_BODY" > "$COMMENT_TMP_FILE"
gh pr comment "$PR_NUMBER" --body-file "$COMMENT_TMP_FILE"

echo "Posted summary comment to PR #$PR_NUMBER"
