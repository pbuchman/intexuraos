# Fix pull_request agentType Preservation on Retry/Feedback

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the `'pull_request'` agentType when a PR-comment task is retried via `retryTask()` or receives feedback via `submitTaskFeedback()`.

**Architecture:** Both use cases determine `agentType` via a binary `hasCodeTaskLabel()` check that can only produce `'execution'` or `'planning'` — never `'pull_request'`. The fix checks the original task's persisted `agentType` first; if it's `'pull_request'`, that value is preserved. Otherwise, the existing label-based routing continues unchanged.

**Tech Stack:** TypeScript, Vitest, Fastify (code-agent service)

---

## Bug Summary

| Location                  | Line | Current Code                                                                | Problem                              |
| ------------------------- | ---- | --------------------------------------------------------------------------- | ------------------------------------ |
| `retryTask.ts`            | 276  | `hasCodeTaskLabel(labels) ? 'execution' : 'planning'`                       | No path to `'pull_request'`          |
| `retryTask.ts`            | 315  | `agentType: 'planning' \                                                    | 'execution'`                         | Type excludes `'pull_request'` |
| `retryTask.ts`            | 330  | `retryTask.agentType === 'execution' ? 'execution' : 'planning'`            | Maps `'pull_request'` → wrong        |
| `submitTaskFeedback.ts`   | 216  | `const agentType: 'planning' \                                              | 'execution' = hasCodeTaskLabel(...)` | Type + logic exclude PR |
| `submitTaskFeedback.ts`   | 329  | `agentType: 'planning' \                                                    | 'execution'`                         | Type excludes `'pull_request'` |
| `submitTaskFeedback.ts`   | 344  | `followUpTask.agentType === 'execution' ? 'execution' : 'planning'`         | Maps `'pull_request'` → wrong        |

## Fix Strategy

The `DispatchRequest` interface already supports `'pull_request'` (line 49 of `taskDispatcher.ts`). The `AgentType` union already includes `'pull_request'` (line 21 of `codeTask.ts`). Only the two use cases and their inline types need updating.

**Pattern for both files — createInput agentType:**
```typescript
agentType: originalTask.agentType === 'pull_request'
  ? ('pull_request' as const)
  : hasCodeTaskLabel(freshLabels) ? ('execution' as const) : ('planning' as const),
```

**Pattern for both files — dispatchRequest type + value:**
```typescript
// Type: widen to include 'pull_request'
agentType: 'planning' | 'execution' | 'pull_request';

// Value: pass through directly (no binary remapping)
agentType: createdTask.agentType ?? 'planning',
```

---

## Task 1: Write failing tests for retryTask pull_request preservation

**Files:**
- Modify: `apps/code-agent/src/__tests__/usecases/retryTask.test.ts`

**Step 1: Write the failing test — retryTask preserves pull_request agentType**

Add after the existing "should refresh Linear labels and children before dispatch" test (around line 728):

```typescript
it('should preserve pull_request agentType when retrying a PR-comment task', async () => {
  const mockTask = createMockTask({
    completedAt: sixMinutesAgo,
    agentType: 'pull_request',
    prNumber: 42,
  });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  mockLinearAgentClient.validateIssue.mockResolvedValue(
    ok({
      id: linearIssueId,
      identifier: linearIssueId,
      title: 'PR comment task',
      url: 'https://linear.app/intexuraos/issue/INT-654',
      labels: ['code-task', 'pr-comment'],
      childCount: 0,
    })
  );

  const deps = createDeps();
  const result = await retryTask(deps, {
    originalTaskId,
    userId,
  });

  expect(result.ok).toBe(true);

  // createInput should preserve 'pull_request', NOT downgrade to 'execution'
  expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'pull_request',
    })
  );

  // dispatch should also receive 'pull_request'
  expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'pull_request',
    })
  );
});
```

**Step 2: Write the failing test — retryTask still routes planning→execution on label change**

```typescript
it('should still route by labels for non-PR tasks (planning→execution on code-task label)', async () => {
  const mockTask = createMockTask({
    completedAt: sixMinutesAgo,
    agentType: 'planning',
  });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  mockLinearAgentClient.validateIssue.mockResolvedValue(
    ok({
      id: linearIssueId,
      identifier: linearIssueId,
      title: 'Planning task upgraded to execution',
      url: 'https://linear.app/intexuraos/issue/INT-654',
      labels: ['code-task'],
      childCount: 0,
    })
  );

  const deps = createDeps();
  const result = await retryTask(deps, {
    originalTaskId,
    userId,
  });

  expect(result.ok).toBe(true);

  // Non-PR task: label-based routing should still apply
  expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'execution',
    })
  );
});
```

**Step 3: Run tests to verify they fail**

```bash
pnpm --filter code-agent test -- --run src/__tests__/usecases/retryTask.test.ts
```

Expected: Both new tests FAIL — `'pull_request'` test receives `'execution'` instead, and the second test should already pass (it's a regression guard).

**Step 4: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/usecases/retryTask.test.ts
git commit -m "test(code-agent): add failing tests for retryTask pull_request agentType preservation (INT-654)"
```

---

## Task 2: Fix retryTask to preserve pull_request agentType

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/retryTask.ts:276,315,330`

**Step 1: Fix createInput agentType (line 276)**

Change:
```typescript
agentType: hasCodeTaskLabel(linearIssueLabelsForDispatch) ? ('execution' as const) : ('planning' as const),
```

To:
```typescript
agentType: originalTask.agentType === 'pull_request'
  ? ('pull_request' as const)
  : hasCodeTaskLabel(linearIssueLabelsForDispatch) ? ('execution' as const) : ('planning' as const),
```

**Step 2: Fix dispatchRequest inline type (line 315)**

Change:
```typescript
agentType: 'planning' | 'execution';
```

To:
```typescript
agentType: 'planning' | 'execution' | 'pull_request';
```

**Step 3: Fix dispatchRequest agentType value (line 330)**

Change:
```typescript
agentType: retryTask.agentType === 'execution' ? 'execution' : 'planning',
```

To:
```typescript
agentType: retryTask.agentType ?? 'planning',
```

Note: The v8 ignore comment on line 329 (`source-map: object literal ternary branch`) may no longer be needed since we removed the ternary. Remove it if the branch is now trivially covered, or update the comment if the `??` still triggers a similar issue.

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter code-agent test -- --run src/__tests__/usecases/retryTask.test.ts
```

Expected: ALL tests pass, including the two new ones.

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/retryTask.ts
git commit -m "fix(code-agent): preserve pull_request agentType in retryTask (INT-654)"
```

---

## Task 3: Write failing tests for submitTaskFeedback pull_request preservation

**Files:**
- Modify: `apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts`

**Step 1: Write the failing test — submitTaskFeedback preserves pull_request agentType**

Add after the existing "should set agentType to execution when validateIssue returns code-task label" test (around line 397):

```typescript
it('should preserve pull_request agentType when providing feedback on a PR-comment task', async () => {
  const mockTask = createMockTask({
    agentType: 'pull_request',
    prNumber: 42,
  });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  mockLinearAgentClient.validateIssue.mockResolvedValue(
    ok({
      id: linearIssueId,
      identifier: linearIssueId,
      title: 'PR comment task',
      url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
      labels: ['code-task', 'pr-comment'],
      childCount: 0,
    })
  );

  const deps = createDeps();
  const result = await submitTaskFeedback(deps, {
    originalTaskId,
    userId,
    feedback,
  });

  expect(result.ok).toBe(true);

  // createInput should preserve 'pull_request', NOT downgrade to 'execution'
  expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'pull_request',
    })
  );

  // dispatch should also receive 'pull_request'
  expect(mockTaskDispatcher.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'pull_request',
    })
  );
});
```

**Step 2: Write the failing test — submitTaskFeedback still routes by labels for non-PR tasks**

```typescript
it('should still route by labels for non-PR tasks (execution→planning when code-task label removed)', async () => {
  const mockTask = createMockTask({
    agentType: 'execution',
  });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  // Fresh labels no longer include 'code-task'
  mockLinearAgentClient.validateIssue.mockResolvedValue(
    ok({
      id: linearIssueId,
      identifier: linearIssueId,
      title: 'Execution task downgraded to planning',
      url: `https://linear.app/intexuraos/issue/${linearIssueId}`,
      labels: ['feature', 'backend'],
      childCount: 0,
    })
  );

  const deps = createDeps();
  const result = await submitTaskFeedback(deps, {
    originalTaskId,
    userId,
    feedback,
  });

  expect(result.ok).toBe(true);

  // Non-PR task: label-based routing should downgrade to 'planning'
  expect(mockCodeTaskRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentType: 'planning',
    })
  );
});
```

**Step 3: Run tests to verify they fail**

```bash
pnpm --filter code-agent test -- --run src/__tests__/usecases/submitTaskFeedback.test.ts
```

Expected: The pull_request preservation test FAILS (receives `'execution'`). The regression guard test should already pass.

**Step 4: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts
git commit -m "test(code-agent): add failing tests for submitTaskFeedback pull_request agentType preservation (INT-654)"
```

---

## Task 4: Fix submitTaskFeedback to preserve pull_request agentType

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts:216,329,344`

**Step 1: Fix agentType determination (line 216)**

Change:
```typescript
const agentType: 'planning' | 'execution' = hasCodeTaskLabel(linearIssueLabelsForDispatch) ? 'execution' : 'planning';
```

To:
```typescript
const agentType: 'planning' | 'execution' | 'pull_request' = originalTask.agentType === 'pull_request'
  ? 'pull_request'
  : hasCodeTaskLabel(linearIssueLabelsForDispatch) ? 'execution' : 'planning';
```

**Step 2: Fix dispatchRequest inline type (line 329)**

Change:
```typescript
agentType: 'planning' | 'execution';
```

To:
```typescript
agentType: 'planning' | 'execution' | 'pull_request';
```

**Step 3: Fix dispatchRequest agentType value (line 344)**

Change:
```typescript
agentType: followUpTask.agentType === 'execution' ? 'execution' : 'planning',
```

To:
```typescript
agentType: followUpTask.agentType ?? 'planning',
```

Same note as Task 2 re: v8 ignore comment removal/update.

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter code-agent test -- --run src/__tests__/usecases/submitTaskFeedback.test.ts
```

Expected: ALL tests pass, including the two new ones.

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitTaskFeedback.ts
git commit -m "fix(code-agent): preserve pull_request agentType in submitTaskFeedback (INT-654)"
```

---

## Task 5: Full CI verification

**Step 1: Run workspace verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: TypeCheck, Lint, Tests + Coverage all pass.

**Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: ALL green. No regressions.

**Step 3: Check for terraform changes (safety net)**

```bash
git diff --name-only HEAD~4 | grep -E "^terraform/" && echo "TERRAFORM CHANGED" || echo "No terraform changes"
```

Expected: "No terraform changes"

---

## Files Changed Summary

| File                                                                      | Change Type | Lines Changed |
| ------------------------------------------------------------------------- | ----------- | ------------- |
| `apps/code-agent/src/domain/usecases/retryTask.ts`                        | Modify      | 276, 315, 330 |
| `apps/code-agent/src/domain/usecases/submitTaskFeedback.ts`               | Modify      | 216, 329, 344 |
| `apps/code-agent/src/__tests__/usecases/retryTask.test.ts`                | Modify      | +2 tests      |
| `apps/code-agent/src/__tests__/usecases/submitTaskFeedback.test.ts`       | Modify      | +2 tests      |

## Endpoint Changes

None. This is a domain-logic-only fix. No HTTP routes, request/response formats, or API contracts change.

## Risk Assessment

**Low risk.** The change is additive — it adds a `'pull_request'` check before the existing label-based routing. Non-PR tasks are completely unaffected (same code path). The `DispatchRequest` interface already supports `'pull_request'`. All existing tests remain unchanged.
