# Fix Plan PR Merge Before Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where `planning_pr_url` is lost during resumed task completions, causing the plan PR merge step to be silently skipped before execution.

**Architecture:** Two complementary fixes: (1) merge webhook results instead of replacing them on resumed completions, (2) add a fallback in `submitToExecutionAgent` to use `result.prUrl` for planning tasks when `planning_pr_url` is missing. Both fixes are in the `code-agent` app.

**Tech Stack:** TypeScript, Fastify, Firestore, Vitest

---

## Root Cause Analysis

When a planning task completes and is then resumed (e.g., for PR creation), two webhooks arrive:

1. **First webhook:** Contains planning-specific fields (`planning_outcome_label`, `planning_is_complex`, etc.) but no `planning_pr_url` because the PR hadn't been created yet.
2. **Second webhook (`resumedCompletion: true`):** Contains git results (`prUrl`, `branch`, `commits`) but NO planning fields because the Gemini completion verifier failed to extract `agentData`.

The webhook handler at `webhookRoutes.ts:1167` does `...(result !== undefined && { result })`, which **completely overwrites** the stored result. The second webhook's result destroys the planning fields from the first.

Later, `submitToExecutionAgent.ts:319` reads `planningTask.result?.planning_pr_url` which is now `undefined`, so the merge step is skipped.

**Evidence from production logs (INT-1241, task `task_f10b43ca`):**

| Timestamp   | Webhook            | resultKeys                                                                                                                                                                  |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:23:26    | First completion   | `summary, planning_outcome_label, planning_superpowers_writing_plans_used, planning_linear_url, planning_is_complex, planning_subtask_urls, planning_unclear_clarification` |
| 22:04:41    | Resumed completion | `branch, commits, prUrl, summary, commitDetails`                                                                                                                            |

The final Firestore state had `prUrl: "https://github.com/pbuchman/intexuraos/pull/1606"` but no `planning_pr_url`.

## File Structure

| File                                                                           | Action              | Responsibility                                                                        |
| ------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/webhookRoutes.ts`                                  | Modify (~1164-1167) | Merge result fields on resumed completions instead of replacing                       |
| `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`                | Modify (~319)       | Add fallback: use `result.prUrl` when `planning_pr_url` is missing for planning tasks |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                        | Modify              | Add test for result merging on resumed completion                                     |
| `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts` | Modify              | Add test for prUrl fallback                                                           |

---

### Task 1: Merge webhook results on resumed completions (webhookRoutes.ts)

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1164-1176`
- Test: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

The fix: when `resumedCompletion` is true and the task already has a `result` in Firestore, deep-merge the new result into the existing result (new fields win, but existing fields are preserved).

- [ ] **Step 1: Write the failing test**

In `apps/code-agent/src/__tests__/routes/webhooks.test.ts`, add a test in the completed-task webhook section that verifies resumed completions merge results:

```typescript
it('merges result fields on resumed completion instead of replacing', async () => {
  // Create a task with existing planning result (simulating first completion)
  const task = await createTask({
    status: 'planned',
    agentType: 'planning',
    result: {
      summary: 'Original summary',
      planning_outcome_label: 'planned',
      planning_is_complex: '0',
      planning_subtask_urls: '',
    },
  });

  // Resumed completion sends git results only
  const payload = {
    taskId: task.id,
    status: 'completed' as const,
    result: {
      branch: 'plan/my-feature',
      commits: 1,
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      summary: 'Updated summary from resumed run',
    },
    resumedCompletion: true,
  };

  const response = await sendWebhook(task, payload);
  expect(response.statusCode).toBe(200);

  // Verify the result was MERGED, not replaced
  const updated = await findTask(task.id);
  // New fields added
  expect(updated.result?.branch).toBe('plan/my-feature');
  expect(updated.result?.commits).toBe(1);
  expect(updated.result?.prUrl).toBe('https://github.com/pbuchman/intexuraos/pull/42');
  // Existing planning fields preserved
  expect(updated.result?.planning_outcome_label).toBe('planned');
  expect(updated.result?.planning_is_complex).toBe('0');
  // summary updated by new value (new fields win)
  expect(updated.result?.summary).toBe('Updated summary from resumed run');
});
```

Note: Adapt the helper functions (`createTask`, `sendWebhook`, `findTask`) to match the existing test patterns in the file. Study the existing test setup to use the correct helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: The new test FAILS because current code replaces the entire result.

- [ ] **Step 3: Implement result merging in webhookRoutes.ts**

In `apps/code-agent/src/routes/webhookRoutes.ts`, modify the update call around line 1164. The key change: when `result` is present, merge it with the existing task result instead of replacing it:

```typescript
// Current code (line 1167):
// ...(result !== undefined && { result }),

// Replace with:
...(result !== undefined && {
  result: request.body.resumedCompletion === true && task.result !== undefined
    ? { ...task.result, ...result }
    : result,
}),
```

This preserves existing fields (like `planning_outcome_label`) while allowing new fields (like `prUrl`, `branch`) to be added or overwritten.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): merge result fields on resumed completion instead of replacing

When a resumed completion webhook arrives, the new result fields are now
merged into the existing result instead of overwriting it. This preserves
planning-specific fields (planning_pr_url, planning_outcome_label, etc.)
that were set by the first completion webhook.

Fixes INT-1250"
```

---

### Task 2: Add prUrl fallback in submitToExecutionAgent

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts:318-320`
- Test: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`

Defense-in-depth: even if result merging fails or the verifier never extracts `planning_pr_url`, the execution submission should still find the PR URL from `result.prUrl` for planning tasks.

- [ ] **Step 1: Write the failing test**

In `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`, add a test after the existing "merges plan PR" tests:

```typescript
it('falls back to result.prUrl when planning_pr_url is missing for planning tasks', async () => {
  setupHappyPathMocks({
    result: {
      branch: 'plan/my-feature',
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      // Note: NO planning_pr_url field
    },
  });

  const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

  expect(result.ok).toBe(true);
  expect(mockGitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
    'ghp_test_token', 'pbuchman', 'intexuraos', 42, 'merge', expect.any(String),
  );
});
```

Note: Adapt to match the existing test patterns — study `setupHappyPathMocks` and how it sets up the planning task fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: FAIL — current code only checks `planning_pr_url`, ignores `prUrl`.

- [ ] **Step 3: Implement the fallback**

In `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`, modify line 319:

```typescript
// Current code:
// const planningPrUrl = planningTask.result?.planning_pr_url;

// Replace with:
const planningPrUrl = planningTask.result?.planning_pr_url ?? planningTask.result?.prUrl;
```

This falls back to `result.prUrl` (the generic PR URL field populated by git operations) when `planning_pr_url` is not present.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS — both old and new tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts
git commit -m "fix(code-agent): fall back to result.prUrl when planning_pr_url is missing

Defense-in-depth: if the completion verifier fails to extract
planning_pr_url but the git result has prUrl, use that for the
plan PR merge step. This prevents silent merge skips when the
result merging fails or the verifier doesn't capture the PR URL.

Fixes INT-1250"
```

---

### Task 3: Full CI verification

- [ ] **Step 1: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All workspaces pass.

- [ ] **Step 2: Verify no regressions in existing webhook tests**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All existing tests still pass, including the ones for normal (non-resumed) completions where result replacement is correct behavior.

---

## Endpoint Changes

- **Modified:** None (no HTTP API changes — this is internal webhook behavior)
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /internal/webhooks/task-complete`, `POST /code/tasks/:taskId/implement`
