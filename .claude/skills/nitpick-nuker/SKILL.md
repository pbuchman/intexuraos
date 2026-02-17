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

1. **NEVER** process comments that already have 🚀 from bot
2. **ALWAYS** post summary comment after each run
3. **ALWAYS** loop on CI failure until success
4. **NEVER** watch `zai-claude-code-review.yml` workflow
5. Process entire comment thread as one unit

## Invocation

| Input                | Action                       |
| -------------------- | ---------------------------- |
| `/nitpick-nuker`     | Triage PR for current branch |
| `/nitpick-nuker 616` | Triage PR #616               |

## Workflow

Execute the workflow at: `.claude/skills/nitpick-nuker/workflows/triage-pr-comments.md`

## Scripts

All scripts are in `.claude/skills/nitpick-nuker/scripts/`:

| Script                          | Purpose                              |
| ------------------------------- | ------------------------------------ |
| `fetch-unprocessed-comments.sh` | Fetch comments without 🚀 from bot   |
| `add-reaction.sh`               | Add 🚀 reaction to processed comment |
| `post-summary.sh`               | Post summary comment to PR           |
| `watch-ci.sh`                   | Watch CI with workflow filtering     |

## Comment Types

The skill processes three types of comments:

- `issue_comment` — General PR conversation comments
- `review_body` — The overall review summary text
- `review_comment` — Inline code comments within a review

## Decision Framework

For each comment, decide:

| Criteria                                   | Action                          |
| ------------------------------------------ | ------------------------------- |
| Clear actionable fix (typo, style, naming) | FIX                             |
| Code change with clear intent              | FIX                             |
| Question or discussion                     | SKIP - "Discussion/question"    |
| Disagree with suggestion                   | SKIP - "Intentional design"     |
| Already addressed elsewhere                | SKIP - "Addressed in other fix" |
| Outside PR scope                           | SKIP - "Out of scope"           |

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
