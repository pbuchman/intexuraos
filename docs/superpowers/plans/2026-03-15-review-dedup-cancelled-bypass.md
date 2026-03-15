# Review Dedup Cancelled-Task Bypass Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that terminal-status tasks (cancelled, failed, interrupted, archived) do not block the dedup check (Layer 2), so a review replacement flow (cancel old → create new) always succeeds.

**Architecture:** The dedup query in `firestoreCodeTaskRepository.create()` currently matches ANY task with the same `dedupKey` created in the last 5 minutes, regardless of status. We use application-level filtering to skip terminal tasks after the query returns. This approach is chosen over a Firestore `not-in`/`in` query filter for two reasons: (1) FakeFirestore does not support `not-in`, so tests would silently pass without exercising the filter, and (2) adding `in` or `not-in` on a field different from the range field (`createdAt`) requires a composite index. Application-level filtering with `limit(5)` avoids both issues while remaining safe — having 5+ tasks with the same dedupKey in a 5-minute window is extremely unlikely.

**Design decision — which statuses bypass dedup:** Only tasks with active statuses (`queued`, `dispatched`, `running`) should block dedup. All terminal statuses (`cancelled`, `failed`, `interrupted`, `archived`, `completed`, `planned`, `implemented`, `reviewed`) bypass it. Rationale: a terminal task is not doing work and should not prevent a new task with the same prompt. We reuse the existing `ACTIVE_TASK_STATUSES` constant (line 29) for the check.

**Tech Stack:** TypeScript, Firestore, Vitest, `@intexuraos/infra-firestore` (FakeFirestore)

---

## File Structure

- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` — application-level status filter in Layer 2 dedup
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts` — tests for terminal-status bypass

## Endpoint Changes

- Modified: none
- Created: none
- Removed: none
- Unchanged: all

---

### Task 1: Repository — Terminal-status tasks bypass Layer 2 dedup

**Files:**
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:125-152`

- [ ] **Step 1: Write the failing test — cancelled task does not block dedup**

Add after the existing "Layer 2: allows same prompt after 5 minutes" test (~line 248):

```typescript
it('Layer 2: allows same prompt when previous task was cancelled', async () => {
  const repo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });

  const input = createTaskInput();
  const first = await repo.create(input);
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  // Cancel the first task (simulates review_replaced flow)
  await repo.update(first.value.id, {
    status: 'cancelled',
    completedAt: new Date(),
    error: { code: 'review_replaced', message: 'Replaced by fresh review' },
  });

  // Same prompt within 5 minutes — should succeed because first is cancelled
  const second = await repo.create(input);
  expect(second.ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "Layer 2: allows same prompt when previous task was cancelled"`
Expected: FAIL with `expected true, received false` (second.ok is false because dedup blocks it)

- [ ] **Step 3: Write a second failing test — failed task does not block dedup**

Add immediately after the previous test:

```typescript
it('Layer 2: allows same prompt when previous task failed', async () => {
  const repo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });

  const input = createTaskInput();
  const first = await repo.create(input);
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  // Fail the first task
  await repo.update(first.value.id, {
    status: 'failed',
    completedAt: new Date(),
    error: { code: 'worker_error', message: 'Container crashed' },
  });

  // Same prompt within 5 minutes — should succeed because first failed
  const second = await repo.create(input);
  expect(second.ok).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "Layer 2: allows same prompt when previous task failed"`
Expected: FAIL

- [ ] **Step 5: Write a third failing test — interrupted task does not block dedup**

```typescript
it('Layer 2: allows same prompt when previous task was interrupted', async () => {
  const repo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });

  const input = createTaskInput();
  const first = await repo.create(input);
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  await repo.update(first.value.id, {
    status: 'interrupted',
    completedAt: new Date(),
  });

  const second = await repo.create(input);
  expect(second.ok).toBe(true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "Layer 2: allows same prompt when previous task was interrupted"`
Expected: FAIL

- [ ] **Step 7: Write a regression test — active task still blocks dedup**

This confirms the fix does not weaken dedup for in-progress tasks:

```typescript
it('Layer 2: still blocks same prompt when previous task is active (running)', async () => {
  const repo = createFirestoreCodeTaskRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });

  const input = createTaskInput();
  const first = await repo.create(input);
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  // Task is dispatched (active) — should still block
  await repo.update(first.value.id, { status: 'dispatched' });

  const second = await repo.create(input);
  expect(second.ok).toBe(false);
  if (second.ok) return;
  expect(second.error.code).toBe('DUPLICATE_PROMPT');
});
```

- [ ] **Step 8: Run regression test to verify it passes (already works with current code)**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "Layer 2: still blocks same prompt when previous task is active"`
Expected: PASS (existing behavior unchanged)

- [ ] **Step 9: Implement the fix — application-level status filter in Layer 2**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, replace lines 125-152:

**Before:**
```typescript
        // Layer 2: Check dedupKey within 5-minute window (design lines 1543-1554)
        // Skip dedup for retried tasks — same prompt is intentional
        // Skip dedup for execution follow-up tasks — implementation reuses planning prompt by design
        if (
          input.retriedFrom === undefined &&
          input.followUpReason !== 'execution_implement'
        ) {
          const dedupQuery = collection
            .where('dedupKey', '==', dedupKey)
            .where('createdAt', '>', Timestamp.fromDate(dedupWindowStart))
            .limit(1);
          const dedupSnapshot = await transaction.get(dedupQuery);

          if (!dedupSnapshot.empty) {
            const existingTask = dedupSnapshot.docs[0]!;
            logger.info({
              dedupLayer: 2,
              dedupType: 'DUPLICATE_PROMPT',
              existingTaskId: existingTask.id,
              dedupKey,
            }, 'Dedup triggered: duplicate prompt within 5 minutes');
            return err({
              code: 'DUPLICATE_PROMPT',
              message: 'Duplicate prompt within 5 minutes',
              existingTaskId: existingTask.id,
            } as const);
          }
        }
```

**After:**
```typescript
        // Layer 2: Check dedupKey within 5-minute window (design lines 1543-1554)
        // Skip dedup for retried tasks — same prompt is intentional
        // Skip dedup for execution follow-up tasks — implementation reuses planning prompt by design
        if (
          input.retriedFrom === undefined &&
          input.followUpReason !== 'execution_implement'
        ) {
          const dedupQuery = collection
            .where('dedupKey', '==', dedupKey)
            .where('createdAt', '>', Timestamp.fromDate(dedupWindowStart))
            .limit(5);
          const dedupSnapshot = await transaction.get(dedupQuery);

          // Only active tasks block dedup — terminal tasks (cancelled, failed, etc.) are ignored
          const activeStatuses: readonly string[] = ACTIVE_TASK_STATUSES;
          const activeMatch = dedupSnapshot.docs.find(
            (doc) => activeStatuses.includes(String(doc.data()['status']))
          );
          if (activeMatch !== undefined) {
            logger.info({
              dedupLayer: 2,
              dedupType: 'DUPLICATE_PROMPT',
              existingTaskId: activeMatch.id,
              dedupKey,
            }, 'Dedup triggered: duplicate prompt within 5 minutes');
            return err({
              code: 'DUPLICATE_PROMPT',
              message: 'Duplicate prompt within 5 minutes',
              existingTaskId: activeMatch.id,
            } as const);
          }
        }
```

Key changes:
- `limit(1)` → `limit(5)` to fetch enough candidates to find an active one past any terminal tasks
- Replace `!dedupSnapshot.empty` check with `activeMatch` check that filters by `ACTIVE_TASK_STATUSES` (`queued`, `dispatched`, `running`)
- No Firestore query-level operator changes, no composite index needed

- [ ] **Step 10: Run all new tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -t "Layer 2"`
Expected: ALL Layer 2 tests PASS (both new and existing)

- [ ] **Step 11: Run the full repository test file to verify no regressions**

Run: `cd apps/code-agent && npx vitest run src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
Expected: All tests PASS

- [ ] **Step 12: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
git commit -m "fix: terminal-status tasks no longer block Layer 2 dedup check

Only active tasks (queued/dispatched/running) should block duplicate
prompt creation. Terminal tasks (cancelled, failed, interrupted, etc.)
are filtered out via application-level check after query.

This fixes the review replacement flow where cancel-then-create would
hit DUPLICATE_PROMPT because the cancelled task still matched the
dedup query. Uses app-level filtering (not Firestore not-in) to avoid
composite index requirement and FakeFirestore operator gap."
```

---

### Task 2: Verify CI

- [ ] **Step 1: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS — all tests pass, coverage meets threshold

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: PASS
