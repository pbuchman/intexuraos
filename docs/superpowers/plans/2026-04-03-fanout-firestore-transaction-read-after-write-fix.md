# Fan-Out Firestore Transaction Read-After-Write Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Firestore transaction ordering violation that crashes complex task fan-out on dispatch.

**Architecture:** Remove the transactional path from `persistBatchTransactional` and rely on the existing non-transactional sequential path with manual cleanup. Fix the `update` method's post-write read-back to prevent future transaction-ordering violations when called inside external transactions.

**Tech Stack:** TypeScript, Firestore Admin SDK (`@google-cloud/firestore`), Vitest

---

## Root Cause Analysis

### Evidence

1. **PM2 log (home-dev, 15:17:04)**:
   ```
   ERROR | code-agent | Failed to create task | error={"message":"Firestore transactio…
   ERROR | Complex task fan-out failed | linearIssueId=INT-1199
   ```

2. **Code path** (`apps/code-agent/src/domain/usecases/fanOutChildTasks.ts:94-137`):
   `persistBatchTransactional` wraps all operations in a single Firestore transaction:
   - Line 95: `codeTaskRepo.update(planningTask.id, {...}, { transaction })` — this calls `transaction.update(docRef)` at `firestoreCodeTaskRepository.ts:528`, buffering a **WRITE**.
   - Line 108: `codeTaskRepo.create({...}, { transaction })` — this calls `transaction.get(query)` at `firestoreCodeTaskRepository.ts:145` for dedup checks, attempting a **READ after the buffered WRITE**.

3. **Firestore constraint**: The `@google-cloud/firestore` SDK enforces that all reads must execute before all writes in a transaction. The SDK throws when `transaction.get()` is called after `transaction.update()`/`transaction.set()`.

4. **Test mock bypasses the constraint** (`fanOutChildTasks.test.ts:100`):
   ```typescript
   runInTransaction: vi.fn(async (operation) => await operation({})),
   ```
   The mock passes `{}` as the transaction — dedup reads and buffered writes hit mock functions, never touching the real SDK. The ordering violation is invisible in tests.

5. **Secondary latent bug** (`firestoreCodeTaskRepository.ts:527-535`):
   The `update` method does `transaction.update(docRef)` then `transaction.get(docRef)` (read-back). This is also a read-after-write violation. It doesn't crash today because the SDK appears to allow re-reading the same document reference after writing to it (cached read). But it's fragile and will break if the SDK tightens enforcement.

### Why the non-transactional path works

The non-transactional fallback (`fanOutChildTasks.ts:147-192`) calls `codeTaskRepo.update()` and `codeTaskRepo.create()` sequentially WITHOUT sharing a transaction. Each `create` call runs its own internal Firestore transaction (dedup reads + write), which correctly orders reads before writes. The fallback also has manual cleanup: if a child creation fails, it deletes already-created children and reverts the parent linkage.

---

## Endpoint Changes

- **Modified:** None — this is an internal code path, no HTTP endpoints change.
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /code/tasks/:taskId/implement`, `POST /internal/code/dispatch/drain`

---

## File Structure

| File                                                                                   | Action   | Responsibility                                                                       |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts`                              | Modify   | Remove transactional path from `persistBatchTransactional`                           |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`                | Modify   | Fix `update` method's post-write read-back when inside a transaction                 |
| `apps/code-agent/src/__tests__/domain/usecases/fanOutChildTasks.test.ts`               | Modify   | Remove transactional-path tests, add regression test for sequential create isolation |
| `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts` | Modify   | Add test for `update` with transaction returning merged data without read-back       |

---

### Task 1: Fix `update` method's post-write read-back in transaction context

**Files:**
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:527-537`

The `update` method currently does `transaction.update(docRef)` then `transaction.get(docRef)` to return the updated document. When running inside an external transaction, the read-back violates Firestore's ordering constraint. Fix: when a transaction is provided, construct the return value by merging the original doc data with the applied updates instead of re-reading.

- [ ] **Step 1: Write the failing test**

In the Firestore repository test file, add a test that verifies `update` with a transaction does NOT call `transaction.get()` after `transaction.update()`. Find the existing `update` test section and add:

```typescript
it('does not read-back after writing when called with an external transaction', async () => {
  // Create a task first
  const createResult = await repo.create({
    userId: 'user-1',
    prompt: 'test task',
    sanitizedPrompt: 'test task',
    systemPromptHash: 'hash-1',
    workerType: 'claude-code',
    workerLocation: 'queued',
    repository: 'owner/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
  });
  expect(createResult.ok).toBe(true);
  if (!createResult.ok) throw new Error('Setup failed');
  const taskId = createResult.value.id;

  // Run update inside a transaction — track get calls after update
  const getCallsAfterUpdate: string[] = [];
  let updateCalled = false;

  await firestore.runTransaction(async (transaction) => {
    // Wrap transaction to spy on get/update ordering
    const originalGet = transaction.get.bind(transaction);
    const originalUpdate = transaction.update.bind(transaction);

    transaction.get = (async (...args: Parameters<typeof originalGet>) => {
      if (updateCalled) {
        getCallsAfterUpdate.push('get-after-update');
      }
      return originalGet(...args);
    }) as typeof transaction.get;

    transaction.update = ((...args: Parameters<typeof originalUpdate>) => {
      updateCalled = true;
      return originalUpdate(...args);
    }) as typeof transaction.update;

    const updateResult = await repo.update(
      taskId,
      { status: 'running' },
      { transaction },
    );
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) throw new Error('Update failed');

    // Verify the returned task has the updated status
    expect(updateResult.value.status).toBe('running');
  });

  // The key assertion: no get() calls happened after update()
  expect(getCallsAfterUpdate).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "does not read-back after writing"`
Expected: FAIL — the current `update` implementation calls `transaction.get()` after `transaction.update()`.

- [ ] **Step 3: Fix the update method to merge in-memory instead of reading back**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, replace lines 527-537:

```typescript
// BEFORE (broken):
if (options?.transaction !== undefined) {
  options.transaction.update(docRef, updateData);
} else {
  await docRef.update(updateData);
}

// Fetch updated document
const updatedDoc = options?.transaction !== undefined
  ? await options.transaction.get(docRef)
  : await docRef.get();
return ok(toCodeTask(updatedDoc as { id: string; data(): Record<string, unknown> }));
```

Replace with:

```typescript
if (options?.transaction !== undefined) {
  options.transaction.update(docRef, updateData);
  // Inside an external transaction, avoid read-after-write by merging
  // the known updates into the already-read doc data in memory.
  // Important: strip FieldValue.delete() sentinels — spread would leave
  // delete-sentinel objects in the merged result instead of omitting the
  // field. Filter them out so the returned CodeTask has a clean shape.
  const mergedData = { ...doc.data(), ...updateData };
  for (const [key, value] of Object.entries(mergedData)) {
    if (value instanceof FieldValue) {
      delete mergedData[key];
    }
  }
  return ok(toCodeTask({ id: taskId, data: () => mergedData } as { id: string; data(): Record<string, unknown> }));
}

await docRef.update(updateData);
const updatedDoc = await docRef.get();
return ok(toCodeTask(updatedDoc as { id: string; data(): Record<string, unknown> }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "does not read-back after writing"`
Expected: PASS

- [ ] **Step 5: Run full repository test suite**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
git commit -m "fix(code-agent): avoid read-after-write in update when inside external transaction

Firestore transactions require all reads before writes. The update method
was calling transaction.get() after transaction.update() to read-back the
updated document. Replace with in-memory merge of known updates.

Fixes latent bug exposed by fan-out transaction (INT-1199)."
```

---

### Task 2: Remove transactional path from `persistBatchTransactional`

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts:83-193`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/fanOutChildTasks.test.ts`

The transactional path wraps `update` + multiple `create` calls in a single Firestore transaction, violating read-before-write ordering. The non-transactional sequential path already handles partial failure with manual cleanup. Remove the transactional branch and always use the sequential path.

- [ ] **Step 1: Write the regression test**

In `apps/code-agent/src/__tests__/domain/usecases/fanOutChildTasks.test.ts`, add a test that verifies each child task creation is independent (not sharing a transaction):

```typescript
it('creates child tasks with independent create calls, not inside a shared transaction', async () => {
  const planningTask = createPlanningTask();
  const createCallTransactions: Array<FirebaseFirestore.Transaction | undefined> = [];

  mockCodeTaskRepo.create.mockImplementation(async (input: CreateTaskInput, options?: { transaction?: FirebaseFirestore.Transaction }) => {
    createCallTransactions.push(options?.transaction);
    return ok(createPlanningTask({ id: input.id, agentType: 'execution', parentTaskId: planningTask.id }));
  });

  const result = await fanOutChildTasks(createDeps(), {
    planningTask,
    userId: 'user-123',
    childIssues: [qualifyingChild1, qualifyingChild2],
    workerType: 'claude-code',
  });

  expect(result.ok).toBe(true);
  // Each create call should NOT receive a transaction option
  for (const txn of createCallTransactions) {
    expect(txn).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/usecases/fanOutChildTasks.test.ts -t "creates child tasks with independent create calls"`
Expected: FAIL — the current code passes a shared transaction to each create call.

- [ ] **Step 3: Remove the transactional branch from `persistBatchTransactional`**

In `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts`, replace the `persistBatchTransactional` function (lines 83-193). Remove the `persistWithTransaction` callback and the `runInTransaction` branch entirely. Keep only the sequential path:

```typescript
async function persistBatchTransactional(
  deps: FanOutChildTasksDeps,
  request: FanOutChildTasksRequest,
  preparedChildren: PreparedChildTask[],
  primaryChildTaskId: string,
): Promise<Result<void, FanOutChildTasksError>> {
  const { codeTaskRepo } = deps;
  const { planningTask, userId, workerType } = request;
  const childTaskIds = preparedChildren.map(({ taskId }) => taskId);
  const parentDescriptor = getFanOutParentDescriptor(planningTask);

  // Link children to the planning task first.
  // Sequential create calls follow — each runs its own internal dedup transaction,
  // which correctly orders reads before writes (unlike a shared outer transaction
  // that would violate Firestore's read-before-write constraint).
  const lockResult = await codeTaskRepo.update(planningTask.id, {
    implementationTaskId: primaryChildTaskId,
    fanOutChildTaskIds: childTaskIds,
  });
  if (!lockResult.ok) {
    return err({ code: 'internal_error', message: 'Failed to link complex child tasks to planning task' });
  }

  const createdTaskIds: string[] = [];
  for (const prepared of preparedChildren) {
    const createResult = await codeTaskRepo.create({
      id: prepared.taskId,
      userId,
      prompt: `[Fan-out from ${parentDescriptor}] ${prepared.child.identifier}`,
      sanitizedPrompt: prepared.child.identifier,
      webhookSecret: generateWebhookSecret(deps.orchestratorSecret, prepared.taskId),
      systemPromptHash: planningTask.systemPromptHash,
      workerType,
      workerLocation: 'queued',
      repository: planningTask.repository,
      baseBranch: planningTask.baseBranch,
      traceId: `execution-${planningTask.traceId}-${prepared.child.identifier}`,
      approvalEventId: `fanout_approval_${randomUUID()}`,
      linearIssueId: prepared.child.identifier,
      parentTaskId: planningTask.id,
      followUpReason: 'execution_implement',
      agentType: 'execution',
      initialStatus: 'queued',
    });
    if (!createResult.ok) {
      for (const createdTaskId of createdTaskIds) {
        await codeTaskRepo.deleteTask(createdTaskId, userId);
      }
      await codeTaskRepo.update(planningTask.id, {
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      });
      return err({
        code: 'internal_error',
        message: `Failed to create child execution task for ${prepared.child.identifier}`,
      });
    }
    createdTaskIds.push(prepared.taskId);
  }

  return ok(undefined);
}
```

Also remove the `FirebaseFirestore` import if it is no longer used by any other code in this file. Check: `import type FirebaseFirestore from '@google-cloud/firestore';` — search the file for other usages before removing.

- [ ] **Step 4: Update the test mock — remove `runInTransaction`**

In `fanOutChildTasks.test.ts`, update the mock setup (around line 96-101):

Remove `runInTransaction` from the mock object:

```typescript
mockCodeTaskRepo = {
  create: vi.fn().mockResolvedValue(ok(createPlanningTask({ id: 'task-created' }))),
  update: vi.fn().mockResolvedValue(ok(createPlanningTask({ implementationTaskId: 'task-child-1' }))),
  deleteTask: vi.fn().mockResolvedValue(ok(undefined)),
};
```

- [ ] **Step 5: Remove or update tests that reference the transactional path**

Find and update these tests:
- `'returns internal_error when runInTransaction fails'` (around line 317) — DELETE this test entirely (path no longer exists).
- Any test that sets `mockCodeTaskRepo.runInTransaction = undefined` — remove that line since `runInTransaction` is no longer in the mock.
- `'returns internal_error when non-transaction linkage update fails'` (around line 338) — rename to `'returns internal_error when linkage update fails'` and remove the `runInTransaction = undefined` line.
- `'deletes created child tasks and clears linkage when non-transaction child creation fails'` (around line 359) — rename to `'deletes created child tasks and clears linkage when child creation fails'` and remove the `runInTransaction = undefined` line.
- Any test that validates `runInTransaction` was called — update or remove.

Search the test file for ALL references to `runInTransaction` and update accordingly.

- [ ] **Step 6: Run test to verify new regression test passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/usecases/fanOutChildTasks.test.ts -t "creates child tasks with independent create calls"`
Expected: PASS

- [ ] **Step 7: Run full fan-out test suite**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/usecases/fanOutChildTasks.test.ts`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/domain/usecases/fanOutChildTasks.ts apps/code-agent/src/__tests__/domain/usecases/fanOutChildTasks.test.ts
git commit -m "fix(code-agent): remove transactional path from fan-out to fix read-after-write

persistBatchTransactional wrapped update + create calls in a single
Firestore transaction. The update buffered a write, then create attempted
dedup reads, violating Firestore's read-before-write constraint.

Remove the transactional path entirely. The sequential path with manual
cleanup on failure already existed and handles partial failures correctly.
Each create call runs its own internal dedup transaction.

Root cause of INT-1199 fan-out failure on dev (2026-04-03 15:17:04)."
```

---

### Task 3: Audit `drainTaskQueue` fan-out path for the same issue

**Files:**
- Read: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:340-360`
- Possibly modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`

The drain queue also calls `fanOutChildTasks`. Verify it doesn't have its own transactional wrapper that would reintroduce the same issue.

- [ ] **Step 1: Read the drain queue fan-out path**

Read `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` and search for `fanOutChildTasks` and `shouldFanOut` calls. Verify:
1. `drainTaskQueue` calls `fanOutChildTasks` directly (not inside an additional transaction).
2. The fallback behavior on fan-out failure is correct (falls through to normal dispatch).

- [ ] **Step 2: Run the drain queue tests**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/usecases/drainTaskQueue.test.ts`
Expected: All tests pass (no changes needed if drain queue doesn't wrap fan-out in its own transaction).

- [ ] **Step 3: Commit (if changes were needed)**

Only commit if modifications were required. Skip if the drain queue path was already correct.

---

### Task 4: Run full CI and verify

- [ ] **Step 1: Build packages**

Run: `pnpm build`
Expected: Clean build, no type errors.

- [ ] **Step 2: Run code-agent workspace verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, coverage thresholds met.

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All workspaces pass.

- [ ] **Step 4: Final commit if any cleanup needed**

Only if CI revealed issues that needed fixing.
