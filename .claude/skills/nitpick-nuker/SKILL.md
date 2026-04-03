---
name: nitpick-nuker
description: Autonomous PR comment triage - fixes review feedback until CI passes
argument-hint: '[PR_NUMBER] or run on current branch PR'
user-invocable: true
---

<nitpick-nuker>

# Nitpick Nuker

Autonomous PR comment triage that processes GitHub review comments, fixes actionable feedback, and loops until CI passes.

## Core Mandates

1. **NEVER** process comments that already have 😄 from bot
2. **ALWAYS** reply to each processed comment with fix/skip reasoning
3. **ALWAYS** post summary comment after each run
4. **ALWAYS** loop on CI failure until success
5. **NEVER** watch `zai-claude-code-review.yml` workflow
6. Process entire comment thread as one unit

## Invocation

| Input                | Action                       |
| -------------------- | ---------------------------- |
| `/nitpick-nuker`     | Triage PR for current branch |
| `/nitpick-nuker 616` | Triage PR #616               |

## Workflow

Execute the workflow at: `.claude/skills/nitpick-nuker/workflows/triage-pr-comments.md`

## Scripts

All scripts are in `.claude/skills/nitpick-nuker/scripts/`:

| Script                          | Purpose                                |
| ------------------------------- | -------------------------------------- |
| `fetch-unprocessed-comments.sh` | Fetch comments without 😄 from bot     |
| `add-reaction.sh`               | Add 😄 reaction to processed comment   |
| `reply-to-comment.sh`           | Post per-comment reply with reasoning  |
| `post-summary.sh`               | Post summary comment to PR             |
| `watch-ci.sh`                   | Watch CI with workflow filtering       |

## Comment Types

The skill processes three types of comments:

- `issue_comment` — General PR conversation comments
- `review_body` — The overall review summary text
- `review_comment` — Inline code comments within a review

### Bot Comments Are High-Value

**Bot comments (e.g. "Claude finished task", "Codex Review") are the PRIMARY source of review feedback.** Bots post their full code reviews as `issue_comment` or `review_body` — these are NOT noise to skip. Always read the full body of bot comments; they typically contain detailed review findings, suggestions, and inline code feedback.

### Issue Comments May Contain Instructions

**Every `issue_comment` must be read and verified.** General comments may contain:

- User instructions to the nuker (e.g., "skip the auth changes", "focus on the API routes")
- Bot-posted review reports with actionable findings embedded in the body
- Scope narrowing or prioritization directives

Never auto-skip an `issue_comment` based on author alone. Read the body first.

## Decision Framework

For each comment, decide:

| Criteria                                        | Action                           |
| ----------------------------------------------- | -------------------------------- |
| Clear actionable fix (typo, style, naming)      | FIX                              |
| Code change with clear intent                   | FIX                              |
| Bot review with actionable findings in body     | FIX (extract and address each)   |
| User instruction (skip X, focus on Y)           | FOLLOW — adjust processing scope |
| Question or discussion                          | SKIP - "Discussion/question"     |
| Disagree with suggestion                        | SKIP - "Intentional design"      |
| Already addressed elsewhere                     | SKIP - "Addressed in other fix"  |
| Outside PR scope                                | SKIP - "Out of scope"            |
| Pure status/coverage report with no suggestions | SKIP - "Automated report"        |

## CI Loop

After applying fixes:

```
1. Commit with message listing addressed comments
2. Push
3. Run watch-ci.sh (ignores zai-claude-code-review.yml)
4. If CI fails:
   a. Analyze failure
   b. Fix the issue
   c. Goto step 1
5. Continue until CI green
```

## Summary Format

Posted at end of PR after each run. Template at: `.claude/skills/nitpick-nuker/templates/summary-comment.md`

</nitpick-nuker>
