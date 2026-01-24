# Random Todo Workflow (Cron Mode)

**Trigger:** User calls `/linear` with no arguments.

## Non-Interactive Contract (MANDATORY)

**This mode operates WITHOUT user interaction. The following rules are absolute:**

| Rule             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| **NO PROMPTS**   | Never ask "what should I do?", "which task?", or "ready to start?"           |
| **AUTO-PROCEED** | Always proceed with the selected Todo item automatically                     |
| **NO TASKS**     | If Todo state is empty, print message and exit gracefully                    |
| **BLOCKER PR**   | If task cannot be completed, create PR with explanation and consider it done |

**The command is designed for automated/cron usage. It MUST NOT block on user input.**

## Selection Algorithm

```
1. List issues where state is "Todo" (NOT from Backlog)
2. Filter to team: "pbuchman"
3. Sort by priority (High → Low) then createdAt (newest first)
4. Pick first result
5. If no items: Print "No items in Todo state." and exit
```

## Execution Steps

```
1. Verify tools (Linear, GitHub, GCloud) - fail fast if unavailable
2. Fetch selected issue details
3. Update Linear state to "In Progress" (CRITICAL: DO THIS FIRST)
4. Create branch from origin/development (or origin/main)
5. Implement the task (investigate, code, test)
6. Run CI gate: pnpm run ci:tracked
7. Merge latest base branch (resolve conflicts if any)
8. Create PR with cross-links (or PR explaining blocker if task uncompletable)
9. Update Linear state to "In Review"
```

## State Update Priority

**CRITICAL:** You MUST update the Linear issue state to "In Progress" BEFORE:

- Reading any code
- Planning implementation
- Investigating the issue
- Running any commands

This signals that work has begun and prevents duplicate work.

## Branch Selection Logic

```bash
git fetch origin
if git ls-remote --heads origin development | grep -q development; then
  BASE_BRANCH="origin/development"
else
  BASE_BRANCH="origin/main"
fi

git checkout -b fix/INT-123 "$BASE_BRANCH"
```

## When No Todo Items

**NON-INTERACTIVE:** Exit gracefully with message: "No items in Todo state."

- Do NOT ask to create a new issue
- Do NOT ask what to do instead
- Do NOT pick from Backlog state
- Simply print the message and exit

## Blocker Handling

When task cannot be completed (auth failure, missing info, blockers):

1. Create a PR explaining the blocker
2. The PR serves as the deliverable documenting what needs to be resolved
3. Include all investigation findings in the PR body
4. Update Linear state to "In Review" and move on
