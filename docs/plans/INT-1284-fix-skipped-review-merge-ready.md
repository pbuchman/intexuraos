# Fix Skipped Reviews Not Setting ready-to-merge Label

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the LLM triage skips a PR review (e.g., documentation-only change), set the `ready-to-merge` label on the origin task's Linear issue so the UI shows the merge button.

**Architecture:** The `unifiedEvaluator` skip path currently records logs and exits without setting the `ready-to-merge` label. We add an `addLabel` method to `LinearIssueService` (symmetric with existing `removeLabel`), then inject a new callback into `UnifiedEvaluatorDeps` that the skip path calls to set the label and recompute the group summary. This keeps the evaluator decoupled from Linear/Firestore internals.

**Tech Stack:** TypeScript, Fastify, Firestore, Linear API (via linear-agent)

---

## Root Cause

When a PR review is **dispatched and completes** with `needs_remediation === '0'`:
- `webhookRoutes.ts` (lines 1248-1344) sets the `ready-to-merge` label on the origin task's Linear issue
- The group summary is recomputed
- The UI shows the merge button

When a PR review is **skipped** at triage (e.g., documentation-only):
- `unifiedEvaluator.ts` (lines 376-397) records logs and an `EventDecision` with `decision: 'skip'`
- **No label is set** -- the label-setting logic only exists in the review-completion path
- The UI never shows the merge button

## File Structure

| Action   | File                                                                       | Responsibility                                                       |
| -------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/services/linearIssueService.ts`                | Add `addLabel()` method                                              |
| Modify   | `apps/code-agent/src/domain/services/unifiedEvaluator.ts`                  | Add `onReviewSkipped` callback dep; call it from skip path           |
| Modify   | `apps/code-agent/src/services.ts`                                          | Wire `onReviewSkipped` callback with label + summary recompute logic |
| Modify   | `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`   | Test skip-sets-label scenarios                                       |
| Modify   | `apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts` | Test `addLabel()`                                                    |

## Key Design Decisions

1. **Callback injection over direct dependency.** The evaluator gets an `onReviewSkipped` callback (same pattern as `onUnauthorizedSender`) rather than direct access to `linearAgentClient` + `groupSummaryRepo`. This keeps the evaluator's dep surface small and domain-focused.

2. **Only LLM skip triggers the label.** Hard-rules skips (protected branch, sender not whitelisted, etc.) are NOT review skips -- they're events that should never have reached triage. Only `decidedBy: 'llm_triage'` skips qualify.

3. **Only execution-origin tasks get the label.** Planning-origin tasks intentionally skip `ready-to-merge` (user must trigger execution manually). This mirrors the guard in `webhookRoutes.ts` line 1269-1273.

4. **Best-effort, fire-and-forget.** The label-setting is best-effort (like the existing review-completion path). Failures are logged but don't fail the webhook processing.

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** All existing endpoints

---

### Task 1: Add `addLabel` to `LinearIssueService`

**Files:**
- Modify: `apps/code-agent/src/domain/services/linearIssueService.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts`

- [ ] **Step 1: Write the failing test for `addLabel`**

In the existing test file for `linearIssueService`, add a test for the new `addLabel` method. Follow the existing `removeLabel` test pattern.

```typescript
describe('addLabel', () => {
  it('calls updateIssueMetadata with addLabels', async () => {
    mockLinearAgentClient.updateIssueMetadata.mockResolvedValue(ok({ droppedLabels: [] }));

    await service.addLabel('user-1', 'INT-100', 'ready-to-merge');

    expect(mockLinearAgentClient.updateIssueMetadata).toHaveBeenCalledWith({
      userId: 'user-1',
      issueId: 'INT-100',
      addLabels: ['ready-to-merge'],
    });
  });

  it('logs warning on failure but does not throw', async () => {
    mockLinearAgentClient.updateIssueMetadata.mockResolvedValue(
      err({ code: 'LINEAR_ERROR', message: 'fail' })
    );

    await service.addLabel('user-1', 'INT-100', 'ready-to-merge');

    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('skips when linearIssueId is empty', async () => {
    await service.addLabel('user-1', '', 'ready-to-merge');

    expect(mockLinearAgentClient.updateIssueMetadata).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: FAIL -- `addLabel` does not exist on `LinearIssueService`

- [ ] **Step 3: Add `addLabel` to the interface and implementation**

In `apps/code-agent/src/domain/services/linearIssueService.ts`:

Add to the `LinearIssueService` interface (after `removeLabel`):

```typescript
/**
 * Add a label to an issue by name. Best-effort: logs and swallows errors.
 */
addLabel(userId: string, linearIssueId: string, labelName: string): Promise<void>;
```

Add to the returned object (after `removeLabel` implementation):

```typescript
async addLabel(userId: string, linearIssueId: string, labelName: string): Promise<void> {
  if (!linearIssueId) {
    return;
  }

  const result = await linearAgentClient.updateIssueMetadata({
    userId,
    issueId: linearIssueId,
    addLabels: [labelName],
  });

  if (!result.ok) {
    logger.warn({ linearIssueId, labelName, error: result.error }, 'Failed to add label to Linear issue');
  }
},
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/services/linearIssueService.ts apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts
git commit -m "feat(code-agent): add addLabel to LinearIssueService"
```

---

### Task 2: Add `onReviewSkipped` callback to `UnifiedEvaluatorDeps`

**Files:**
- Modify: `apps/code-agent/src/domain/services/unifiedEvaluator.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts`

- [ ] **Step 1: Write the failing test -- LLM skip calls `onReviewSkipped`**

In the existing `unifiedEvaluator` test file, add a test in the LLM triage skip section. The test should verify that when LLM triage returns `skip`, the `onReviewSkipped` callback is called with the event's repository and PR number.

```typescript
it('calls onReviewSkipped when LLM triage skips', async () => {
  const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
  const evaluator = createUnifiedEvaluator({
    ...baseDeps,
    onReviewSkipped,
  });

  // Set up: hard rules return needs_triage, LLM returns skip
  mockWebhookRules.evaluate.mockReturnValue({ action: 'needs_triage' });
  mockEvaluateEvent.mockResolvedValue(ok({
    action: 'skip' as const,
    reason: 'Documentation-only change',
    usage: { costUsd: 0.001, toolCalls: 0 },
  }));

  await evaluator.evaluate(createPREvent({ repository: 'pbuchman/intexuraos', pullRequestNumber: 42 }), mockLogger);

  expect(onReviewSkipped).toHaveBeenCalledWith({
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
  });
});
```

- [ ] **Step 2: Write a second test -- hard-rules skip does NOT call `onReviewSkipped`**

```typescript
it('does not call onReviewSkipped when hard rules skip', async () => {
  const onReviewSkipped = vi.fn().mockResolvedValue(undefined);
  const evaluator = createUnifiedEvaluator({
    ...baseDeps,
    onReviewSkipped,
  });

  mockWebhookRules.evaluate.mockReturnValue({ action: 'skip', reason: 'PROTECTED_BASE_BRANCH' });

  await evaluator.evaluate(createPREvent({}), mockLogger);

  expect(onReviewSkipped).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write a third test -- callback failure does not throw**

```typescript
it('swallows onReviewSkipped errors', async () => {
  const onReviewSkipped = vi.fn().mockRejectedValue(new Error('boom'));
  const evaluator = createUnifiedEvaluator({
    ...baseDeps,
    onReviewSkipped,
  });

  mockWebhookRules.evaluate.mockReturnValue({ action: 'needs_triage' });
  mockEvaluateEvent.mockResolvedValue(ok({
    action: 'skip' as const,
    reason: 'No code changes',
    usage: { costUsd: 0.001, toolCalls: 0 },
  }));

  // Should not throw
  await evaluator.evaluate(createPREvent({}), mockLogger);

  expect(onReviewSkipped).toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests to confirm failure**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: FAIL -- `onReviewSkipped` is not called / not a property of deps

- [ ] **Step 5: Add `onReviewSkipped` to deps and call from LLM skip path**

In `apps/code-agent/src/domain/services/unifiedEvaluator.ts`:

Add to `UnifiedEvaluatorDeps` interface:

```typescript
/** Best-effort callback when LLM triage skips a review. Used to set ready-to-merge label. */
onReviewSkipped?: ((params: { repository: string; prNumber: number }) => Promise<void>) | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes requires explicit | undefined for conditional initialization
```

In the `evaluate` function, at the end of the `triage.action === 'skip'` block (after `await recordDecision(...)` on line 397), add:

```typescript
// Best-effort: notify that review was skipped so ready-to-merge label can be set.
// Only LLM triage skips qualify — hard-rules skips are pre-triage rejections.
if (deps.onReviewSkipped !== undefined) {
  void deps.onReviewSkipped({ repository: event.repository, prNumber: event.pullRequestNumber }).catch((skipErr: unknown) => {
    logger.warn({ error: skipErr, eventId: event.id }, 'onReviewSkipped callback failed (best-effort)');
  });
}
```

- [ ] **Step 6: Run tests to confirm pass**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/services/unifiedEvaluator.ts apps/code-agent/src/__tests__/domain/services/unifiedEvaluator.test.ts
git commit -m "feat(code-agent): add onReviewSkipped callback to UnifiedEvaluator"
```

---

### Task 3: Wire `onReviewSkipped` in `services.ts`

**Files:**
- Modify: `apps/code-agent/src/services.ts`

The wiring callback needs to:
1. Find the origin task for the PR via `codeTaskRepo.findOriginTaskByPR`
2. Skip if origin is a planning task (user must trigger execution manually)
3. Set `ready-to-merge` label via `linearAgentClient.validateIssue` + `linearAgentClient.updateIssueMetadata`
4. Recompute group summary via `groupSummaryRepo.recomputeWithLabels`

This mirrors the logic in `webhookRoutes.ts` lines 1261-1334 but extracted into a standalone callback.

- [ ] **Step 1: Add the `onReviewSkipped` callback in services.ts**

In `apps/code-agent/src/services.ts`, find the `createUnifiedEvaluator({...})` call (around line 522). Add the `onReviewSkipped` property:

```typescript
onReviewSkipped: async ({ repository, prNumber }): Promise<void> => {
  try {
    const originResult = await codeTaskRepo.findOriginTaskByPR(repository, prNumber);
    if (!originResult.ok || originResult.value === null) {
      logger.debug({ repository, prNumber }, 'No origin task found for skipped review — skipping label');
      return;
    }

    const origin = originResult.value;
    if (origin.linearIssueId === undefined) {
      logger.debug({ repository, prNumber }, 'Origin task has no Linear issue — skipping label');
      return;
    }

    if (origin.agentType === 'planning') {
      logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
        'Skipped review for planning-origin task — not setting ready-to-merge');
      return;
    }

    // Validate issue exists and get current labels
    const issueValidation = await linearAgentClient.validateIssue({
      userId: origin.userId,
      identifier: origin.linearIssueId,
    });
    if (!issueValidation.ok) {
      logger.warn({ linearIssueId: origin.linearIssueId, error: issueValidation.error },
        'Failed to validate issue for skipped-review label');
      return;
    }

    // Set ready-to-merge label
    const labelResult = await linearAgentClient.updateIssueMetadata({
      userId: origin.userId,
      issueId: issueValidation.value.id,
      addLabels: ['ready-to-merge'],
    });
    if (!labelResult.ok) {
      logger.warn({ linearIssueId: origin.linearIssueId, error: labelResult.error },
        'Failed to set ready-to-merge label for skipped review');
      return;
    }
    if (labelResult.value.droppedLabels.length > 0) {
      logger.warn({ linearIssueId: origin.linearIssueId, droppedLabels: labelResult.value.droppedLabels },
        'ready-to-merge label not found in Linear team');
      return;
    }

    logger.info({ repository, prNumber, linearIssueId: origin.linearIssueId },
      'Set ready-to-merge label for skipped review');

    // Best-effort: recompute group summary so cached aggregateStatus reflects actionable state
    if (groupSummaryRepo !== undefined) {
      const updatedLabels = [
        ...issueValidation.value.labels.map((l) => ({ id: '', name: l })),
        { id: '', name: 'ready-to-merge' },
      ];
      void groupSummaryRepo.recomputeWithLabels(
        origin.userId, origin.linearIssueId, updatedLabels, new Date().toISOString(),
      ).catch((recomputeErr: unknown) => {
        logger.warn({ linearIssueId: origin.linearIssueId, error: recomputeErr },
          'Failed to recompute group summary after skipped-review label (best-effort)');
      });
    }
  } catch (error: unknown) {
    logger.warn({ error, repository, prNumber }, 'onReviewSkipped failed (best-effort)');
  }
},
```

**Important:** The variables `codeTaskRepo`, `linearAgentClient`, `groupSummaryRepo`, and `logger` are already in scope at the point where `createUnifiedEvaluator` is called in `services.ts`. Verify this by reading the surrounding code before inserting.

- [ ] **Step 2: Verify build and tests pass**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/services.ts
git commit -m "feat(code-agent): wire onReviewSkipped to set ready-to-merge label"
```

---

### Task 4: Add automation log event for review-skip label

**Files:**
- Modify: `apps/code-agent/src/domain/ports/automationLog.ts` (if needed)
- Modify: `apps/code-agent/src/services.ts` (add log recording in callback)

This is optional but important for observability. When a review skip sets the label, it should be visible in the PR tracking comment.

- [ ] **Step 1: Add automation log recording to the `onReviewSkipped` callback**

In the `onReviewSkipped` callback in `services.ts`, after the successful label set (the `logger.info` line), add an automation log record. The automation log is available in scope as `automationLog`.

```typescript
// Record in the PR automation comment for visibility
void automationLog.record(
  { repository, prNumber },
  {
    type: 'remediation_decision',
    required: false,
    source: 'review_result',
    signal: '0',
  },
).catch((logErr: unknown) => {
  logger.warn({ error: logErr, repository, prNumber }, 'Failed to record automation log for skipped-review label');
});
```

Note: Reusing the existing `remediation_decision` event type is appropriate here since it semantically means "no remediation needed" -- the review was skipped because there was nothing to review, which is equivalent to a passing review.

- [ ] **Step 2: Verify build and tests pass**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/services.ts
git commit -m "feat(code-agent): record automation log when skipped review sets merge label"
```

---

### Task 5: Integration test -- skipped review triggers merge-ready pipeline

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts` (or a new focused test file)

- [ ] **Step 1: Write integration test verifying pipeline shows merge step**

Add a test that verifies the end-to-end behavior: when a task group has an execution task with `status: 'implemented'`, a `prUrl`, and the Linear issue has `ready-to-merge` label (simulating the label being set after a skipped review), the pipeline includes a merge step.

Look at the existing `issueGroups.test.ts` file for the test patterns used. The test should use the `groupByLinearIssue` function directly with a mock task that has `linearIssue.labels` containing `ready-to-merge`.

```typescript
it('shows merge step when execution task has ready-to-merge label (skipped review)', () => {
  const tasks: SerializedTask[] = [
    createSerializedTask({
      agentType: 'execution',
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
      linearIssueId: 'INT-100',
      linearIssue: {
        identifier: 'INT-100',
        title: 'Test',
        state: { name: 'In Review', type: 'started' },
        priority: 3,
        assignee: null,
        labels: [{ name: 'ready-to-merge' }],
        url: 'https://linear.app/test/INT-100',
        commentCount: 0,
        lastCommentAt: null,
      },
    }),
  ];

  const groups = groupByLinearIssue(tasks);
  const group = groups[0]!;
  const mergeStep = group.pipeline.steps.find((s) => s.agentType === 'merge');

  expect(mergeStep).toBeDefined();
  expect(mergeStep!.state).toBe('actionable');
});
```

- [ ] **Step 2: Run test to confirm pass**

This test should already pass with the existing `groupByLinearIssue` logic (line 92-102 already handles execution + label). If it fails, investigate why.

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "test(code-agent): verify merge step appears for skipped review with label"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: PASS

- [ ] **Step 2: Verify coverage**

Ensure all new code paths have test coverage. Check the coverage report for:
- `linearIssueService.ts` -- `addLabel` method
- `unifiedEvaluator.ts` -- `onReviewSkipped` callback invocation

- [ ] **Step 3: Final commit if any cleanup needed**
