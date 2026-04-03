# GitHub API Endpoints Reference

## Comment Types and Their APIs

### Issue Comments (General PR Conversation)

```bash
# List issue comments
gh api repos/{owner}/{repo}/issues/{issue_number}/comments

# Get single comment
gh api repos/{owner}/{repo}/issues/comments/{comment_id}

# Add reaction to issue comment
gh api repos/{owner}/{repo}/issues/comments/{comment_id}/reactions \
  -X POST \
  -f content=laugh
```

### Review Comments (Inline Code Comments)

```bash
# List review comments on a PR
gh api repos/{owner}/{repo}/pulls/{pull_number}/comments

# Get single review comment
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}

# Add reaction to review comment
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions \
  -X POST \
  -f content=laugh

# Reply to review comment (threaded reply)
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  -X POST \
  -f body="reply text"
```

### Reviews (Overall Review with Body)

Reviews are accessed via GraphQL for reactions (REST doesn't support review body reactions).

```bash
# List reviews
gh api repos/{owner}/{repo}/pulls/{pull_number}/reviews

# Get single review
gh api repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}

# Add reaction to review body (GraphQL only)
gh api graphql -f query='
  mutation($subjectId: ID!) {
    addReaction(input: {subjectId: $subjectId, content: LAUGH}) {
      reaction {
        content
      }
    }
  }
' -f subjectId="<review_node_id>"
```

## GraphQL Query for Fetching All Comments

```graphql
query (
  $owner: String!
  $repo: String!
  $pr: Int!
  $commentsCursor: String
  $reviewsCursor: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      # Issue comments (general PR conversation)
      comments(first: 100, after: $commentsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          author {
            login
          }
          body
          url
          createdAt
          reactions(first: 100) {
            nodes {
              content
              user {
                login
              }
            }
          }
        }
      }
      # Reviews and their inline comments
      reviews(first: 100, after: $reviewsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          databaseId
          author {
            login
          }
          body
          url
          state
          createdAt
          reactions(first: 100) {
            nodes {
              content
              user {
                login
              }
            }
          }
          comments(first: 100) {
            nodes {
              id
              databaseId
              author {
                login
              }
              body
              url
              path
              line
              createdAt
              reactions(first: 100) {
                nodes {
                  content
                  user {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Reaction Content Values

| Display | API Value                |
| ------- | ------------------------ |
| 👍      | `+1` or `THUMBS_UP`      |
| 👎      | `-1` or `THUMBS_DOWN`    |
| 😄      | `laugh` or `LAUGH`       |
| 🎉      | `hooray` or `HOORAY`     |
| 😕      | `confused` or `CONFUSED` |
| ❤️      | `heart` or `HEART`       |
| 🚀      | `rocket` or `ROCKET`     |
| 👀      | `eyes` or `EYES`         |

## ID Formats

| Type           | Database ID                         | Node ID (GraphQL) |
| -------------- | ----------------------------------- | ----------------- |
| Issue Comment  | `IC_kwDOAAA...` (node) or numeric   | `IC_kwDOAAA...`   |
| Review Comment | `PRRC_kwDOAAA...` (node) or numeric | `PRRC_kwDOAAA...` |
| Review         | `PRR_kwDOAAA...` (node) or numeric  | `PRR_kwDOAAA...`  |

**Note:** GraphQL returns node IDs (`IC_`, `PRRC_`, `PRR_` prefixed). REST APIs use numeric IDs.

## Useful CLI Commands

```bash
# Get current user
gh api user --jq '.login'

# Get PR details
gh pr view {pr_number} --json number,headRefName,baseRefName,url

# Watch PR checks
gh pr checks {pr_number} --watch

# Post comment to PR
gh pr comment {pr_number} --body "message"

# Get repo owner/name from remote
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

## Rate Limits

- REST API: 5000 requests/hour (authenticated)
- GraphQL API: 5000 points/hour (authenticated)
  - Each query costs at least 1 point
  - Connections (lists) add cost based on `first` parameter

## Error Handling

| Status | Meaning                  | Action                     |
| ------ | ------------------------ | -------------------------- |
| 401    | Unauthorized             | Run `gh auth login`        |
| 403    | Forbidden / Rate limited | Check rate limit, wait     |
| 404    | Not found                | Verify IDs and permissions |
| 422    | Validation failed        | Check request body         |
