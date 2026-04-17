# INT-1391: Set ready-to-merge label on execution task completion with code review pass

## Summary

When an execution task completes with `execution_superpowers_requesting_code_review_used='1'`, the `ready-to-merge` label should be set on the associated Linear issue. Currently, the label is only set when an external `review` agent task completes with `needs_remediation='0'`, but the internal code review skill approval bypasses this path.

## Problem

INT-1390 (Enable tracking and display of LLM prompt type for each call) completed successfully:
- Planning task completed
- Execution task completed with 10 commits, PR created
- Code review skill (`superpowers:requesting-code-review`) was invoked and passed
- Task status: `implemented`

However, no `ready-to-merge` label was set on the Linear issue. The task group shows no merge action in the UI.

## Root Cause

The `ready-to-merge` label is set via `applyReadyToMergeLabel()` in `webhookRoutes.ts` only through two paths:

1. **Review task completion** (lines 1520-1529): When a `review` agent task completes with `needs_remediation='0'`
2. **Remediation completion** (lines 1653-1660): When a `remediation` agent completes with `requires_re_review='0'` and `execution_outcome_label='already_completed'`

The `superpowers:requesting-code-review` skill approval does NOT trigger either path. It's purely an internal execution agent quality gate with no webhook label application.

## Solution

Add a third path to set `ready-to-merge` label when execution task completes with the code review skill passing:

### Implementation Steps

1. **Modify `webhookRoutes.ts` execution completion handler** (after line 1178):
   - After successful `enforceExecutionOutcome` for `execution` agent
   - Check if `result.execution_superpowers_requesting_code_review_used === '1'`
   - Extract `prNumber` from `result.prUrl`
   - Call `applyReadyToMergeLabel(prNumber)` if conditions are met

2. **Add test coverage** for the new path in `webhooks.test.ts`:
   - Test execution completion with code review skill used
   - Verify `ready-to-merge` label is applied
   - Test guard: planning-origin task should NOT get label (already handled by existing guard)

3. **Update documentation** in `labelHelpers.ts` comments to reflect the new path

### Code Location

File: `apps/code-agent/src/routes/webhookRoutes.ts`

Insert after line 1178 (after execution enforcement succeeds and before the task update):

```typescript
// Apply ready-to-merge label when execution completes with code review skill passing
// This bridges the gap between the internal review skill and the external review webhook path
if (
  result.execution_superpowers_requesting_code_review_used === '1' &&
  prNumber !== undefined
) {
  await applyReadyToMergeLabel(prNumber);
}
```

Note: The `prNumber` extraction happens later (line 1431), so this needs to be moved earlier or the label call needs to be moved after the extraction.

### Alternative Placement

Better placement: After line 1529 (where review label is applied) with a condition for execution tasks:

```typescript
// Execution task with internal code review: set ready-to-merge when review skill passed
if (
  task.agentType === 'execution' &&
  result?.execution_superpowers_requesting_code_review_used === '1' &&
  prNumber !== undefined
) {
  await applyReadyToMergeLabel(prNumber);
}
```

### Endpoint Changes

| Endpoint                              | Status   | Notes                                                                         |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| POST /internal/webhooks/task-complete | Modified | Adds `applyReadyToMergeLabel` call for execution tasks with code review skill |

### Edge Cases

1. **Planning-origin tasks**: The existing guard in `applyReadyToMergeLabel` (lines 406-435) handles this - it auto-merges the plan PR instead of setting the label
2. **Already merged PR**: The existing guard (lines 363-396) handles this - skips label if PR already merged
3. **No Linear issue**: The existing guard (lines 460-463) handles this - skips label if no Linear issue found

## Verification

- Run `pnpm run ci:tracked` after implementation
- Test with execution task that has `execution_superpowers_requesting_code_review_used='1'`
- Verify `ready-to-merge` label appears on the Linear issue
- Verify merge action appears in the task group UI