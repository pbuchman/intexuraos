#!/usr/bin/env bash
set -euo pipefail

# collect-release-data.sh
#
# Deterministic data collection for release preparation.
# Runs pure CLI commands (git, gh) — no LLM needed.
# Output: .prerelease-data.md at repo root with HEAD sha for staleness checks.
#
# Usage:
#   ./scripts/collect-release-data.sh           # commits since last tag
#   ./scripts/collect-release-data.sh --last 10  # last N commits (POC mode)

REPO_ROOT="$(git rev-parse --show-toplevel)"
OUTPUT_FILE="$REPO_ROOT/.prerelease-data.md"

# Parse args
MODE="since-tag"
LAST_N=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --last)
      MODE="last-n"
      LAST_N="$2"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

# --- Tool verification ---
for tool in git gh jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo "ERROR: $tool is required but not found" >&2
    exit 1
  fi
done

# --- Collect base state ---
HEAD_SHA=$(git rev-parse HEAD)
HEAD_SHORT=$(git rev-parse --short HEAD)
CURRENT_VERSION=$(jq -r '.version' "$REPO_ROOT/package.json")
BRANCH=$(git branch --show-current)
LAST_TAG=$(git tag -l "v*" --sort=-v:refname | head -1)

if [[ -z "$LAST_TAG" ]]; then
  echo "No previous release tag found. Using first commit as boundary."
  TAG_BOUNDARY=""
  LAST_TAG_DATE=$(git log --reverse --format="%ci" | head -1 | cut -d' ' -f1)
else
  TAG_BOUNDARY="$LAST_TAG..HEAD"
  LAST_TAG_DATE=$(git log -1 --format="%ci" "$LAST_TAG" | cut -d' ' -f1)
fi

# --- Collect commits ---
if [[ "$MODE" == "last-n" ]]; then
  COMMIT_HASHES=$(git log -"$LAST_N" --format="%H" --no-merges)
  COMMIT_RANGE="last $LAST_N commits"
else
  if [[ -n "$TAG_BOUNDARY" ]]; then
    COMMIT_HASHES=$(git log "$TAG_BOUNDARY" --format="%H" --no-merges)
  else
    COMMIT_HASHES=$(git log --format="%H" --no-merges)
  fi
  COMMIT_RANGE="since $LAST_TAG"
fi

COMMIT_COUNT=$(echo "$COMMIT_HASHES" | grep -c . || true)

# --- Build output ---
{
  # Header with staleness metadata
  echo "<!-- HEAD: $HEAD_SHA -->"
  echo "<!-- generated: $(date -u +%Y-%m-%dT%H:%M:%SZ) -->"
  echo ""
  echo "# Pre-Release Data"
  echo ""
  echo "| Field | Value |"
  echo "|-------|-------|"
  echo "| HEAD | \`$HEAD_SHORT\` ($HEAD_SHA) |"
  echo "| Generated | $(date -u +%Y-%m-%dT%H:%M:%SZ) |"
  echo "| Current version | $CURRENT_VERSION |"
  echo "| Last release tag | ${LAST_TAG:-none} |"
  echo "| Branch | $BRANCH |"
  echo "| Commit range | $COMMIT_RANGE |"
  echo "| Commit count | $COMMIT_COUNT |"
  echo ""
  echo "---"
  echo ""

  # --- Commits section ---
  echo "## Commits"
  echo ""

  SEEN_PRS=""
  ALL_LINEAR_REFS=""
  COMMIT_INDEX=0

  for hash in $COMMIT_HASHES; do
    COMMIT_INDEX=$((COMMIT_INDEX + 1))
    short=$(git rev-parse --short "$hash")
    subject=$(git log -1 --format="%s" "$hash")
    author=$(git log -1 --format="%an" "$hash")
    date=$(git log -1 --format="%ai" "$hash")
    body=$(git log -1 --format="%b" "$hash" | head -20)
    stat=$(git show "$hash" --stat --format="" | tail -n +1)

    # Find associated PR
    pr_json=$(gh pr list --state merged --search "$hash" --json number,title --jq '.[0] // empty' 2>/dev/null || true)
    if [[ -n "$pr_json" ]]; then
      pr_number=$(echo "$pr_json" | jq -r '.number')
      pr_title=$(echo "$pr_json" | jq -r '.title')
      pr_ref="PR #$pr_number - $pr_title"
      # Track unique PRs
      if [[ ! " $SEEN_PRS " =~ " $pr_number " ]]; then
        SEEN_PRS="$SEEN_PRS $pr_number"
      fi
    else
      pr_ref="none (direct commit)"
      pr_number=""
    fi

    # Extract INT-XXX references
    linear_refs=$(echo "$subject $body" | { grep -oE 'INT-[0-9]+' || true; } | sort -u | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$linear_refs" ]]; then
      ALL_LINEAR_REFS="$ALL_LINEAR_REFS $linear_refs"
    fi

    echo "### $COMMIT_INDEX. \`$short\` - $subject"
    echo ""
    echo "- **Author:** $author"
    echo "- **Date:** $date"
    echo "- **PR:** $pr_ref"
    echo "- **Linear:** ${linear_refs:-none}"
    echo "- **Files:**"
    echo '```'
    echo "$stat"
    echo '```'
    if [[ -n "$body" ]]; then
      # Strip co-author and bot signature lines
      cleaned_body=$(echo "$body" | { grep -v "Co-Authored-By\|Assembled with\|Architected with\|Sculpted with" || true; } | sed '/^$/d')
      if [[ -n "$cleaned_body" ]]; then
        echo "- **Body:** $cleaned_body"
      fi
    fi
    echo ""
  done

  # --- PR details section ---
  echo "---"
  echo ""
  echo "## Pull Requests"
  echo ""

  for pr_number in $SEEN_PRS; do
    pr_detail=$(gh pr view "$pr_number" --json number,title,body,labels,mergedAt,author 2>/dev/null || true)
    if [[ -z "$pr_detail" ]]; then
      echo "### PR #$pr_number - (fetch failed)"
      echo ""
      continue
    fi

    pr_title=$(echo "$pr_detail" | jq -r '.title')
    pr_author=$(echo "$pr_detail" | jq -r '.author.login')
    pr_merged=$(echo "$pr_detail" | jq -r '.mergedAt')
    pr_labels=$(echo "$pr_detail" | jq -r '[.labels[].name] | join(", ")')
    pr_body=$(echo "$pr_detail" | jq -r '.body' | head -30)

    # Extract summary (first section of body, up to ## Test plan or similar)
    pr_summary=$(echo "$pr_body" | sed -n '/^## Summary$/,/^## /p' | head -20 | tail -n +2 | { grep -v '^## ' || true; } | sed '/^$/d')
    if [[ -z "$pr_summary" ]]; then
      # Fallback: first 5 non-empty lines
      pr_summary=$(echo "$pr_body" | { grep -v '^$' || true; } | head -5)
    fi

    # Extract Linear refs from PR
    pr_linear=$(echo "$pr_title $pr_body" | { grep -oE 'INT-[0-9]+' || true; } | sort -u | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$pr_linear" ]]; then
      ALL_LINEAR_REFS="$ALL_LINEAR_REFS $pr_linear"
    fi

    echo "### PR #$pr_number - $pr_title"
    echo ""
    echo "- **Author:** $pr_author"
    echo "- **Merged:** $pr_merged"
    echo "- **Labels:** ${pr_labels:-none}"
    echo "- **Linear:** ${pr_linear:-none}"
    echo "- **Summary:** $pr_summary"
    echo ""
  done

  # --- Modified services ---
  echo "---"
  echo ""
  echo "## Modified Services"
  echo ""

  if [[ -n "$TAG_BOUNDARY" ]]; then
    diff_range="$TAG_BOUNDARY"
  else
    diff_range="HEAD"
  fi

  modified_apps=$(git diff --name-only $diff_range -- apps/ 2>/dev/null | cut -d'/' -f2 | sort -u | grep -v web || true)
  modified_workers=$(git diff --name-only $diff_range -- workers/ 2>/dev/null | cut -d'/' -f2 | sort -u || true)
  modified_packages=$(git diff --name-only $diff_range -- packages/ 2>/dev/null | cut -d'/' -f2 | sort -u || true)
  modified_terraform=$(git diff --name-only $diff_range -- terraform/ 2>/dev/null | head -1 || true)

  if [[ -n "$modified_apps" ]]; then
    echo "**Apps:**"
    for app in $modified_apps; do echo "- \`apps/$app/\`"; done
    echo ""
  fi
  if [[ -n "$modified_workers" ]]; then
    echo "**Workers:**"
    for worker in $modified_workers; do echo "- \`workers/$worker/\`"; done
    echo ""
  fi
  if [[ -n "$modified_packages" ]]; then
    echo "**Packages:**"
    for pkg in $modified_packages; do echo "- \`packages/$pkg/\`"; done
    echo ""
  fi
  if [[ -n "$modified_terraform" ]]; then
    echo "**Infrastructure:**"
    echo "- \`terraform/\`"
    echo ""
  fi

  # --- Linear issues referenced ---
  echo "---"
  echo ""
  echo "## Linear Issues Referenced"
  echo ""

  unique_linear=$(echo "$ALL_LINEAR_REFS" | tr ',' '\n' | tr ' ' '\n' | sort -u | grep -v '^$' || true)
  if [[ -n "$unique_linear" ]]; then
    for ref in $unique_linear; do
      echo "- **$ref**"
    done
  else
    echo "No Linear issues referenced."
  fi
  echo ""

} > "$OUTPUT_FILE"

echo "Written: $OUTPUT_FILE"
echo "HEAD: $HEAD_SHORT"
echo "Commits: $COMMIT_COUNT ($COMMIT_RANGE)"
echo "PRs: $(echo "$SEEN_PRS" | wc -w | tr -d ' ')"
