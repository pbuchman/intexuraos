# Triage PR Comments Workflow

## Pre-flight Checks

```bash
# 1. Verify gh CLI is authenticated
gh auth status

# 2. Verify we're in a git repo
git rev-parse --is-inside-work-tree

# 3. CRITICAL: Ensure working directory is repo root
# Scripts use relative paths from repo root
cd "$(git rev-parse --show-toplevel)"
```

## Step 1: Determine PR Number

```bash
# If argument provided, use it
PR_NUMBER="${1:-}"

# Otherwise, get from current branch
if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr view --json number --jq '.number' 2>/dev/null)
  if [ -z "$PR_NUMBER" ]; then
    echo "ERROR: No PR found for current branch"
    exit 1
  fi
fi

echo "Processing PR #$PR_NUMBER"
```

## Step 2: Fetch Unprocessed Comments

```bash
# Run from repo root (scripts use relative paths)
SKILL_DIR=".claude/skills/nitpick-nuker"
COMMENTS_JSON=$("$SKILL_DIR/scripts/fetch-unprocessed-comments.sh" "$PR_NUMBER")

# Check if any comments to process
COMMENT_COUNT=$(echo "$COMMENTS_JSON" | jq 'length')
if [ "$COMMENT_COUNT" -eq 0 ]; then
  echo "No unprocessed comments found. All caught up! 🎉"
  exit 0
fi

echo "Found $COMMENT_COUNT unprocessed comments"
```

## Step 3: Process Each Comment

For each comment in the JSON array:

### 3a. Read the Full Comment Body

**Every comment must be read in full — including bot comments.** Bot comments (claude[bot], codex-connector[bot], etc.) are the PRIMARY delivery mechanism for code reviews. Their bodies contain detailed findings, suggestions, and inline feedback.

**Issue comments may contain user instructions** that modify processing scope (e.g., "skip auth changes", "only focus on the API"). Extract and follow these directives before processing other comments.

Determine:

- **Is this a user instruction?** → Follow it, adjust scope for remaining comments
- **Is this a bot review with embedded findings?** → Extract each finding, process individually
- **What is being requested?**
- **Is this actionable?**
- **Can this be fixed in the current codebase?**

### 3b. Make Decision

| Decision   | Criteria                                                   |
| ---------- | ---------------------------------------------------------- |
| **FIX**    | Clear, actionable feedback that can be implemented         |
| **FIX**    | Bot review finding with specific code change suggestion    |
| **FOLLOW** | User instruction — adjust processing scope accordingly     |
| **SKIP**   | Discussion, question, disagreement, or out of scope        |
| **SKIP**   | Pure status/coverage report with no actionable suggestions |

### 3c. Execute Decision

**If FIX:**

1. Make the code change
2. Track: `{ id, type, author, action: "fixed", details: "what was changed" }`

**If SKIP:**

1. Document reason
2. Track: `{ id, type, author, action: "skipped", reason: "why skipped" }`

### 3e. Reply to Comment

**After processing each comment, post a reply explaining the outcome.** This gives comment authors immediate visibility into what was done and why.

Build the reply message using this format:

**For FIX:**
```
## 😄 Action Taken

> _<first ~80 chars of original comment>..._

✅ **Fix Applied**

<description of what was changed>

---
_Automatically processed by Nitpick Nuker._
```

**For SKIP:**
```
## 😄 Action Taken

> _<first ~80 chars of original comment>..._

⏭️ **Skipped**

<reason for skipping>

---
_Automatically processed by Nitpick Nuker._
```

Post the reply:

```bash
# IMPORTANT: Must run from repo root for script path to work
"$SKILL_DIR/scripts/reply-to-comment.sh" "<comment_type>" "<comment_db_id>" "<pr_number>" "$REPLY_MESSAGE"
```

**Important:** Post the reply BEFORE adding the 😄 reaction. This ensures the reply is visible before the comment gets marked as processed.

### 3d. Mark as Processed (after reply is posted)

```bash
# Add 😄 reaction to mark as processed
# IMPORTANT: Must run from repo root for script path to work
"$SKILL_DIR/scripts/add-reaction.sh" "<comment_type>" "<comment_id>"
```

**IMPORTANT:** Add reaction AFTER processing, not before. This ensures we don't lose track if interrupted.

## Step 4: Run Local CI Verification

**CRITICAL: Run `pnpm run ci:tracked` BEFORE committing to catch issues early.**

```bash
# Run full CI locally - this catches 90% of issues before push
pnpm run ci:tracked 2>&1 | tee /tmp/ci-local-$(date +%H%M%S).txt

# If CI fails, fix the issue before proceeding
# Check the output file for errors:
# rg "error|FAIL" /tmp/ci-local-*.txt -C3
```

## Step 5: Commit and Push (if fixes applied AND local CI passes)

```bash
# Only if we made fixes AND local CI passed
if [ "$FIXES_APPLIED" -gt 0 ]; then
  # Stage all changes
  git add -A

  # Commit with descriptive message
  git commit -m "$(cat <<'EOF'
Address PR review comments

Fixed:
- [list of fixed items with comment refs]

Skipped:
- [list of skipped items with reasons]
EOF
)"

  # Push
  git push
fi
```

## Step 6: Watch Remote CI

```bash
# Watch CI using gh pr checks (built-in streaming)
# This is more reliable than custom watch script
gh pr checks "$PR_NUMBER" --watch

# Check final status
gh pr checks "$PR_NUMBER" --json name,state | jq -r '.[] | "\(.name): \(.state)"' | grep -v SKIPPED
```

**Note:** The `--watch` flag provides real-time streaming updates and handles all edge cases.

**If CI fails:**

1. Analyze: `gh run view <run-id> --log-failed`
2. Fix the issue
3. Commit and push
4. Watch again

## Step 7: Post Summary

### 7a. Generate Roast Line

Before building the summary JSON, generate a savage one-liner roast about the PR code.

**Rules for the roast:**

- One sentence, max 150 characters
- Savage and brutally honest, but ultimately funny — think code roast, not personal attack
- Reference something specific from the PR: a pattern you saw, the number of nitpicks, the quality of the code, or a funny observation from the review
- Never repeat a previous roast — each run must be unique
- Escape double quotes for JSON safety

Store the result in `$ROAST_LINE`. Example roasts:

- "I've seen better error handling in a fortune cookie."
- "This code has more unnecessary comments than a YouTube section."
- "5 nitpicks in 200 lines — that's a nitpick every 40 lines, which is honestly impressive."

### 7b. Build Summary JSON

```bash
# Create summary JSON
SUMMARY_JSON=$(cat <<EOF
{
  "pr_number": "$PR_NUMBER",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "commit_sha": "$(git rev-parse --short HEAD)",
  "roast_line": "$ROAST_LINE",
  "fixed": $FIXED_ARRAY,
  "skipped": $SKIPPED_ARRAY
}
EOF
)

# Save to temp file
echo "$SUMMARY_JSON" > /tmp/nitpick-summary.json

# Post summary comment
"$SKILL_DIR/scripts/post-summary.sh" "$PR_NUMBER" /tmp/nitpick-summary.json
```

Summary format requirement (mandatory):

- Use GitHub Markdown tables with exactly one row per line.
- Keep table header + separator contiguous (no text between them).
- Keep separator + first data row contiguous (no blank line before `${FIXED_ROWS}`/`${SKIPPED_ROWS}`).
- Escape any `|` in cell text as `\|` and flatten newlines in cells to spaces.
- Post using `gh pr comment --body-file` to preserve line breaks exactly.

Canonical shape:

```md
## 😄 Nitpick Nuker Report

> _<savage roast line about the PR code>_

**PR:** #<number> | **Run:** <iso8601> | **Commit:** `<sha>`

### ✅ Fixed (<count>)

| Comment     | Author | Action    |
| ----------- | ------ | --------- |
| [view](...) | @user  | Fixed ... |

### ⏭️ Skipped (<count>)

| Comment     | Author | Reason                                                |
| ----------- | ------ | ----------------------------------------------------- |
| [view](...) | @user  | Historical thread; no branch-specific action required |

---

**Status:** All comments addressed — good to merge ✅
```

## Data Structures

### Comment JSON (from fetch script)

```json
{
  "id": "IC_123456",
  "type": "issue_comment",
  "author": "reviewer1",
  "body": "Please fix this typo",
  "url": "https://github.com/...",
  "createdAt": "2026-02-05T10:00:00Z",
  "path": null,
  "line": null
}
```

### Processing Result

```json
{
  "id": "IC_123456",
  "type": "issue_comment",
  "author": "reviewer1",
  "action": "fixed",
  "details": "Fixed typo in README.md"
}
```

Or for skipped:

```json
{
  "id": "IC_123456",
  "type": "issue_comment",
  "author": "reviewer1",
  "action": "skipped",
  "reason": "Discussion question - no action needed"
}
```

## Error Handling

| Error                             | Recovery                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `gh auth` fails                   | Prompt user to run `gh auth login`                                            |
| No PR for branch                  | Error with message to provide PR number                                       |
| Script not found                  | Verify working directory is repo root (`cd $(git rev-parse --show-toplevel)`) |
| API rate limit                    | Wait and retry with exponential backoff                                       |
| CI keeps failing                  | After 3 attempts, stop and report                                             |
| `gh pr checks --json` field error | Use only valid fields: `name`, `state`, `workflow` (not `conclusion`)         |

## Completion

After successful run:

1. All processed comments have a reply explaining the action taken
2. All processed comments have 😄 reaction
3. Summary comment posted to PR
4. CI is green
5. Report: "Processed X comments (Y fixed, Z skipped). CI passing. ✅"
