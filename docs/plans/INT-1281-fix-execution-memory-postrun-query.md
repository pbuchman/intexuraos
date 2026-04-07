# Fix Execution Memory Post-Run Query & Retry Errored Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `listPendingExecutionMemoryPostRun` Firestore query to include all memory-eligible agent types, and create a migration to reset errored post-run tasks so the fixed evaluator can reprocess them.

**Architecture:** The execution memory backlog processor queries `code_tasks` with `executionMemoryPostRun.status === 'pending'` but filters only `agentType in ['execution', 'planning', 'review']`. Since INT-1268 added `remediation` and `pull_request` to the eligible agent set, these tasks get marked `pending` but are never picked up. The fix aligns the query filter with `MEMORY_ELIGIBLE_AGENTS`. A one-time migration resets the 3 errored tasks (which hit the now-fixed evaluation schema parse bug) back to `pending`.

**Tech Stack:** TypeScript, Firestore, Vitest

---

## Investigation Report

### Production Data (39 non-archived successful tasks since April 4, 2026)

| Metric                        | Count   | Details                                                         |
| ----------------------------- | ------- | --------------------------------------------------------------- |
| **Memory retrieval: matched** | 4       | 3 memories each, scores 0.7-0.717                               |
| **Memory retrieval: none**    | 33      | Retrieval ran, no matches above 0.68 threshold                  |
| **Memory retrieval: error**   | 1       | `application_repo_unavailable` (transient deploy issue)         |
| **Memory retrieval: null**    | 1       | Remediation task dispatched before eligibility fix              |
| **Post-run: completed**       | 26      | Distillation + evaluation succeeded                             |
| **Post-run: pending**         | 9       | ALL are `remediation` agentType, 0 attempts - **stuck forever** |
| **Post-run: error**           | 3       | Evaluation schema parse failure (`summary` field missing)       |
| **Post-run: null**            | 1       | Same task with null retrieval context                           |

### Root Causes

**Bug 1 (CRITICAL): `listPendingExecutionMemoryPostRun` query excludes remediation/pull_request agents**

- **File:** `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:1034`
- **Current query filter:** `.where('agentType', 'in', ['execution', 'planning', 'review'])`
- **Should be:** `.where('agentType', 'in', ['execution', 'planning', 'review', 'remediation', 'pull_request'])`
- **Impact:** 9 remediation tasks permanently stuck with `executionMemoryPostRun.status = 'pending'`
- **Root cause:** When INT-1268 added `remediation` and `pull_request` to `MEMORY_ELIGIBLE_AGENTS`, the Firestore query in the repository was not updated to match.

**Bug 2 (MODERATE): Errored post-run tasks have no retry mechanism**

- **3 tasks** hit the evaluation schema parse bug (missing `summary` field, no repair logic)
- The evaluation repair logic was added in INT-1268 fix, but these tasks already exhausted their 3 retry attempts
- No mechanism exists to reset `errored` tasks back to `pending` for reprocessing
- **Fix:** One-time Firestore migration to reset `attempts` and `status` for these specific tasks

**Already Fixed (in current codebase, deployed via INT-1268):**
- Vector scoring: `distanceResultField: 'vectorDistance'` now properly set
- Evaluation schema repair: retry logic with refinement prompt added
- Memory eligibility: `remediation` and `pull_request` added to eligible set
- `EVALUATION_SCHEMA_BLOCK`: added to evaluation prompts

### Tasks With Memory Injected

| Task ID         | Agent     | Memories Injected                                                                                                                                                        |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task_507fff19` | execution | `mem_1cc9e496` (Ensure Execution Requires Explicit User Trigger), `mem_faf3aaab` (COMPLEX classification), `mem_60538ec6` (Pre-review file path verification)            |
| `task_868e1c9b` | execution | `mem_60538ec6` (Pre-review file path verification), `mem_1cc9e496` (Ensure Execution Requires Explicit User Trigger), `mem_99413905` (Inaccurate file paths in planning) |
| `task_c790c803` | review    | `mem_1cc9e496` (Ensure Execution Requires Explicit User Trigger), `mem_60538ec6` (Pre-review file path verification), `mem_faf3aaab` (COMPLEX classification)            |
| `task_c9c2c6de` | review    | `mem_60538ec6` (Pre-review file path verification), `mem_1cc9e496` (Ensure Execution Requires Explicit User Trigger), `mem_99413905` (Inaccurate file paths in planning) |

---

## File Structure

| Action   | File                                                                                                   | Responsibility                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:1034`                           | Update `agentType` filter in `listPendingExecutionMemoryPostRun` |
| Modify   | `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.executionMemory.test.ts` | Add tests for remediation/pull_request agent types               |
| Create   | `migrations/080_reset-errored-execution-memory-postrun.mjs`                                            | One-time migration to reset 3 errored tasks                      |

---

## Task 1: Fix `listPendingExecutionMemoryPostRun` Query Filter

**Files:**
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:1031-1038`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.executionMemory.test.ts`

- [ ] **Step 1: Read current implementation and test file**

Read the `listPendingExecutionMemoryPostRun` method at line 1031 and the existing test file to understand patterns.

```bash
# Verify the current filter
grep -n "listPendingExecutionMemoryPostRun" apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
```

- [ ] **Step 2: Write failing test for remediation agent type**

Add a test that creates a task with `agentType: 'remediation'` and `executionMemoryPostRun.status: 'pending'`, calls `listPendingExecutionMemoryPostRun`, and asserts the task is included in results.

```typescript
it('includes remediation tasks in pending post-run results', async () => {
  const taskId = 'task_remediation-pending';
  await firestoreAdmin.collection('code_tasks').doc(taskId).set({
    ...baseTaskData,
    agentType: 'remediation',
    status: 'implemented',
    completedAt: Timestamp.now(),
    executionMemoryPostRun: {
      status: 'pending',
      attempts: 0,
      generatedMemoryIds: [],
    },
  });

  const result = await repo.listPendingExecutionMemoryPostRun(10);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.some((t) => t.id === taskId)).toBe(true);
});
```

- [ ] **Step 3: Write failing test for pull_request agent type**

```typescript
it('includes pull_request tasks in pending post-run results', async () => {
  const taskId = 'task_pr-pending';
  await firestoreAdmin.collection('code_tasks').doc(taskId).set({
    ...baseTaskData,
    agentType: 'pull_request',
    status: 'implemented',
    completedAt: Timestamp.now(),
    executionMemoryPostRun: {
      status: 'pending',
      attempts: 0,
      generatedMemoryIds: [],
    },
  });

  const result = await repo.listPendingExecutionMemoryPostRun(10);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.some((t) => t.id === taskId)).toBe(true);
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: Tests FAIL because the current query filter excludes `remediation` and `pull_request`.

- [ ] **Step 5: Fix the query filter**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, update line 1034:

```typescript
// Before:
.where('agentType', 'in', ['execution', 'planning', 'review'])

// After:
.where('agentType', 'in', ['execution', 'planning', 'review', 'remediation', 'pull_request'])
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: All tests PASS including the two new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts \
       apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.executionMemory.test.ts
git commit -m "fix(code-agent): include remediation and pull_request in post-run query

The listPendingExecutionMemoryPostRun query filtered agentType to only
execution/planning/review, but MEMORY_ELIGIBLE_AGENTS also includes
remediation and pull_request since INT-1268. This caused 9 remediation
tasks to be permanently stuck with pending post-run status.

Fixes INT-1281"
```

---

## Task 2: Create Migration to Reset Errored Post-Run Tasks

**Files:**
- Create: `migrations/080_reset-errored-execution-memory-postrun.mjs`

- [ ] **Step 1: Check current migration numbering**

```bash
ls migrations/*.mjs | tail -5
```

Verify the next available migration number (should be 080 based on existing files).

- [ ] **Step 2: Write the migration**

Create `migrations/080_reset-errored-execution-memory-postrun.mjs`:

```javascript
// Migration: Reset errored execution memory post-run tasks
//
// Context: Three tasks hit the evaluation schema parse bug (missing `summary`
// field with no repair logic). The bug was fixed in INT-1268 (evaluation schema
// repair + EVALUATION_SCHEMA_BLOCK), but these tasks exhausted their 3 retry
// attempts before the fix was deployed. This migration resets them to `pending`
// so the fixed backlog processor can reprocess them.
//
// Affected tasks:
// - task_507fff19-10e5-4abb-a038-c74639aebc7d (execution, INT-1271)
// - task_868e1c9b-0add-418a-9afe-1f143bcba68a (execution, INT-1272)
// - task_c9c2c6de-d666-4e68-a4dd-cf4a16c292e9 (review, INT-1272)

/** @param {import('firebase-admin').firestore.Firestore} db */
export async function up(db) {
  const taskIds = [
    'task_507fff19-10e5-4abb-a038-c74639aebc7d',
    'task_868e1c9b-0add-418a-9afe-1f143bcba68a',
    'task_c9c2c6de-d666-4e68-a4dd-cf4a16c292e9',
  ];

  const batch = db.batch();

  for (const taskId of taskIds) {
    const ref = db.collection('code_tasks').doc(taskId);
    batch.update(ref, {
      'executionMemoryPostRun.status': 'pending',
      'executionMemoryPostRun.attempts': 0,
      'executionMemoryPostRun.errorMessage': null,
    });
  }

  await batch.commit();

  console.log(`Reset ${taskIds.length} errored execution memory post-run tasks to pending`);
}
```

- [ ] **Step 3: Commit**

```bash
git add migrations/080_reset-errored-execution-memory-postrun.mjs
git commit -m "chore(migration): reset 3 errored execution memory post-run tasks

These tasks hit the evaluation schema parse bug (missing summary field)
before the INT-1268 fix added repair logic. Reset to pending so the
fixed backlog processor can reprocess them.

Refs INT-1281"
```

---

## Task 3: Run Full Verification

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

- [ ] **Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: All checks PASS.

- [ ] **Step 3: Commit any remaining fixes and create PR**

---

## Endpoint Changes

- **Modified:** None
- **Created:** None
- **Removed:** None
- **Unchanged:** `POST /internal/execution-memory/process` (behavior change: now processes remediation and pull_request tasks)
