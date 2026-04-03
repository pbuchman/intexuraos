#!/usr/bin/env bash
#
# reply-to-comment.sh
# Posts a reply to a PR comment using the GitHub API
#
# Usage: ./reply-to-comment.sh <comment_type> <comment_id> <pr_number> <message>
#        comment_type: "issue_comment", "review_comment", or "review_body"
#        comment_id: The database ID (numeric)
#        pr_number: The PR number
#        message: The reply message

set -euo pipefail

COMMENT_TYPE="${1:-}"
COMMENT_ID="${2:-}"
PR_NUMBER="${3:-}"
MESSAGE="${4:-}"

if [[ -z "$COMMENT_TYPE" || -z "$COMMENT_ID" || -z "$PR_NUMBER" || -z "$MESSAGE" ]]; then
  echo "Usage: $0 <comment_type> <comment_id> <pr_number> <message>" >&2
  echo "  comment_type: issue_comment, review_comment, or review_body" >&2
  echo "  comment_id: The comment's database ID (numeric)" >&2
  echo "  pr_number: The PR number" >&2
  echo "  message: The reply message" >&2
  exit 1
fi

# Get repo owner and name
REPO_INFO=$(gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"')
OWNER=$(echo "$REPO_INFO" | cut -d'/' -f1)
REPO=$(echo "$REPO_INFO" | cut -d'/' -f2)

case "$COMMENT_TYPE" in
  issue_comment)
    # Reply to issue comment by posting a new comment on the PR
    # Node ID conversion not needed - we post to the PR, not the comment
    gh api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    ;;

  review_comment)
    # Reply to review comment using the replies endpoint
    # If ID starts with PRRC_, convert node ID to database ID
    if [[ "$COMMENT_ID" =~ ^PRRC_ ]]; then
      COMMENT_ID=$(gh api graphql -f query='
        query($id: ID!) {
          node(id: $id) {
            ... on PullRequestReviewComment {
              databaseId
            }
          }
        }
      ' -f id="$COMMENT_ID" --jq '.data.node.databaseId')
    fi

    gh api "repos/${OWNER}/${REPO}/pulls/comments/${COMMENT_ID}/replies" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    ;;

  review_body)
    # Review body doesn't have a reply endpoint, so post as issue comment on the PR
    gh api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    ;;

  *)
    echo "ERROR: Unknown comment type: $COMMENT_TYPE" >&2
    echo "Valid types: issue_comment, review_comment, review_body" >&2
    exit 1
    ;;
esac

echo "Posted reply to $COMMENT_TYPE $COMMENT_ID on PR #${PR_NUMBER}"
