# Remediation Agent & Review Loop Improvements — Design Spec

**Date:** 2026-03-25
**Service:** code-agent, orchestrator (prompt only)
**Linear:** INT-1087

## Overview

Introduce a new `agentType=remediation` that handles review feedback fixes and `@worker`/`@model`-annotated comments. Remediation tasks always run in a fresh container with the requested (or default) model, eliminating session degradation and model-directive-ignore bugs. Alongside this, improve the review loop: re-reviews get diff-focused prompts with prior review context, and synchronize events from remediation pushes consult a `requiresReReview` flag before auto-triggering reviews.

## Problem

Six interconnected issues identified via investigation of PR #1443 (5 review passes, none addressed):

1. **Unbounded review re-triggering:** Every `pull_request.synchronize` auto-triggers a new review. PR #1443 got 5 reviews, PR #1440 got 7. No exit condition.
2. **Reviews re-flag already-addressed issues:** Each review starts from scratch with no memory of prior passes. Review 5 on PR #1443 says "flagged in 5 consecutive reviews" for the same finding.
3. **Dead enforcement cap:** `unifiedEvaluator.ts:82-100` checks `ruleOutcome.reason === 'CODE_WORKER_REVIEW'` but the rule chain always returns `'ALL_RULES_PASSED'`. Cap never fires. Confirmed by Firestore: all 5 decisions show `reason=ALL_RULES_PASSED`.
4. **Worker model bypasses nitpick-nuker:** MiniMax-M2.7 received "Run /nitpick-nuker 1443" but ran ad-hoc `gh api` instead of invoking the skill. Returned 0 unprocessed comments incorrectly.
5. **Session degradation:** Execution task resumed 5 times over 7 hours, accumulating 118M tokens / 1067 API calls. Model followed instructions on early resumes, bypassed them on later ones.
6. **`@worker`/`@model` silently ignored:** `handleExistingTask()` in dispatch service ignores `@worker`/`@model` directives — sends message to existing task with its original worker. Confirmed: `@worker opus` comment on PR #1443 (minimax execution task) ran on minimax, not opus.

## Solution

### New Agent Type: `remediation`

| Property        | Value                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `agentType`     | `'remediation'`                                                                                               |
| Container       | Always new — never resume an existing session                                                                 |
| Model           | Requested via `@worker`/`@model` directive, or user's default worker                                          |
| Session         | Fresh — no context carryover from execution task                                                              |
| Linear grouping | Same Linear issue as the execution task for this PR                                                           |
| UI visibility   | Shown in pipeline view alongside execution/review/plan                                                        |
| Prompt          | Purpose-built prompt with execution context, structured fix instructions, and `requiresReReview` output field |

### Three Dispatch Paths

| Trigger                                                       | Agent Type             | Container      | Model                    | Session   |
| ------------------------------------------------------------- | ---------------------- | -------------- | ------------------------ | --------- |
| Plain comment (no `@` annotations)                            | `execution` (existing) | Reuse existing | Original model           | Continue  |
| `@review` / webhook auto-review                               | `review`               | New            | Review worker config     | Fresh     |
| `@worker`/`@model` comment **OR** code-worker review dispatch | `remediation`          | **New**        | **Requested or default** | **Fresh** |

### Re-review Prompt Injection

When code-agent detects a prior `agentType=review` task exists for the same PR, it injects a re-review context block into the review prompt. This is enforced at the code-agent level during review task creation — not optional for the reviewer.

**Data required:**
- `lastReviewedCommitSha`: stored on `gitHubPRSummary` document, updated when a review task completes
- Last review body: fetched from GitHub API (`GET /repos/{owner}/{repo}/pulls/{pr}/reviews`, last entry)

**Prompt block (appended to review prompt for re-reviews only):**

```
## Re-review Context

This is re-review #{N} for this PR. Your review MUST focus on changes
since commit {lastReviewedCommitSha}.

### Previous Review Summary
{last review body verbatim}

### Review Scope
Commits since last review: {lastReviewedCommitSha}..HEAD

IMPORTANT: Do NOT re-flag findings from the previous review unless they
are still present in the new changes. If a finding was flagged before and
the relevant code has not changed in the diff, assume it is being tracked
separately. Focus your review on NEW code, CHANGED code, and whether
prior findings were correctly addressed.
```

### Synchronize Interception

When `pull_request.synchronize` arrives, the code-agent checks whether the push came from a remediation task before deciding to auto-trigger a review.

**Flow:**

```
pull_request.synchronize event arrives
  → Query codeTaskRepo for recent remediation tasks on this PR
    → Found active/recently-completed remediation task?
      → YES: check requiresReReview field on the remediation task
        → false  → SKIP auto-review (remediation determined no re-review needed)
        → true   → trigger re-review (with re-review context block)
        → not set (crash/timeout) → trigger re-review (safe default)
      → NO: trigger review as normal (current behavior, no changes)
```

**Detection heuristic:** A remediation task is considered the source of a synchronize event if:
- `agentType=remediation` AND `prNumber` matches AND task was active (status `running` or `implemented`) within the last 10 minutes

**The `requiresReReview` field:**
- Boolean field on the `code_tasks` document
- Set by the remediation task BEFORE pushing code (enforced in the remediation prompt)
- Read by the synchronize interception logic in the unified evaluator / LLM triage path
- Default when not set: `true` (safe — trigger re-review)

### Remediation Task Prompt

The remediation agent receives a purpose-built system prompt that includes:

1. **Execution context:** PR number, repository, branch, Linear issue ID, what the PR implements (from PR title/body)
2. **Review findings:** The review body that triggered this remediation, plus any inline comments
3. **Structured instructions:**
   - Fetch and process all unprocessed review comments (via `/nitpick-nuker` or direct implementation)
   - For each finding: implement fix OR document why it's out of scope
   - Run CI (`pnpm run ci:tracked`) and verify all checks pass
   - Set `requiresReReview` based on the nature of changes:
     - `true`: substantive changes that alter behavior, architecture, or public API
     - `false`: mechanical fixes (typos, formatting, straightforward bug fixes where the review specified the exact change)
   - Push changes and report summary
4. **Constraints:** Do not modify code unrelated to review findings. Do not expand scope.

### Cleanup

**Delete dead enforcement cap:** Remove lines 82-100 from `unifiedEvaluator.ts`. The `existsByPRAndReason` method on `EventDecisionRepository` can also be removed if no other callers exist.

**Fix `@worker`/`@model` silent-ignore bug:** The new dispatch path for `@worker`/`@model` comments (→ create remediation task) replaces the current `handleExistingTask()` path that silently drops the worker directive.

## Endpoint Changes

### Created

None (remediation tasks use the existing task creation and dispatch infrastructure).

### Modified

#### `POST /webhooks/github` (existing)

No route changes. The unified evaluator's decision logic changes:
- Code-worker `pull_request_review.submitted` events → create `remediation` task instead of sending nitpick-nuker message to existing execution task
- `@worker`/`@model` comments → create `remediation` task instead of routing to existing execution task
- `pull_request.synchronize` events → check for recent remediation task before auto-triggering review

### Removed

None.

### Unchanged

All other endpoints.

## Data Model Changes

### `code_tasks` collection

| Field              | Type       | Description                                                                           |
| ------------------ | ---------- | ------------------------------------------------------------------------------------- |
| `agentType`        | `string`   | Add `'remediation'` to allowed values (existing: `'execution'`, `'review'`, `'plan'`) |
| `requiresReReview` | `boolean \ | undefined`                                                                            | Set by remediation tasks before pushing. Read by synchronize interception. Only meaningful for `agentType=remediation`. |

### `github_pr_summaries` collection

| Field                   | Type      | Description   |
| ----------------------- | --------- | ------------- |
| `lastReviewedCommitSha` | `string \ | null`         | HEAD commit SHA at the time the most recent review task completed. Updated by review task completion handler. Used to construct diff range for re-review prompts. |

## Implementation Notes

### Dispatch Service Changes

The `dispatch()` method in `gitHubDispatchService.ts` currently has two paths:
- `handleExistingTask()` → send message to existing task
- `handleNewTask()` → create new task

For the remediation agent, the dispatch logic becomes:

```
if (event is code-worker review OR comment has @worker/@model):
  → ALWAYS create new remediation task (even if execution task exists)
  → Pass workerType from @worker directive (or from user's worker settings)
  → Link to same Linear issue as existing execution task
else if (plain comment, no annotations):
  → existing behavior: handleExistingTask() or handleNewTask()
```

This means `handleExistingTask()` is only used for plain, unannotated comments. All other dispatch paths create fresh tasks.

### Message Builder Changes

The `CodeWorkerNitpickNukerTemplate` in `gitHubMessageBuilder.ts` is no longer used for dispatching to the execution task. Instead, code-worker review content is passed as context to the new remediation task's prompt. The template can be removed or repurposed for the remediation prompt.

### Review Task Completion Handler

When a review task transitions to `reviewed` status, the completion handler must:
1. Update `lastReviewedCommitSha` on the PR summary with the current HEAD of the PR branch
2. This SHA is used by subsequent re-review prompts to construct the diff range

### Detecting Re-reviews

In `createReviewTask` use case:
1. Query `codeTaskRepo` for prior `agentType=review` tasks with the same `prNumber`
2. If any exist with status `reviewed` → this is a re-review
3. Fetch `lastReviewedCommitSha` from PR summary
4. Fetch last review body from GitHub API
5. Append re-review context block to the review prompt

### UI Changes

The web app's pipeline view needs to display `remediation` as a task type:
- Add `'remediation'` to the task type enum in the frontend
- Choose an appropriate icon/color for the pipeline card
- Group remediation tasks under the same Linear issue as execution tasks

### Firestore Collection Ownership

Per `firestore-collections.json`:
- `code_tasks` is owned by `code-agent` — new field `requiresReReview` added here
- `github_pr_summaries` is owned by `code-agent` — new field `lastReviewedCommitSha` added here

No new collections. No cross-service data access changes.

## Testing Strategy

### Unit Tests

1. **Dispatch routing:** Verify that code-worker review events create `remediation` tasks, not send messages to existing execution tasks
2. **`@worker`/`@model` routing:** Verify that annotated comments create `remediation` tasks with correct `workerType`
3. **Plain comment routing:** Verify that unannotated comments still route to existing execution task (no regression)
4. **Synchronize interception:** Verify that synchronize events check for recent remediation tasks and respect `requiresReReview`
5. **Re-review detection:** Verify that review task creation detects prior reviews and includes re-review context
6. **`lastReviewedCommitSha` update:** Verify that review task completion updates the PR summary
7. **Dead code removal:** Verify enforcement cap code is removed and tests pass

### Integration Tests

1. **End-to-end remediation flow:** Webhook → dispatch → remediation task created with correct `agentType`, `workerType`, and Linear issue link
2. **Re-review prompt construction:** Create review task for a PR with prior reviews → verify prompt includes last review body and diff SHA

## Out of Scope

- Changing the review agent's prompt structure beyond the re-review context block
- Modifying how `agentType=execution` tasks work (plain comments still route there)
- Adding a hard cap on review cycles (decided: not needed with structural fix)
- Changing the review worker selection logic (sonnet/opus assignment) — only remediation worker selection changes
- Orchestrator code changes (prompt-only changes for remediation task behavior)
