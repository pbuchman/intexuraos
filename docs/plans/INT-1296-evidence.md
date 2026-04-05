# INT-1296: Fix merge button not shown on unreviewed code tasks

> **Planning evidence** — created 2026-04-05

## Task Summary

The merge button does not appear on the code task list for tasks that complete execution with a PR but have no review dispatched (e.g., when LLM triage skips the review via `onReviewSkippedCallback`).

## Root Cause

Two conditions in `deriveAggregateStatusFromSummary` (`apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts`) prevent unreviewed-but-merge-ready tasks from reaching `needs-action` status:

### Bug 1: "Active" gate blocks merge-ready tasks (line 32)

```typescript
// Current (broken):
if (fields.hasCompletedExecutionAgent && fields.latestReviewNeedsRemediation !== false) {
  return 'active';
}
```

For unreviewed tasks:
- `hasCompletedExecutionAgent = true` (execution completed)
- `latestReviewNeedsRemediation = null` (no review task ever created)
- `hasMergeReadyLabel = true` (set by `onReviewSkippedCallback`)
- `null !== false` is `true` → returns `'active'` — the function exits early, merge button never shown

### Bug 2: Merge "needs-action" check requires review result (line 50)

```typescript
// Current (broken):
if (fields.hasPrUrl && fields.latestReviewNeedsRemediation === false && ...) {
  return 'needs-action';
}
```

Requires `latestReviewNeedsRemediation === false`, which is `null` for unreviewed tasks. Even if Bug 1 were fixed alone, this check would never match.

### Impact chain

1. `deriveAggregateStatusFromSummary` returns `'active'` → group summary persists `aggregateStatus: 'active'`
2. Group excluded from `needs-action` filter tab → user never sees it in the actionable view
3. Web app merge button also checks `aggregateStatus !== 'active'` as a rendering guard

## Fix (2 files)

### `apps/code-agent/src/domain/issueGrouping/deriveAggregateStatusFromSummary.ts`

**Line 32** — Add `hasMergeReadyLabel` exception to the active gate:

```typescript
if (fields.hasCompletedExecutionAgent && fields.latestReviewNeedsRemediation !== false && !(fields.hasMergeReadyLabel === true)) {
  return 'active';
}
```

**Line 50** — Change `=== false` to `!== true` to allow both `false` (review passed) and `null` (no review):

```typescript
if (fields.hasPrUrl && fields.latestReviewNeedsRemediation !== true && (fields.hasMergeReadyLabel ?? false)) {
  return 'needs-action';
}
```

### `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`

- Keep existing test (line 33-41) — still returns `'active'` when no label present
- Add test: "does not return active when execution completed, no review, but hasMergeReadyLabel is true"
- Update test (line 141-150) — now expects `'needs-action'` instead of NOT `'needs-action'`
- Add test: "returns needs-action for unreviewed task with PR and merge-ready label"

## Why `ready-to-merge` label is the authoritative signal

Set only by:
1. `onReviewSkippedCallback` — LLM triage skips review
2. Review completion handler — review says no remediation needed

Removed by:
- `handlePrClose` — PR closed/merged

So `hasMergeReadyLabel === true` reliably means "this task is merge-ready" whether or not a review existed.
