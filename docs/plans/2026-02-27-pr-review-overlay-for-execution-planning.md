# PR Review Overlay for Execution and Planning Prompts

**Date:** 2026-02-27
**Status:** Design approved

## Problem

When a PR review arrives for a task originally created as `execution` (or `planning`), the `sendMessage()` resume path rebuilds the system prompt from stored task metadata. The stored `agentType` is `'execution'` and `linearIssueLabels` has no `'pr-comment'` label, so `buildSystemPrompt()` routes to `buildExecutionPrompt()` — which has no PR-specific instructions (tracking comment, feedback gathering, emoji reactions).

The PR review instructions only exist in `buildPullRequestPrompt()`, which is only reached when `linearIssueLabels` contains `'pr-comment'`.

## Design Decision

**Approach: Always-On PR Overlay** — Append a conditional PR review section to every execution and planning system prompt. The agent (which is already an LLM) determines from message context whether to activate PR review behavior.

### Key Decisions

| Decision                   | Choice                                                                 | Rationale                                                                              |
| -------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Prompt strategy            | Inject into existing prompt (not replace)                              | Agent stays in execution/planning mode but gains PR awareness                          |
| Injection point            | Appended to system prompt (not resume preamble)                        | System prompt has higher priority for the model                                        |
| PR detection signal        | Context-aware intent detection by the agent                            | No explicit flags — agent uses natural language understanding                          |
| Detection scope            | All messages (webhook and manual) through same path                    | Uniform behavior, no special-casing                                                    |
| PR behaviors included      | All: tracking comment, feedback gathering, reactions, completion block | Full PR awareness when activated                                                       |
| Detection mechanism        | Always include overlay, let agent decide                               | Zero extra latency/cost — the agent is already an LLM                                  |

## Architecture

```
buildSystemPrompt(params)
  ├─ isPRComment label? → buildPullRequestPrompt()              // unchanged
  ├─ execution?         → buildExecutionPrompt() + buildPRReviewOverlay()
  └─ planning?          → buildPlanningPrompt()  + buildPRReviewOverlay()
```

### New Function: `buildPRReviewOverlay(params)`

Returns a conditional section appended to execution and planning prompts. Contains:

1. **Conditional activation preamble** — Explicit guidance on when to activate/ignore
2. **Intent detection guidance** — What constitutes a PR review message vs. passing mention
3. **Feedback gathering** — Mandatory 3-source gathering (PR reviews, PR comments, issue comments)
4. **Tracking comment** — Post initial comment, update on completion
5. **Completion block override** — Use `PULL_REQUEST_AGENT_FINAL` instead of normal block

### Overlay Content

```
[PR REVIEW MODE — CONDITIONAL]

If the incoming message is about a PR review, code review feedback, PR comment,
or any request to address changes on a pull request, activate the behaviors below.
If the message is NOT about PR feedback, IGNORE this entire section and use your
normal completion block above.

### Detecting PR Review Intent

Activate this section when the message:
- Contains PR review content (review state, inline comments, change requests)
- Asks you to address PR feedback or review comments
- References specific code review findings to fix

Do NOT activate when the message merely mentions a previous review in passing
or asks a general question that happens to reference a PR.

### Gathering Feedback (MANDATORY when activated)

Search ALL of these sources:
1. PR reviews — gh api /repos/{owner}/{repo}/pulls/{pr_number}/reviews
2. PR comments (review-level and inline) — gh api /repos/{owner}/{repo}/pulls/{pr_number}/comments
3. Issue comments — gh api /repos/{owner}/{repo}/issues/{pr_number}/comments

All three are MANDATORY. Skipping any source means missing feedback.

### Tracking Comment (MANDATORY when activated)

FIRST action: post a tracking comment on the PR with what you plan to do.
LAST action: update the same comment with what you actually did.

### Completion Block Override

When PR Review Mode is active, use PULL_REQUEST_AGENT_FINAL instead of normal block.
```

## Completion Block Handling

Both the base prompt and overlay define completion blocks. The agent picks one:

| Message type      | Completion block                            |
| ----------------- | ------------------------------------------- |
| Normal message    | Base block (EXECUTION/PLANNING_AGENT_FINAL) |
| PR review message | PULL_REQUEST_AGENT_FINAL                    |

The overlay explicitly states: "Use this completion block INSTEAD of your normal one."

## Error Handling

- **No PR number in context:** Agent checks `gh pr view --json number` to find associated PR
- **No PR exists:** Skip tracking comment, note in summary
- **False positive (misidentified as PR review):** Harmless — posts a tracking comment and gathers feedback

## Changes

| File                                                      | Change                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `workers/orchestrator/src/services/system-prompt.ts`      | Add `buildPRReviewOverlay()`, append to execution + planning |
| `workers/orchestrator/src/services/system-prompt.test.ts` | Tests for overlay presence/absence                           |

## What Does NOT Change

- `sendMessage()` flow — no parameter changes
- `startWorkerAttempt()` — no parameter changes
- `buildSystemPrompt()` routing logic — `pr-comment` label still routes to dedicated PR prompt
- Code-agent webhook dispatch — no API changes
- Resume preamble — stays as-is

## Testing Strategy

1. **Unit tests for `buildPRReviewOverlay()`** — returns expected section with correct taskUrl interpolation
2. **Integration tests for `buildSystemPrompt()`:**
   - Execution prompt includes the overlay
   - Planning prompt includes the overlay
   - PR prompt does NOT include the overlay (redundant)
3. **Existing tests** — overlay is additive, shouldn't break assertions
