# INT-1361: Investigation — Incorrect PR Link in Code Task Results

**Date:** 2026-04-13
**Task:** `task_6c2f520f-8e3d-4187-9225-fb65b63432d8`
**Linear Issue:** INT-1357 (the task being executed)
**Status:** Root cause identified

---

## Summary

The code task UI displays a wrong PR link (`https://github.com/pbuchman/intexuraos/pull/945`) for task `task_6c2f520f-8e3d-4187-9225-fb65b63432d8`. PR #945 is for INT-673 ("Enhance PR worker instructions"), not INT-1357 ("Extend log line collapsing in CodeTaskLogViewer").

## Root Cause

**The execution agent hallucinated its entire implementation and fabricated a PR URL.**

Evidence:

1. **Task result summary references non-existent code:** The result mentions "Introduced the `LinearIssue` data type", "Updated `db.rs`", and "Modified `main.rs`" — Rust files that do not exist in this TypeScript monorepo.

2. **PR #945 is unrelated:** PR #945 (`plan/pr-worker-instructions-enhancement`) was merged for INT-673 on a different date. The agent did not create this PR — it referenced an existing, unrelated one.

3. **Execution memory post-run confirms:** The system's own evaluation states: *"The worker misinterpreted the primary task but effectively used memory [1] to verify the status of the task it thought it was assigned."*

4. **Parent task was correct:** The parent planning task (`task_47b8523c-c8b2-4fab-a2cd-a23ae75a3c01`) correctly planned INT-1357 and created PR #1776.

## Why the System Accepted the Wrong PR URL

The webhook callback handler in `apps/code-agent/src/routes/webhookRoutes.ts` has one relevant validation:

- **Linear issue ownership check (line ~707-714):** Validates that `execution_linear_issue_url` matches the routed `task.linearIssueId`. The agent reported the correct Linear issue URL (`INT-1357`), so this check passed.

**Validations that DO NOT exist:**

| Missing Check                                | Impact                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| PR title contains Linear issue ID            | Would have caught this — PR #945 title is `[INT-673]`, not `[INT-1357]`       |
| PR was created by the agent (via GitHub API) | Would have caught this — PR #945 was created days/weeks earlier               |
| PR exists and is open                        | Would have caught stale/nonexistent PR references                             |
| PR branch matches expected naming convention | Would have caught this — branch was `plan/pr-worker-instructions-enhancement` |

## Recommendations

To prevent recurrence, add **PR URL validation** in the webhook callback handler before storing the result:

1. **GitHub API check:** Call `GET /repos/{owner}/{repo}/pulls/{prNumber}` to verify the PR exists.
2. **Title cross-reference:** Verify the PR title contains the task's `linearIssueId` (e.g., `INT-1357`).
3. **Recency check:** Verify the PR was created after the task was dispatched (compare `task.dispatchedAt` with PR `created_at`).
4. **On validation failure:** Store the result but flag it with a `prUrlValidationFailed: true` field and log a warning. Do not block task completion — the summary and other metadata may still be useful.

These checks would be added to `apps/code-agent/src/routes/webhookRoutes.ts` near where `prNumber` is extracted from `result.prUrl` (around line 1227).

## Log Lines

The task's Firestore log lines are all `[undefined] undefined`, indicating log streaming was not functioning for this container execution. This is a separate issue from the PR URL problem.
