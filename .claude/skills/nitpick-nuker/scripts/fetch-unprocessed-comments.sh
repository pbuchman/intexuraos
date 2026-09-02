#!/usr/bin/env bash
#
# fetch-unprocessed-comments.sh
# Fetches PR comments that haven't been processed (no 😄 reaction from bot)
#
# Usage: ./fetch-unprocessed-comments.sh [PR_NUMBER]
#        If no PR_NUMBER, detects from current branch
#
# Output: JSON array of unprocessed comments
#
# Notes:
#   - Tries GraphQL first for full comment coverage (issue_comments + reviews)
#   - Falls back to REST API for issue_comments only if GraphQL hits complexity limits

set -euo pipefail

# Get PR number from argument or current branch
PR_NUMBER="${1:-}"
if [[ -z "$PR_NUMBER" ]]; then
  PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null || echo "")
  if [[ -z "$PR_NUMBER" ]]; then
    echo "ERROR: No PR found for current branch. Provide PR number as argument." >&2
    exit 1
  fi
fi

# Get repo owner and name
REPO_INFO=$(gh repo view --json owner,name --jq '"\(.owner.login) \(.name)"')
OWNER=$(echo "$REPO_INFO" | cut -d' ' -f1)
REPO=$(echo "$REPO_INFO" | cut -d' ' -f2)

# Get the authenticated actor's login.
#
# We cannot use `gh api user` because GitHub App installation tokens (ghs_*)
# return 403 "Resource not accessible by integration" on /user — installations
# have no associated user. GraphQL `viewer` works for every token type gh
# supports: user PATs (ghp_), fine-grained PATs (github_pat_), OAuth (gho_),
# user-to-server (ghu_), and installation tokens (ghs_). The login string is
# "<user>" for humans and "<app-slug>[bot]" for installations — both are safe
# inside the jq --arg filters used below.
BOT_USERNAME=$(gh api graphql -f query='query { viewer { login } }' --jq '.data.viewer.login')
if [[ -z "$BOT_USERNAME" || "$BOT_USERNAME" == "null" ]]; then
  echo "ERROR: could not determine authenticated actor via GraphQL viewer" >&2
  exit 2
fi

# Function to check if comment has bot's laugh reaction
has_bot_laugh() {
  local reactions="$1"
  echo "$reactions" | jq -e --arg bot "$BOT_USERNAME" '
    .nodes | any(.content == "LAUGH" and .user.login == $bot)
  ' > /dev/null 2>&1
}

# Function to check if comment has bot's laugh reaction (REST API format)
has_bot_laugh_rest() {
  local comment_id="$1"
  local has_laugh
  # Note: gh api --jq doesn't support --arg, so we pipe to jq separately
  has_laugh=$(gh api "repos/${OWNER}/${REPO}/issues/comments/${comment_id}/reactions" 2>/dev/null \
    | jq --arg bot "$BOT_USERNAME" '[.[] | select(.content == "laugh" and .user.login == $bot)] | length > 0' 2>/dev/null || echo "false")
  [[ "$has_laugh" == "true" ]]
}

# Function to fetch using REST API (fallback for large PRs)
fetch_with_rest_api() {
  echo "Using REST API fallback (issue_comments only)..." >&2

  OUTPUT="[]"

  # Fetch all issue comments with pagination
  while IFS= read -r comment; do
    [[ -z "$comment" || "$comment" == "null" ]] && continue

    COMMENT_ID=$(echo "$comment" | jq -r '.id')

    # Check if already has bot's laugh reaction
    if has_bot_laugh_rest "$COMMENT_ID"; then
      continue
    fi

    # Format comment for output
    PROCESSED=$(echo "$comment" | jq '{
      id: .node_id,
      databaseId: .id,
      type: "issue_comment",
      author: .user.login,
      body: .body,
      url: .html_url,
      createdAt: .created_at,
      path: null,
      line: null
    }')

    OUTPUT=$(echo "$OUTPUT" | jq --argjson item "$PROCESSED" '. + [$item]')
  done < <(gh api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" --paginate --jq '.[]' | jq -c '.')

  # Sort by createdAt and output
  echo "$OUTPUT" | jq 'sort_by(.createdAt)'
}

# GraphQL query with pagination support
QUERY='
query($owner: String!, $repo: String!, $pr: Int!, $commentsCursor: String, $reviewsCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      comments(first: 100, after: $commentsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          author { login }
          body
          url
          createdAt
          reactions(first: 100) {
            nodes {
              content
              user { login }
            }
          }
        }
      }
      reviews(first: 100, after: $reviewsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          author { login }
          body
          url
          state
          createdAt
          reactions(first: 100) {
            nodes {
              content
              user { login }
            }
          }
          comments(first: 100) {
            nodes {
              id
              databaseId
              author { login }
              body
              url
              path
              line
              createdAt
              reactions(first: 100) {
                nodes {
                  content
                  user { login }
                }
              }
            }
          }
        }
      }
    }
  }
}
'

# Try GraphQL first, fall back to REST if complexity limit hit
fetch_with_graphql() {
  # Collect all comments with pagination
  ALL_ISSUE_COMMENTS="[]"
  ALL_REVIEWS="[]"
  COMMENTS_CURSOR=""
  REVIEWS_CURSOR=""

  while true; do
    # Build cursor arguments
    CURSOR_ARGS=""
    if [[ -n "$COMMENTS_CURSOR" ]]; then
      CURSOR_ARGS="$CURSOR_ARGS -f commentsCursor=$COMMENTS_CURSOR"
    fi
    if [[ -n "$REVIEWS_CURSOR" ]]; then
      CURSOR_ARGS="$CURSOR_ARGS -f reviewsCursor=$REVIEWS_CURSOR"
    fi

    # Execute query and capture both stdout and stderr
    # shellcheck disable=SC2086
    if ! RESULT=$(gh api graphql \
      -f query="$QUERY" \
      -f owner="$OWNER" \
      -f repo="$REPO" \
      -F pr="$PR_NUMBER" \
      $CURSOR_ARGS 2>&1); then

      # Check if error is due to complexity limit
      if echo "$RESULT" | grep -q "exceeds the maximum limit"; then
        echo "GraphQL complexity limit hit, falling back to REST API..." >&2
        return 1
      fi

      # Other error - propagate it
      echo "$RESULT" >&2
      exit 1
    fi

    # Extract data
    PR_DATA=$(echo "$RESULT" | jq '.data.repository.pullRequest')

    # Accumulate issue comments
    ISSUE_COMMENTS=$(echo "$PR_DATA" | jq '.comments.nodes // []')
    ALL_ISSUE_COMMENTS=$(echo "$ALL_ISSUE_COMMENTS $ISSUE_COMMENTS" | jq -s 'add')

    # Accumulate reviews
    REVIEWS=$(echo "$PR_DATA" | jq '.reviews.nodes // []')
    ALL_REVIEWS=$(echo "$ALL_REVIEWS $REVIEWS" | jq -s 'add')

    # Check pagination
    COMMENTS_HAS_NEXT=$(echo "$PR_DATA" | jq -r '.comments.pageInfo.hasNextPage')
    REVIEWS_HAS_NEXT=$(echo "$PR_DATA" | jq -r '.reviews.pageInfo.hasNextPage')

    # Update cursors
    if [[ "$COMMENTS_HAS_NEXT" == "true" ]]; then
      COMMENTS_CURSOR=$(echo "$PR_DATA" | jq -r '.comments.pageInfo.endCursor')
    else
      COMMENTS_CURSOR=""
    fi

    if [[ "$REVIEWS_HAS_NEXT" == "true" ]]; then
      REVIEWS_CURSOR=$(echo "$PR_DATA" | jq -r '.reviews.pageInfo.endCursor')
    else
      REVIEWS_CURSOR=""
    fi

    # Break if no more pages
    if [[ -z "$COMMENTS_CURSOR" && -z "$REVIEWS_CURSOR" ]]; then
      break
    fi
  done

  # Process and filter comments
  OUTPUT="[]"

  # Process issue comments
  while IFS= read -r comment; do
    [[ -z "$comment" || "$comment" == "null" ]] && continue

    REACTIONS=$(echo "$comment" | jq '.reactions')
    if has_bot_laugh "$REACTIONS"; then
      continue
    fi

    PROCESSED=$(echo "$comment" | jq --arg bot "$BOT_USERNAME" '{
      id: .id,
      databaseId: .databaseId,
      type: "issue_comment",
      author: .author.login,
      body: .body,
      url: .url,
      createdAt: .createdAt,
      path: null,
      line: null
    }')

    OUTPUT=$(echo "$OUTPUT" | jq --argjson item "$PROCESSED" '. + [$item]')
  done < <(echo "$ALL_ISSUE_COMMENTS" | jq -c '.[]')

  # Process reviews and their comments
  while IFS= read -r review; do
    [[ -z "$review" || "$review" == "null" ]] && continue

    REVIEW_AUTHOR=$(echo "$review" | jq -r '.author.login')
    REVIEW_BODY=$(echo "$review" | jq -r '.body // ""')
    REVIEW_STATE=$(echo "$review" | jq -r '.state')

    # Process review body if it has content
    if [[ -n "$REVIEW_BODY" && "$REVIEW_BODY" != "null" && "$REVIEW_BODY" != "" ]]; then
      REACTIONS=$(echo "$review" | jq '.reactions')
      if ! has_bot_laugh "$REACTIONS"; then
        PROCESSED=$(echo "$review" | jq '{
          id: .id,
          databaseId: .databaseId,
          type: "review_body",
          author: .author.login,
          body: .body,
          url: .url,
          createdAt: .createdAt,
          path: null,
          line: null,
          reviewState: .state
        }')

        OUTPUT=$(echo "$OUTPUT" | jq --argjson item "$PROCESSED" '. + [$item]')
      fi
    fi

    # Process review comments (inline code comments)
    REVIEW_COMMENTS=$(echo "$review" | jq '.comments.nodes // []')
    REVIEW_ID=$(echo "$review" | jq -r '.id')

    while IFS= read -r comment; do
      [[ -z "$comment" || "$comment" == "null" ]] && continue

      REACTIONS=$(echo "$comment" | jq '.reactions')
      if has_bot_laugh "$REACTIONS"; then
        continue
      fi

      PROCESSED=$(echo "$comment" | jq --arg reviewId "$REVIEW_ID" '{
        id: .id,
        databaseId: .databaseId,
        type: "review_comment",
        author: .author.login,
        body: .body,
        url: .url,
        createdAt: .createdAt,
        path: .path,
        line: .line,
        reviewId: $reviewId
      }')

      OUTPUT=$(echo "$OUTPUT" | jq --argjson item "$PROCESSED" '. + [$item]')
    done < <(echo "$REVIEW_COMMENTS" | jq -c '.[]')
  done < <(echo "$ALL_REVIEWS" | jq -c '.[]')

  # Sort by createdAt and output
  echo "$OUTPUT" | jq 'sort_by(.createdAt)'
}

# Main: Try GraphQL first, fall back to REST API if needed
if ! fetch_with_graphql; then
  fetch_with_rest_api
fi
