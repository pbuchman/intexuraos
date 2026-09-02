#!/usr/bin/env bash
#
# add-reaction.sh
# Adds 😄 reaction to a PR comment to mark it as processed
#
# Usage: ./add-reaction.sh <comment_type> <comment_id>
#        comment_type: "issue_comment", "review_comment", or "review_body"
#        comment_id: The node ID (e.g., IC_..., PRRC_..., PRR_...) or database ID
#
# For issue_comment and review_comment, uses REST API with database ID
# For review_body, uses GraphQL mutation with node ID

set -euo pipefail

COMMENT_TYPE="${1:-}"
COMMENT_ID="${2:-}"

if [[ -z "$COMMENT_TYPE" || -z "$COMMENT_ID" ]]; then
  echo "Usage: $0 <comment_type> <comment_id>" >&2
  echo "  comment_type: issue_comment, review_comment, or review_body" >&2
  echo "  comment_id: The comment's node ID or database ID" >&2
  exit 1
fi

# Get repo owner and name
REPO_INFO=$(gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"')

case "$COMMENT_TYPE" in
  issue_comment)
    # REST API for issue comments
    # If ID starts with IC_, it's a node ID - we need database ID
    if [[ "$COMMENT_ID" =~ ^IC_ ]]; then
      # Extract database ID from node ID using GraphQL
      DB_ID=$(gh api graphql -f query='
        query($id: ID!) {
          node(id: $id) {
            ... on IssueComment {
              databaseId
            }
          }
        }
      ' -f id="$COMMENT_ID" --jq '.data.node.databaseId')
    else
      DB_ID="$COMMENT_ID"
    fi

    gh api "repos/${REPO_INFO}/issues/comments/${DB_ID}/reactions" \
      -X POST \
      -f content=laugh \
      --silent
    ;;

  review_comment)
    # REST API for review comments (pull request review comments)
    # If ID starts with PRRC_, it's a node ID - we need database ID
    if [[ "$COMMENT_ID" =~ ^PRRC_ ]]; then
      DB_ID=$(gh api graphql -f query='
        query($id: ID!) {
          node(id: $id) {
            ... on PullRequestReviewComment {
              databaseId
            }
          }
        }
      ' -f id="$COMMENT_ID" --jq '.data.node.databaseId')
    else
      DB_ID="$COMMENT_ID"
    fi

    gh api "repos/${REPO_INFO}/pulls/comments/${DB_ID}/reactions" \
      -X POST \
      -f content=laugh \
      --silent
    ;;

  review_body)
    # GraphQL mutation for review body reactions
    # Review body reactions require node ID (PRR_...)
    if [[ ! "$COMMENT_ID" =~ ^PRR_ ]]; then
      echo "ERROR: review_body requires a node ID (PRR_...)" >&2
      exit 1
    fi

    gh api graphql -f query='
      mutation($subjectId: ID!) {
        addReaction(input: {subjectId: $subjectId, content: LAUGH}) {
          reaction {
            content
          }
        }
      }
    ' -f subjectId="$COMMENT_ID" --silent
    ;;

  *)
    echo "ERROR: Unknown comment type: $COMMENT_TYPE" >&2
    echo "Valid types: issue_comment, review_comment, review_body" >&2
    exit 1
    ;;
esac

echo "Added 😄 reaction to $COMMENT_TYPE $COMMENT_ID"
