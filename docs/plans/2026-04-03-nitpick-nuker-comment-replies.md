# Nitpick Nuker — Per-Comment Reply Behavior

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After processing each PR comment, post a reply to that comment explaining whether the fix was applied or skipped, with reasoning.

**Architecture:** Add a bash reply script (`reply-to-comment.sh`) that creates a reply on the original PR comment using the GitHub API. Update the triage workflow to invoke it after Step 3c (Execute Decision). The existing summary comment and reaction behavior remain unchanged.

**Tech Stack:** Bash, GitHub CLI (`gh`), GitHub REST/GraphQL APIs, Markdown

---

## File Structure

| File                                                           | Action   | Responsibility                                                                |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `.claude/skills/nitpick-nuker/scripts/reply-to-comment.sh`     | Create   | Script to post a reply to any PR comment using the GitHub API                 |
| `.claude/skills/nitpick-nuker/templates/inline-reply.md`       | Create   | Template for the per-comment reply format                                     |
| `.claude/skills/nitpick-nuker/workflows/triage-pr-comments.md` | Modify   | Add reply step after 3c ("Execute Decision"), before 3d ("Mark as Processed") |
| `.claude/skills/nitpick-nuker/SKILL.md`                        | Modify   | Add `reply-to-comment.sh` to the scripts table                                |

---

### Task 1: Create `reply-to-comment.sh` Script

**Files:**
- Create: `.claude/skills/nitpick-nuker/scripts/reply-to-comment.sh`

**Context:** This script receives the comment ID, comment type, and a message, then replies using the GitHub API. For `issue_comment` and `review_comment`, we post a new `issue_comment` on the PR (which appears as a reply thread). For `review_body`, we also post into the review thread context so it appears nested beneath the original.

GitHub's API does not support true "reply" nesting for review comments via a separate endpoint — instead, replies to inline review comments use `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` (REST API v3).

The script must handle three comment types:
- `issue_comment` — Use `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`
- `review_comment` — Use `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` (the replies endpoint)
- `review_body` — Post as a regular `issue_comment` referencing the review

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
#
# reply-to-comment.sh
# Posts a reply to a specific PR comment (issue_comment, review_comment, or review_body).
#
# Usage: ./reply-to-comment.sh <comment_type> <comment_id> <pr_number> <message>
#        comment_type: "issue_comment", "review_comment", or "review_body"
#        comment_id: The comment's database ID (numeric)
#        pr_number: PR number (integer)
#        message: The reply text (plain text or simple markdown)

set -euo pipefail

COMMENT_TYPE="${1:-}"
COMMENT_ID="${2:-}"
PR_NUMBER="${3:-}"
MESSAGE="${4:-}"

if [[ -z "$COMMENT_TYPE" || -z "$COMMENT_ID" || -z "$PR_NUMBER" || -z "$MESSAGE" ]]; then
  echo "Usage: $0 <comment_type> <comment_id> <pr_number> <message>" >&2
  exit 1
fi

# Get repo owner and name
REPO_INFO=$(gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"')
OWNER=$(echo "$REPO_INFO" | cut -d' ' -f1)
REPO=$(echo "$REPO_INFO" | cut -d' ' -f2)

case "$COMMENT_TYPE" in
  issue_comment)
    gh api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    echo "Replied to $COMMENT_TYPE #${COMMENT_ID} on PR #${PR_NUMBER}"
    ;;

  review_comment)
    gh api "repos/${OWNER}/${REPO}/pulls/comments/${COMMENT_ID}/replies" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    echo "Replied to $COMMENT_TYPE #${COMMENT_ID} on PR #${PR_NUMBER}"
    ;;

  review_body)
    # Reply into the review's discussion thread via issue comment
    gh api "repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments" \
      -X POST \
      -f body="$MESSAGE" \
      --silent
    echo "Replied to $COMMENT_TYPE #${COMMENT_ID} on PR #${PR_NUMBER}"
    ;;

  *)
    echo "ERROR: Unknown comment type: $COMMENT_TYPE" >&2
    echo "Valid types: issue_comment, review_comment, review_body" >&2
    exit 1
    ;;
esac
```

- [ ] **Step 2: Verify script is executable**

```bash
chmod +x .claude/skills/nitpick-nuker/scripts/reply-to-comment.sh
```

---

### Task 2: Create `inline-reply.md` Template

**Files:**
- Create: `.claude/skills/nitpick-nuker/templates/inline-reply.md`

- [ ] **Step 1: Create the template**

```markdown
> _${ORIGINAL_COMMENT_PREVIEW}_

${STATUS_EMOJI} **${ACTION_TEXT}**

${DETAILS_TEXT}
```

This template is used by the shell when building the reply body, not rendered directly. The script will perform its own variable substitution — the template serves as documentation of the reply format structure.

**Format specification:**

| Variable                      | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `${ORIGINAL_COMMENT_PREVIEW}` | First ~80 chars of the original comment (single line) |
| `${STATUS_EMOJI}`             | ✅ for fixed, ⏭️ for skipped                           |
| `${ACTION_TEXT}`              | "Fix Applied" or "Skipped"                            |
| `${DETAILS_TEXT}`             | Explanation of what was done or why it was skipped    |

**Example fixed reply:**

```
> _Please rename the function `handleClickBtn` to `handleSubmit` for clarity_

✅ **Fix Applied**

Renamed `handleClickBtn` to `handleSubmit` in `src/auth/route.ts` to better reflect its purpose.
```

**Example skipped reply:**

```
> _Should we also add rate-limiting to this endpoint?_

⏭️ **Skipped**

Out of scope for this PR — rate-limiting is tracked in INT-789 and will be addressed separately.
```

- [ ] **Step 2: Create the template file**

```markdown
## 😄 Action Taken

> _${ORIGINAL_COMMENT_PREVIEW}_

${STATUS_EMOJI} **${ACTION_TEXT}**

${DETAILS_TEXT}
```

---

### Task 3: Update Workflow to Reply After Each Comment

**Files:**
- Modify: `.claude/skills/nitpick-nuker/workflows/triage-pr-comments.md`

- [ ] **Step 1: Add a new Step 3e between existing Step 3c and Step 3d**

After the existing **3c. Execute Decision** section and before **3d. Mark as Processed**, insert:

```markdown
### 3e. Reply to Comment

**After processing each comment, post a reply explaining the outcome.** This gives comment authors immediate visibility into what was done and why.

Build the reply message:

```bash
# For FIX:
REPLY_MESSAGE="$(cat <<'EOF'
## 😄 Action Taken

> _$(echo "$COMMENT_BODY" | head -c 80 | tr '\n' ' ' | sed 's/"/\\"/g')..._

✅ **Fix Applied**

${CHANGE_DESCRIPTION}
---
_This comment has been automatically processed by Nitpick Nuker._
EOF
)"

# For SKIP:
REPLY_MESSAGE="$(cat <<'EOF'
## 😄 Action Taken

> _$(echo "$COMMENT_BODY" | head -c 80 | tr '\n' ' ' | sed 's/"/\\"/g')..._

⏭️ **Skipped**

${SKIP_REASON}
---
_This comment has been automatically processed by Nitpick Nuker._
EOF
)"
```

Post the reply:

```bash
# IMPORTANT: Must run from repo root for script path to work
"$SKILL_DIR/scripts/reply-to-comment.sh" "<comment_type>" "<comment_id>" "<pr_number>" "$REPLY_MESSAGE"
```

**Important:** Post the reply BEFORE adding the 😄 reaction. This ensures the reply is visible before the comment gets marked as processed.
```

- [ ] **Step 2: Update Step 3d to mention replies**

Change the existing Step 3d heading description to clarify ordering:

**Before:**
```
### 3d. Mark as Processed
```

**After:**
```
### 3d. Mark as Processed (after reply is posted)
```

- [ ] **Step 3: Update the workflow's "Completion" section**

Add that replies are posted:

**Before:**
```
After successful run:

1. All processed comments have 😄 reaction
2. Summary comment posted to PR
3. CI is green
4. Report: "Processed X comments (Y fixed, Z skipped). CI passing. ✅"
```

**After:**
```
After successful run:

1. All processed comments have a reply explaining the action taken
2. All processed comments have 😄 reaction
3. Summary comment posted to PR
4. CI is green
5. Report: "Processed X comments (Y fixed, Z skipped). CI passing. ✅"
```

---

### Task 4: Update SKILL.md Scripts Reference Table

**Files:**
- Modify: `.claude/skills/nitpick-nuker/SKILL.md`

- [ ] **Step 1: Add the new script to the scripts table**

**Before:**
```markdown
| Script                          | Purpose                              |
| ------------------------------- | ------------------------------------ |
| `fetch-unprocessed-comments.sh` | Fetch comments without 😄 from bot   |
| `add-reaction.sh`               | Add 😄 reaction to processed comment |
| `post-summary.sh`               | Post summary comment to PR           |
| `watch-ci.sh`                   | Watch CI with workflow filtering     |
```

**After:**
```markdown
| Script                          | Purpose                              |
| ------------------------------- | ------------------------------------ |
| `fetch-unprocessed-comments.sh` | Fetch comments without 😄 from bot   |
| `add-reaction.sh`               | Add 😄 reaction to processed comment |
| `reply-to-comment.sh`           | Post per-comment reply with fix/skip |
| `post-summary.sh`               | Post summary comment to PR           |
| `watch-ci.sh`                   | Watch CI with workflow filtering     |
```

---

### Verification

- [ ] **Step 1: Verify all file paths exist after changes**

```bash
ls -la .claude/skills/nitpick-nuker/scripts/reply-to-comment.sh
ls -la .claude/skills/nitpick-nuker/templates/inline-reply.md
grep -c "reply-to-comment" .claude/skills/nitpick-nuker/SKILL.md
grep -c "3e" .claude/skills/nitpick-nuker/workflows/triage-pr-comments.md
```

- [ ] **Step 2: Verify `pnpm run ci:tracked` passes**

```bash
pnpm run ci:tracked
```

---

## Summary of Changes

| File                              | Change                                                   |
| --------------------------------- | -------------------------------------------------------- |
| `scripts/reply-to-comment.sh`     | **New** — Posts API reply to any comment type            |
| `templates/inline-reply.md`       | **New** — Reply format template                          |
| `workflows/triage-pr-comments.md` | **Modified** — Add Step 3e (reply), adjust step ordering |
| `SKILL.md`                        | **Modified** — Add script to reference table             |
