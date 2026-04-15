# Fix Missing Merge Label After "Already Completed" Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-apply the `ready-to-merge` label on a PR's Linear issue when a remediation task completes with `requires_re_review === '0'` and `execution_outcome_label === 'already_completed'`, so the Merge action reappears in the code-tasks list.

**Architecture:** Review-complete and remediation-complete callbacks in `webhookRoutes.ts` are asymmetric. A failing review (`needs_remediation='1'`) removes `ready-to-merge` (line 1519-1559). A subsequent remediation that concludes "all findings were already fixed, nothing new to push" (`requires_re_review='0'` + `already_completed`) persists `requiresReReview: false` on the task but does not re-apply the label. `derivePipeline` in `groupByLinearIssue.ts:92-102` gates the merge step on `hasMergeReadyLabel()`, so the UI never regains the Merge action. Fix is to add a symmetric label-apply branch for that specific remediation terminal state, and harden `derivePipeline` with an alternate unlock signal for label-propagation races.

**Tech Stack:** TypeScript, Fastify, Firestore, Linear API

**Linear issue:** INT-XXXX (TODO: ask user for issue ID before starting)

---

## Root Cause Analysis

### Observed case (INT-1376, PR #1819)

Chain of executions:

| #   | Task ID         | agentType   | Status      | Signal                                                                                                |
| --- | --------------- | ----------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| 7   | `task_5611695b` | review      | reviewed    | `needs_remediation='1'` → removed `ready-to-merge`                                                    |
| 8   | `task_dac74341` | remediation | implemented | `requires_re_review='1'` — fixed `pagehide`/`pageshow`                                                |
| 9   | `task_94bbeef7` | review      | reviewed    | `needs_remediation='1'` → removed `ready-to-merge` again                                              |
| 10  | `task_a69a2a96` | remediation | implemented | `requires_re_review='0'`, `execution_outcome_label='already_completed'` — **no-op, no label applied** |

After task 10, INT-1376 has no `ready-to-merge` label. The code-tasks list renders the open-PR badge (`#1819`) instead of the purple Merge pill. See `apps/web/src/components/code-tasks/IssueGroupRow.tsx:340-381`.

### Code-level root cause

`apps/code-agent/src/routes/webhookRoutes.ts`:

- Lines 1294-1318: remediation callback persists `requiresReReview` to Firestore but does not touch Linear labels.
- Line 1354: `if (task.agentType === 'review' && prNumber !== undefined && result !== undefined)` — the label-apply block is gated to review tasks only.
- Lines 1369-1516: the label-apply flow (PR-already-merged guard, `findOriginTaskByPR`, `linearAgentClient.updateIssueMetadata`, `groupSummaryRepo.recomputeWithLabels`) is inlined here and not reused elsewhere.

`apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`:

- Lines 92-102 + 110-126: `derivePipeline` adds an actionable `merge` step only when `hasMergeReadyLabel(...)` is `true`. It ignores `requiresReReview` on remediation tasks entirely.

### Data flow (current, broken)

```
review(needs_remediation=1)         remediation(requires_re_review=0,
  │                                    already_completed)
  ├─ removeLabel: ready-to-merge      │
  ├─ recomputeWithLabels([])          ├─ update task.requiresReReview = false
  │                                   ├─ (NO label write)
  │                                   └─ (NO recomputeWithLabels call)
  └─ createRemediationTask ────────────→ (this task runs)

Result: ready-to-merge stays removed → derivePipeline has no 'merge'
        actionable → UI shows PR badge, not Merge button.
```

---

## File Structure

| File                                                                            | Action | Responsibility                                              |
| ------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `apps/code-agent/src/routes/webhookRoutes.ts`                                   | Modify | Extract label-apply helper; add remediation-complete branch |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                         | Modify | Cover new branch (positive + negative cases)                |
| `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`                | Modify | Optional: alternate unlock signal from latest remediation   |
| `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` | Modify | Cover new unlock path                                       |

---

## Task 1: Extract label-apply flow into a reusable helper

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1369-1516`

The current label-apply flow is inlined inside the review-complete branch. Extract it into a named function so the remediation branch can reuse it with identical semantics (PR-merged guard, origin lookup, planning guard, Linear write, group-summary recompute).

- [ ] **Step 1: Identify the exact block to extract**

Read `apps/code-agent/src/routes/webhookRoutes.ts:1369-1516`. Confirm dependency set: `gitHubPRSummaryRepo`, `userServiceClient`, `gitHubPRClient`, `parseOwnerRepo`, `codeTaskRepo.findOriginTaskByPR`, `linearAgentClient`, `getServices().groupSummaryRepo`, `request.log`. Decide whether the helper lives in the same file (near the route) or in `apps/code-agent/src/domain/services/setReviewOutcomeLabel.ts`. Prefer a new domain service for testability.

- [ ] **Step 2: Write the failing characterization test for the extracted helper**

In `apps/code-agent/src/__tests__/domain/services/setReviewOutcomeLabel.test.ts`, add tests that mirror the current review-complete branch behavior:
- applies `ready-to-merge` to origin execution issue when origin is execution
- skips label (auto-merges) when origin is planning
- skips label when PR already merged (summary path)
- skips label when PR already merged (GitHub API fallback)
- calls `groupSummaryRepo.recomputeWithLabels` with expected labels

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: FAIL — the helper does not exist yet.

- [ ] **Step 4: Create the helper, extract the inlined block**

Add `apps/code-agent/src/domain/services/setReviewOutcomeLabel.ts`:

```typescript
export interface SetReviewOutcomeLabelDeps {
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  gitHubPRSummaryRepo: GitHubPRSummaryRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  groupSummaryRepo: GroupSummaryRepository;
  logger: Logger;
}

export async function setReviewOutcomeLabel(
  deps: SetReviewOutcomeLabelDeps,
  args: { task: CodeTask; prNumber: number; completedAt: Date },
): Promise<void> {
  // … identical logic to webhookRoutes.ts:1369-1516 …
}
```

Update `webhookRoutes.ts:1369-1516` to call the helper. Preserve all logging keys and best-effort error-swallowing behavior.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: PASS. Existing review-complete tests must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts \
        apps/code-agent/src/domain/services/setReviewOutcomeLabel.ts \
        apps/code-agent/src/__tests__/domain/services/setReviewOutcomeLabel.test.ts
git commit -m "refactor(code-agent): extract setReviewOutcomeLabel from review callback

Pure extraction — no behavior change. Prepares for reuse from the
remediation-complete callback.

Refs INT-XXXX"
```

---

## Task 2: Apply `ready-to-merge` on remediation with `already_completed` outcome

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (around line 1353, after the review-complete branch)
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts:5906` (existing describe block)

- [ ] **Step 1: Write the failing test — remediation with `already_completed` applies `ready-to-merge`**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, inside `describe('remediation task-complete → requiresReReview persistence')` (line 5906), add:

```typescript
it('applies ready-to-merge when remediation completes with requires_re_review=0 and execution_outcome_label=already_completed', async () => {
  // Seed: remediation task with PR 123, origin = execution task on same PR
  // Seed: linearIssue with NO ready-to-merge label
  // Trigger: task-complete callback with
  //   { requires_re_review: '0', execution_outcome_label: 'already_completed', prUrl: '…/pull/123' }
  // Assert:
  //   - linearAgentClient.updateIssueMetadata called with addLabels: ['ready-to-merge']
  //   - groupSummaryRepo.recomputeWithLabels called with labels including ready-to-merge
});

it('does NOT apply ready-to-merge when remediation completes with execution_outcome_label=implemented', async () => {
  // Same seed, but execution_outcome_label: 'implemented' (actually pushed commits)
  // Assert: updateIssueMetadata was NOT called — a fresh review must run first
});

it('does NOT apply ready-to-merge when remediation completes with requires_re_review=1', async () => {
  // Same seed, requires_re_review: '1'
  // Assert: updateIssueMetadata was NOT called
});

it('skips label when PR already merged (re-uses setReviewOutcomeLabel guard)', async () => {
  // Seed: gitHubPRSummaryRepo reports mergedAt set
  // Assert: updateIssueMetadata was NOT called
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: FAIL — no remediation-complete label branch exists.

- [ ] **Step 3: Add the remediation branch**

In `apps/code-agent/src/routes/webhookRoutes.ts`, immediately after the review-complete `if (task.agentType === 'review' && ...)` block (before line 1630's `markInReview`), add:

```typescript
// Remediation with "already_completed" outcome: restore ready-to-merge.
// The prior review removed the label (needs_remediation='1') and created this
// remediation. The remediation determined all findings were already fixed by
// an earlier run (requires_re_review='0', execution_outcome_label='already_completed').
// Since no new commits were pushed, the existing review state is still valid —
// re-apply the label so the UI surfaces the Merge action again.
//
// GUARD: execution_outcome_label must be 'already_completed'. If the remediation
// actually pushed commits ('implemented'), a fresh review MUST run and set the
// label via the normal review-complete path. Short-circuiting here would skip
// review of new code.
if (
  task.agentType === 'remediation' &&
  prNumber !== undefined &&
  result?.requires_re_review === '0' &&
  result.execution_outcome_label === 'already_completed'
) {
  try {
    await setReviewOutcomeLabel(
      { codeTaskRepo, linearAgentClient, gitHubPRSummaryRepo, gitHubPRClient,
        userServiceClient, groupSummaryRepo, logger: request.log },
      { task, prNumber, completedAt },
    );
  } catch (err: unknown) {
    request.log.warn({ error: err, taskId, prNumber },
      'Failed to set ready-to-merge after already_completed remediation (best-effort)');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: PASS — all four new tests green, existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts \
        apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): re-apply ready-to-merge after no-op remediation

When a remediation task completes with requires_re_review='0' and
execution_outcome_label='already_completed' (nothing new pushed), reuse
the review-outcome label flow to restore ready-to-merge on the Linear
issue. Guards against reapplying the label when the remediation actually
pushed commits ('implemented') — those still need a fresh review.

Fixes INT-XXXX"
```

---

## Task 3: Defense-in-depth unlock signal in `derivePipeline`

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts:92-102`
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

Even with Task 2 in place, label propagation can race (see `docs/plans/2026-04-05-fix-stale-merge-action.md`). As a secondary unlock signal, treat a terminal remediation with `requiresReReview === false` as merge-ready when execution already has a PR.

- [ ] **Step 1: Write the failing test — alt-unlock via terminal remediation**

In `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`, add:

```typescript
it('adds actionable merge step when latest remediation has requiresReReview=false (alt-unlock)', () => {
  // Given: execution task (completed, prUrl), remediation task (implemented,
  //        requiresReReview: false), linearIssue WITHOUT ready-to-merge label
  // When: derivePipeline
  // Then: steps contains { agentType: 'merge', state: 'actionable' }
});

it('does NOT add merge step when latest remediation has requiresReReview=true', () => {
  // Guard test
});

it('does NOT add merge step when latest remediation has no requiresReReview field', () => {
  // Guard test — legacy remediation tasks must not trigger alt-unlock
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: FAIL — alt-unlock not implemented.

- [ ] **Step 3: Extend `derivePipeline`**

In `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`, after the existing label-based merge-ready block (line 92-102), add:

```typescript
// Alt-unlock: latest non-archived remediation explicitly said "no re-review needed".
// Protects against label-propagation races (see 2026-04-05-fix-stale-merge-action.md).
if (
  !hasActiveTask &&
  executionEntry?.step.state === 'completed' &&
  executionEntry.task.result?.prUrl !== undefined &&
  !steps.some((s) => s.agentType === 'merge')
) {
  const latestRemediation = tasks.find(
    (t) => t.agentType === 'remediation' && t.status !== 'archived',
  );
  if (latestRemediation?.requiresReReview === false) {
    steps.push({ agentType: 'merge', state: 'actionable', label: 'Merge' });
  }
}
```

Note: `SerializedTask` must expose `requiresReReview`. Check `apps/code-agent/src/domain/issueGrouping/types.ts` and the serializer in `apps/code-agent/src/routes/code/issueGroupRoutes.ts`. Add the field to both if missing.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts \
        apps/code-agent/src/domain/issueGrouping/types.ts \
        apps/code-agent/src/routes/code/issueGroupRoutes.ts \
        apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts
git commit -m "feat(code-agent): alt merge-unlock from terminal remediation

When the latest remediation task has requiresReReview=false, treat the
group as merge-actionable even if the ready-to-merge label has not yet
propagated through the Linear cache. Defense in depth against label
race conditions.

Refs INT-XXXX"
```

---

## Task 4: Full CI verification

- [ ] **Step 1: Run full CI from repo root**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-remediation-merge.txt
```

Expected: all workspaces pass.

- [ ] **Step 2: If any failures, analyze and fix**

```bash
rg "error|FAIL" -C3 /tmp/ci-output-remediation-merge.txt
```

- [ ] **Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address CI feedback for INT-XXXX"
```

---

## Endpoint Changes

- **Unchanged:** `POST /internal/webhooks/orchestrator/task-complete` — response schema unchanged, side effects (label writes, group-summary recompute) extended to cover remediation branch.
- **Unchanged:** `GET /code/issue-groups` — benefits from corrected pipeline state.
- **Unchanged:** All other endpoints.
