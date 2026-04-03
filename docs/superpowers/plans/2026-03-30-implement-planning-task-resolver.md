# Planning Task Resolver for `/implement` Endpoint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `/implement` to be called with any task in an issue group (review, remediation, etc.) by resolving to the planning task automatically.

**Architecture:** Add a resolver step to `submitToExecutionAgent` that, when the provided task fails the `planned`/`planning` check, looks up the planning task via `linearIssueId` using the existing `findPlannedTaskByLinearIssue` repo method. No new repo methods, no route changes, no frontend changes.

**Tech Stack:** TypeScript, Vitest, Fastify (code-agent service)

---

## File Structure

| File                                                                           | Action                 | Purpose                                                                          |
| ------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`                | Modify (lines 127-139) | Add planning task resolver at Step 2                                             |
| `apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts` | Modify                 | Add tests for resolver behavior; add `findPlannedTaskByLinearIssue` to mock repo |

---

### Task 1: Add `findPlannedTaskByLinearIssue` to Test Mock & Write Failing Tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`

- [ ] **Step 1: Add `findPlannedTaskByLinearIssue` to `mockCodeTaskRepo` type and `beforeEach`**

In the type declaration (line 34-41), add the new mock method:

```typescript
let mockCodeTaskRepo: {
  findByIdForUser: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  hasActiveTaskForLinearIssue: ReturnType<typeof vi.fn>;
  hasDispatchedOrRunningForPR: ReturnType<typeof vi.fn>;
  countQueued: ReturnType<typeof vi.fn>;
  findPlannedTaskByLinearIssue: ReturnType<typeof vi.fn>;
};
```

In `beforeEach` (line 210-217), add it to the initializer:

```typescript
mockCodeTaskRepo = {
  findByIdForUser: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  hasActiveTaskForLinearIssue: vi.fn(),
  hasDispatchedOrRunningForPR: vi.fn(),
  countQueued: vi.fn(),
  findPlannedTaskByLinearIssue: vi.fn(),
};
```

- [ ] **Step 1b: Update existing `invalid_status` tests to handle resolver**

The existing tests at lines 266-295 (`'returns invalid_status when task status is not completed'` and `'returns invalid_status when agentType is not planning'`) create tasks with `linearIssueId: 'INT-100'` (from `createMockTask` defaults). After the resolver is implemented, these tests will try to call `findPlannedTaskByLinearIssue` — which returns `undefined` by default and will throw.

Add a default mock return to these two existing tests so they still return `invalid_status`. The `status: 'running'` test has a task that isn't `planned`/`planning` so the resolver will fire; mock it to return `ok(null)` (no planning task found):

For the `'returns invalid_status when task status is not completed'` test (line 266):
```typescript
it('returns invalid_status when task status is not completed', async () => {
  const mockTask = createMockTask({ status: 'running' });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));
  // ... rest unchanged
});
```

For the `'returns invalid_status when agentType is not planning'` test (line 281):
```typescript
it('returns invalid_status when agentType is not planning', async () => {
  const mockTask = createMockTask({ agentType: 'execution' });
  mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
  mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));
  // ... rest unchanged
});
```

- [ ] **Step 2: Write failing test — resolves review task to planning task**

Add a new `describe` block inside the existing `describe('submitToExecutionAgent')`. Place it after the existing `'returns invalid_status when agentType is not planning'` test (around line 295):

```typescript
describe('planning task resolver', () => {
  it('resolves review task to planning task via linearIssueId', async () => {
    // The user calls /implement on a review task
    const reviewTask = createMockTask({
      id: 'task_review',
      agentType: 'review',
      status: 'reviewed',
      linearIssueId: 'INT-100',
    });
    // The planning task exists for the same Linear issue
    const planningTask = createMockTask({
      id: 'task_planning',
      agentType: 'planning',
      status: 'planned',
      linearIssueId: 'INT-100',
    });

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
    mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(planningTask));

    // Set up remaining happy-path mocks using the PLANNING task
    mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: 'INT-100',
        identifier: 'INT-100',
        title: 'My Feature',
        url: 'https://linear.app/pbuchman/issue/INT-100',
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok({ ...planningTask, implementationTaskId: 'task_exec' }));
    mockCodeTaskRepo.create.mockResolvedValue(
      ok({
        ...planningTask,
        id: 'task_exec',
        agentType: 'execution' as const,
        followUpReason: 'execution_implement' as const,
        parentTaskId: 'task_planning',
        traceId: 'execution-trace-abc',
        workerType: 'auto' as const,
        webhookSecret: 'webhook-secret',
      })
    );
    mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
    mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
    mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'task_exec', queuePosition: 1 }));

    const result = await submitToExecutionAgent(createDeps(), {
      originalTaskId: 'task_review',
      userId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.implementationOf).toBe('task_planning');
    }
    // Verify resolver was called with the review task's linearIssueId
    expect(mockCodeTaskRepo.findPlannedTaskByLinearIssue).toHaveBeenCalledWith('INT-100');
  });

  it('returns invalid_status when resolver finds no planning task', async () => {
    const reviewTask = createMockTask({
      id: 'task_review',
      agentType: 'review',
      status: 'reviewed',
      linearIssueId: 'INT-100',
    });

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
    mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(null));

    const result = await submitToExecutionAgent(createDeps(), {
      originalTaskId: 'task_review',
      userId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_status');
    }
  });

  it('returns invalid_status when non-planning task has no linearIssueId', async () => {
    const taskWithoutLinear = createMockTask({
      id: 'task_no_linear',
      agentType: 'review',
      status: 'reviewed',
    });
    delete (taskWithoutLinear as { linearIssueId?: string }).linearIssueId;

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(taskWithoutLinear));

    const result = await submitToExecutionAgent(createDeps(), {
      originalTaskId: 'task_no_linear',
      userId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_status');
    }
    // Should NOT attempt resolver without linearIssueId
    expect(mockCodeTaskRepo.findPlannedTaskByLinearIssue).not.toHaveBeenCalled();
  });

  it('resolves remediation task to planning task', async () => {
    const remediationTask = createMockTask({
      id: 'task_remediation',
      agentType: 'remediation',
      status: 'implemented',
      linearIssueId: 'INT-100',
    });
    const planningTask = createMockTask({
      id: 'task_planning',
      agentType: 'planning',
      status: 'planned',
      linearIssueId: 'INT-100',
    });

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(remediationTask));
    mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(ok(planningTask));
    mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
    mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
    mockLinearAgentClient.validateIssue.mockResolvedValue(
      ok({
        id: 'INT-100',
        identifier: 'INT-100',
        title: 'My Feature',
        url: 'https://linear.app/pbuchman/issue/INT-100',
        labels: ['code-task'],
        childCount: 0,
        parentId: null,
      })
    );
    mockCodeTaskRepo.update.mockResolvedValue(ok({ ...planningTask, implementationTaskId: 'task_exec' }));
    mockCodeTaskRepo.create.mockResolvedValue(
      ok({
        ...planningTask,
        id: 'task_exec',
        agentType: 'execution' as const,
        followUpReason: 'execution_implement' as const,
        parentTaskId: 'task_planning',
        traceId: 'execution-trace-abc',
        workerType: 'auto' as const,
        webhookSecret: 'webhook-secret',
      })
    );
    mockLinearAgentClient.updateIssueState.mockResolvedValue(ok({}));
    mockLinearAgentClient.addComment.mockResolvedValue(ok({}));
    mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'task_exec', queuePosition: 1 }));

    const result = await submitToExecutionAgent(createDeps(), {
      originalTaskId: 'task_remediation',
      userId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.implementationOf).toBe('task_planning');
    }
  });

  it('returns invalid_status when resolver errors', async () => {
    const reviewTask = createMockTask({
      id: 'task_review',
      agentType: 'review',
      status: 'reviewed',
      linearIssueId: 'INT-100',
    });

    mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(reviewTask));
    mockCodeTaskRepo.findPlannedTaskByLinearIssue.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore error' })
    );

    const result = await submitToExecutionAgent(createDeps(), {
      originalTaskId: 'task_review',
      userId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_status');
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/submitToExecutionAgent.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: All 5 new tests FAIL — `findPlannedTaskByLinearIssue` is never called because the use case doesn't have the resolver yet.

- [ ] **Step 4: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts
git commit -m "test: add failing tests for planning task resolver in submitToExecutionAgent"
```

---

### Task 2: Implement the Planning Task Resolver

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts` (lines 127-139)

- [ ] **Step 1: Add `findPlannedTaskByLinearIssue` to `SubmitToExecutionAgentDeps`**

The `codeTaskRepo` in deps is already typed as `CodeTaskRepository` (line 81), which includes `findPlannedTaskByLinearIssue`. No type change needed — the method is already on the interface.

Verify this by checking the import: `import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';` at line 11. The interface at line 284 of `codeTaskRepository.ts` includes `findPlannedTaskByLinearIssue`.

- [ ] **Step 2: Replace Step 2 validation with resolver logic**

In `submitToExecutionAgent.ts`, replace the block at lines 127-139 (from `const originalTask =` through the closing `}` of the error return):

**Current code (lines 127-139):**
```typescript
  const originalTask = originalTaskResult.value;

  // Step 2: Validate status is 'planned' and agentType is 'planning'
  if (originalTask.status !== 'planned' || originalTask.agentType !== 'planning') {
    logger.warn(
      { taskId: originalTask.id, status: originalTask.status, agentType: originalTask.agentType },
      'Attempted to start Execution Agent on non-planning task'
    );
    return err({
      code: 'invalid_status',
      message: 'Task must be a completed planning task to start implementation',
    });
  }
```

**New code:**
```typescript
  let planningTask = originalTaskResult.value;

  // Step 2: Resolve to planning task if needed
  // When /implement is called on a non-planning task (review, remediation, etc.),
  // resolve to the planning task in the same issue group via linearIssueId.
  if (planningTask.status !== 'planned' || planningTask.agentType !== 'planning') {
    let resolved = false;

    if (planningTask.linearIssueId !== undefined) {
      const resolveResult = await codeTaskRepo.findPlannedTaskByLinearIssue(planningTask.linearIssueId);
      if (resolveResult.ok && resolveResult.value !== null) {
        logger.info(
          { requestedTaskId: planningTask.id, resolvedTaskId: resolveResult.value.id, linearIssueId: planningTask.linearIssueId },
          'Resolved non-planning task to planning task for implementation'
        );
        planningTask = resolveResult.value;
        resolved = true;
      }
    }

    if (!resolved) {
      logger.warn(
        { taskId: planningTask.id, status: planningTask.status, agentType: planningTask.agentType },
        'Attempted to start Execution Agent on non-planning task'
      );
      return err({
        code: 'invalid_status',
        message: 'Task must be a completed planning task to start implementation',
      });
    }
  }
```

- [ ] **Step 3: Update all downstream references from `originalTask` to `planningTask`**

The variable was renamed from `const originalTask` to `let planningTask`. All references to `originalTask` below line 139 must be updated to `planningTask`. These occur at lines:

- Line 142: `if (originalTask.linearIssueId === undefined)` → `if (planningTask.linearIssueId === undefined)`
- Line 150: `const linearIssueId = originalTask.linearIssueId` → `const linearIssueId = planningTask.linearIssueId`
- Line 153: `if (originalTask.implementationTaskId !== undefined)` → `if (planningTask.implementationTaskId !== undefined)`
- Line 155: `{ taskId: originalTask.id, ...}` → `{ taskId: planningTask.id, ...}`
- Line 244: `const planningPrUrl = originalTask.result?.planning_pr_url` → `const planningPrUrl = planningTask.result?.planning_pr_url`
- Line 257: `{ planningPrUrl, repository: originalTask.repository, ...}` → `{ planningPrUrl, repository: planningTask.repository, ...}`
- Line 271: `await codeTaskRepo.update(originalTask.id, { ... })` → `await codeTaskRepo.update(planningTask.id, { ... })`
- Line 276: `{ taskId: originalTask.id, ... }` → `{ taskId: planningTask.id, ... }`
- Line 299: `systemPromptHash: originalTask.systemPromptHash` → `systemPromptHash: planningTask.systemPromptHash`
- Line 303: `baseBranch: originalTask.baseBranch` → `baseBranch: planningTask.baseBranch`
- Line 304: `traceId: \`execution-${originalTask.traceId}\`` → `traceId: \`execution-${planningTask.traceId}\``
- Line 306: `parentTaskId: originalTask.id` → `parentTaskId: planningTask.id`
- Line 332: `{ originalTaskId: originalTask.id, ... }` → `{ originalTaskId: planningTask.id, ... }`
- Line 354: `[${originalTask.id}]` → `[${planningTask.id}]`
- Line 389: `await codeTaskRepo.update(originalTask.id, ...)` → `await codeTaskRepo.update(planningTask.id, ...)`
- Line 400: `implementationOf: originalTask.id` → `implementationOf: planningTask.id`
- Line 415: `await codeTaskRepo.update(originalTask.id, ...)` → `await codeTaskRepo.update(planningTask.id, ...)`
- Line 429: `implementationOf: originalTask.id` → `implementationOf: planningTask.id`

Use find-and-replace: rename all `originalTask` (the variable, not the `originalTaskId` parameter) to `planningTask` throughout the function body below the declaration.

**Important:** Do NOT rename the `originalTaskId` parameter or the `originalTaskResult` variable — only the `originalTask` / `planningTask` variable used from line 127 onward.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/useCases/submitToExecutionAgent.test.ts --reporter=verbose 2>&1 | tail -40`

Expected: All tests pass, including the 5 new resolver tests.

- [ ] **Step 5: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`

Expected: All tests pass, coverage meets thresholds.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts
git commit -m "feat(code-agent): resolve non-planning tasks to planning task in /implement endpoint

When /implement is called on a review, remediation, or re-review task,
the use case now resolves to the planning task in the same issue group
via linearIssueId using the existing findPlannedTaskByLinearIssue repo method.
This allows implementation (including fan-out) to start from any task
in a group that has completed the planning → review → remediation cycle."
```

---

### Task 3: Run CI

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-resolver.txt | tail -30`

Expected: All workspaces pass.

- [ ] **Step 2: If CI fails, capture and fix**

Run: `rg "error|FAIL" -C3 /tmp/ci-output-resolver.txt`

Fix any failures, re-run CI, commit fixes.
