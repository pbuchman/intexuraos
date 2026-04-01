# Queue PR-Lock Self-Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent PR-locked queued tasks from expiring due to the 30-minute TTL, and trigger immediate queue drain when a blocking task completes.

**Architecture:** Two changes in `code-agent`: (1) Reset TTL when a queued task is skipped due to PR-lock in `drainTaskQueue`, so lock-blocked time does not count toward expiry. (2) Fire-and-forget drain call in the task-complete webhook handler, so queued tasks for the same PR are dispatched immediately when the blocker finishes.

**Tech Stack:** TypeScript, Vitest, Fastify, Firestore

---

## File Structure

| File                                                                   | Action                                | Responsibility                        |
| ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`                | Modify (lines 213-224)                | Add `queuedAt` reset on PR-lock skip  |
| `apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts` | Modify (add tests ~line 1003)         | Test TTL reset on PR-lock skip        |
| `apps/code-agent/src/routes/webhookRoutes.ts`                          | Modify (after lines 1370, 1495, 1444) | Add post-completion drain trigger     |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts`                | Modify (add tests)                    | Test drain trigger on task completion |

---

### Task 1: TTL Reset on PR-Lock Skip — Tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts` (~line 1003, inside `describe('per-PR concurrency guard and round-robin')`)

- [ ] **Step 1: Write the failing test — TTL reset on PR-lock skip**

Add this test after the existing `'skips task when dispatched/running task exists for same PR'` test (line 1003):

```typescript
it('resets queuedAt when task is skipped due to PR-lock', async () => {
  const task = createMockTask({ prNumber: 42, repository: 'pbuchman/intexuraos' });
  mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
  mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
    ok({ hasActive: true, taskId: 'running-task-999' })
  );
  mockCodeTaskRepo.update.mockResolvedValue(ok(task));

  const result = await drainTaskQueue(createDeps());

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
  }

  // Verify queuedAt was reset
  expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
    queuedAt: expect.any(Date),
  });
});
```

- [ ] **Step 2: Write the failing test — expired task with PR-lock skip does NOT expire**

Add a second test that proves a task queued 31 minutes ago but blocked by PR-lock gets its TTL reset instead of expiring:

```typescript
it('does not expire a PR-locked task even when TTL exceeded — resets queuedAt instead', async () => {
  const beyondTtl = new Date(Date.now() - 31 * 60 * 1000);
  const task = createMockTask({
    prNumber: 42,
    repository: 'pbuchman/intexuraos',
    queuedAt: Timestamp.fromDate(beyondTtl),
  });
  mockCodeTaskRepo.listQueuedByAge.mockResolvedValue(ok([task]));
  mockCodeTaskRepo.hasDispatchedOrRunningForPR.mockResolvedValue(
    ok({ hasActive: true, taskId: 'running-task-999' })
  );
  mockCodeTaskRepo.update.mockResolvedValue(ok(task));

  const result = await drainTaskQueue(createDeps());

  expect(result.ok).toBe(true);
  if (result.ok) {
    // Task stays in queue (still_busy), NOT expired
    expect(result.value).toEqual(expect.objectContaining({ action: 'still_busy' }));
  }

  // Verify queuedAt was reset (NOT marked as failed)
  expect(mockCodeTaskRepo.update).toHaveBeenCalledWith('task-123', {
    queuedAt: expect.any(Date),
  });
  expect(mockCodeTaskRepo.update).not.toHaveBeenCalledWith('task-123', expect.objectContaining({
    status: 'failed',
  }));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts -t "resets queuedAt" --reporter=verbose`
Expected: FAIL — `mockCodeTaskRepo.update` is not called (current code does `continue` without updating)

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts -t "does not expire a PR-locked" --reporter=verbose`
Expected: FAIL — current code checks TTL before PR-lock, so the task expires

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts
git commit -m "test: add failing tests for PR-lock TTL reset in drainTaskQueue

INT-1098"
```

---

### Task 2: TTL Reset on PR-Lock Skip — Implementation

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` (lines 174-225)

- [ ] **Step 1: Move PR-lock check before TTL check**

The current order is TTL-first (line 177), then PR-lock (line 213). Reverse them so PR-locked tasks are skipped (with TTL reset) before TTL can expire them.

Replace lines 174-225 with:

```typescript
    // Find first dispatchable candidate with per-PR guard + TTL check
    let task: CodeTask | null = null;
    for (const candidate of roundRobinCandidates) {
      // Per-PR concurrency guard FIRST — don't expire tasks that are merely PR-locked
      if (candidate.prNumber !== undefined) {
        const prActiveResult = await codeTaskRepo.hasDispatchedOrRunningForPR(candidate.repository, candidate.prNumber);
        if (prActiveResult.ok && prActiveResult.value.hasActive) {
          logger.info({
            taskId: candidate.id,
            repository: candidate.repository,
            prNumber: candidate.prNumber,
            activeTaskId: prActiveResult.value.taskId,
          }, 'Skipping queued task — dispatched/running task exists for same PR');

          // Reset TTL so PR-lock-blocked time does not count toward expiry
          await codeTaskRepo.update(candidate.id, { queuedAt: new Date() });

          continue;
        }
      }

      // TTL check — only for tasks that are actually dispatchable (not PR-locked)
      const queuedAt = candidate.queuedAt?.toDate() ?? candidate.createdAt.toDate();
      const ttlMs = config.queue.ttlMinutes * 60 * 1000;
      const now = Date.now();

      if (now - queuedAt.getTime() > ttlMs) {
        logger.warn({ taskId: candidate.id, queuedAt }, 'Queued task expired');
        await codeTaskRepo.update(candidate.id, {
          status: 'failed',
          error: {
            code: 'queue_timeout',
            message: `Task expired in queue after ${String(config.queue.ttlMinutes)} minutes. Workers were still busy.`,
          },
        });

        const locksToCleanup = buildLockCleanups(candidate);

        // Clear parent planning task's implementationTaskId if this was an execution agent task
        if (candidate.parentTaskId !== undefined) {
          const parentResult = await codeTaskRepo.findById(candidate.parentTaskId);
          if (parentResult.ok && parentResult.value.implementationTaskId === candidate.id) {
            const clearResult = await codeTaskRepo.update(candidate.parentTaskId, { implementationTaskId: null });
            if (!clearResult.ok) {
              logger.warn({ parentTaskId: candidate.parentTaskId, expiredTaskId: candidate.id, error: clearResult.error }, 'Failed to clear implementationTaskId on parent task after queue expiry');
            }
          }
        }

        const notifyResult = await whatsappNotifier.notifyTaskQueueExpired(candidate.userId, candidate);
        if (!notifyResult.ok) {
          logger.warn({ taskId: candidate.id, error: notifyResult.error }, 'Failed to send queue expired notification');
        }

        return ok({ action: 'expired', taskId: candidate.id, locksToCleanup });
      }

      task = candidate;
      break;
    }
```

The key changes:
1. PR-lock check moves above TTL check
2. On PR-lock skip, `queuedAt` is reset to `new Date()` before `continue`
3. TTL only fires for tasks that passed the PR-lock check (i.e., actually dispatchable)

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts -t "resets queuedAt" --reporter=verbose`
Expected: PASS

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts -t "does not expire a PR-locked" --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Run the full test file to verify no regressions**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/drainTaskQueue.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/drainTaskQueue.ts
git commit -m "fix: reset TTL on PR-lock skip to prevent premature queue expiry

Move per-PR concurrency guard before TTL check in drainTaskQueue.
When a task is skipped due to an active task on the same PR, reset
queuedAt so lock-blocked time does not count toward the 30-minute TTL.

This prevents merge-conflict and follow-up tasks from expiring while
a long-running review or implementation task holds the PR resource lock.

INT-1098"
```

---

### Task 3: Completion-Triggered Drain — Tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts` (add tests)

- [ ] **Step 1: Read the existing webhook test file structure**

Run: `head -100 apps/code-agent/src/__tests__/routes/webhooks.test.ts`

Identify:
- How the test app is set up (likely `app.inject()` pattern)
- How `getServices()` is mocked
- Where to add the new test (near existing task-complete tests)

- [ ] **Step 2: Write the failing test — drain triggered on completed task with prNumber**

Add a test in the task-complete webhook describe block. The test must verify that `drainTaskQueue` is called when a task with `prNumber` completes:

```typescript
it('triggers drain when completed task has prNumber', async () => {
  // Setup: task with prNumber completes successfully
  // The mock for drainTaskQueue should be called once
  // The webhook should still return { received: true } regardless of drain result
});
```

The exact mock setup depends on the test file structure (read in Step 1). The key assertion is:

```typescript
expect(mockDrainTaskQueue).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Write the failing test — drain NOT triggered when completed task has no prNumber**

```typescript
it('does not trigger drain when completed task has no prNumber', async () => {
  // Setup: task without prNumber completes
  expect(mockDrainTaskQueue).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Write the failing test — drain failure does not affect webhook response**

```typescript
it('returns success even when post-completion drain fails', async () => {
  // Setup: drainTaskQueue rejects with an error
  // Webhook should still return { received: true }
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts -t "triggers drain" --reporter=verbose`
Expected: FAIL

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "test: add failing tests for post-completion drain trigger

INT-1098"
```

---

### Task 4: Completion-Triggered Drain — Implementation

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (import + 3 insertion points)

- [ ] **Step 1: Add import for drainTaskQueue**

At the top of `webhookRoutes.ts`, add:

```typescript
import { drainTaskQueue } from '../domain/usecases/drainTaskQueue.js';
```

- [ ] **Step 2: Create a helper function inside the route handler**

Inside the `POST /internal/webhooks/task-complete` route handler (after the `cleanupLockIfPR` helper at ~line 823), add:

```typescript
      const triggerDrainForPR = async (): Promise<void> => {
        if (task.prNumber === undefined) return;
        logger.info({ taskId, prNumber: task.prNumber }, 'Triggering post-completion drain for same-PR queued tasks');
        try {
          const services = getServices();
          await drainTaskQueue({
            logger: services.logger,
            codeTaskRepo: services.codeTaskRepo,
            taskDispatcher: services.taskDispatcher,
            linearAgentClient: services.linearAgentClient,
            whatsappNotifier: services.whatsappNotifier,
            workerSettingsRepo: services.workerSettingsRepo,
            taskEnqueueService: services.taskEnqueueService,
            orchestratorSecret: loadConfig().orchestratorSecret,
          });
        } catch (drainErr) {
          logger.warn({ taskId, prNumber: task.prNumber, error: drainErr }, 'Post-completion drain failed (non-blocking)');
        }
      };
```

- [ ] **Step 3: Call triggerDrainForPR in the `completed` branch**

After line 1371 (`await flushPendingTaskLogLines(taskId);`), before the `return await reply.send({ received: true });`, add:

```typescript
        await triggerDrainForPR();
```

- [ ] **Step 4: Call triggerDrainForPR in the `interrupted` branch**

After line 1496 (`await flushPendingTaskLogLines(taskId);`), before the `return await reply.send({ received: true });`, add:

```typescript
        await triggerDrainForPR();
```

- [ ] **Step 5: Call triggerDrainForPR in the `failed` branch**

Find the `failed` status handler's final `flushPendingTaskLogLines` call (there are multiple exit paths in the `failed` branch — add `await triggerDrainForPR()` before each `return await reply.send({ received: true })` in the failed branch). The key exit point is after `await cleanupLockIfPR()` and `await flushPendingTaskLogLines(taskId)`.

- [ ] **Step 6: Run the new tests**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts -t "triggers drain" --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Run full webhook test suite**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts
git commit -m "fix: trigger queue drain on task completion for same-PR tasks

When a task with a prNumber completes (success, failure, or interruption),
immediately trigger drainTaskQueue to dispatch any queued tasks waiting
on the same PR resource lock. This replaces waiting for the next
Cloud Scheduler tick (up to 60s delay).

The drain call is fire-and-forget — failures are logged but do not
affect the webhook response to the orchestrator.

INT-1098"
```

---

### Task 5: Full CI Verification

**Files:** None (verification only)

- [ ] **Step 1: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS — all tests pass, coverage thresholds met

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS — no regressions in any workspace

- [ ] **Step 3: Verify coverage**

Check that no new `v8 ignore` comments were needed. The new code paths (TTL reset write, drain call) are all exercised by the new tests.
