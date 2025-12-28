#!/bin/bash
# Import GitHub issues from YAML file
#
# Prerequisites:
#   1. Install gh CLI: brew install gh
#   2. Authenticate: gh auth login
#   3. Install yq: brew install yq
#
# Usage:
#   ./scripts/import-issues.sh
#
# Options:
#   --dry-run    Print commands without executing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YAML_FILE="${SCRIPT_DIR}/github-issues.yaml"
REPO="pbuchman/intexuraos"
DRY_RUN=false

# Parse arguments
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "🔍 Dry run mode - no issues will be created"
fi

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo "❌ gh CLI not found. Install with: brew install gh"
    exit 1
fi

if ! command -v yq &> /dev/null; then
    echo "❌ yq not found. Install with: brew install yq"
    exit 1
fi

# Check if any account is active (gh auth status returns non-zero if ANY account has issues)
if ! gh auth status 2>&1 | grep -q "Active account: true"; then
    echo "❌ Not authenticated with gh. Run: gh auth login"
    exit 1
fi

if [[ ! -f "$YAML_FILE" ]]; then
    echo "❌ YAML file not found: $YAML_FILE"
    exit 1
fi

echo "📋 Reading issues from: $YAML_FILE"
echo "📦 Target repository: $REPO"
echo ""

# Count issues
ISSUE_COUNT=$(yq '.issues | length' "$YAML_FILE")
echo "Found $ISSUE_COUNT issues to create"
echo ""

# Create each issue
for i in $(seq 0 $((ISSUE_COUNT - 1))); do
    TITLE=$(yq -r ".issues[$i].title" "$YAML_FILE")
    BODY=$(yq -r ".issues[$i].body" "$YAML_FILE")
    LABELS=$(yq -r ".issues[$i].labels | join(\",\")" "$YAML_FILE")

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 Issue $((i + 1))/$ISSUE_COUNT: $TITLE"
    echo "   Labels: $LABELS"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "   [DRY RUN] Would create issue"
    else
        # Create issue and capture URL (disable set -e temporarily)
        set +e
        ISSUE_URL=$(gh issue create \
            --repo "$REPO" \
            --title "$TITLE" \
            --body "$BODY" \
            --label "$LABELS" \
            2>&1)
        EXIT_CODE=$?
        set -e

        if [[ $EXIT_CODE -eq 0 ]]; then
            echo "   ✅ Created: $ISSUE_URL"
        else
            echo "   ❌ Failed to create issue (exit code: $EXIT_CODE)"
            echo "   Error: $ISSUE_URL"
            # Continue with next issue instead of stopping
        fi
    fi

    # Small delay to avoid rate limiting
    if [[ "$DRY_RUN" == "false" ]]; then
        sleep 1
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔍 Dry run complete. Run without --dry-run to create issues."
else
    echo "✅ All issues created!"
fi

