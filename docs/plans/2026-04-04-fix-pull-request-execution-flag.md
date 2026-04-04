# Fix `pull_request` Agent Type Incorrectly Counted as Completed Execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the divergence between write-time and read-time `aggregateStatus` computation that causes groups with `pull_request` tasks to show a Code button but not appear in the "Needs Action" filter.

**Architecture:** The group summary system has two paths that compute `aggregateStatus`: a write-time path (`deriveAggregateStatusFromSummary`) that uses precomputed boolean flags, and a read-time path (`derivePipeline` + `deriveAggregateStatus`) that derives status from actual task data. The `hasCompletedExecutionTask()` function in the write-time path incorrectly includes `pull_request` agent type as "completed execution", while the read-time path only checks for the `execution` agent type. The fix aligns the write-time path with the read-time path.

**Tech Stack:** TypeScript, Vitest, Firestore, Fastify

---

## Root Cause

`hasCompletedExecutionTask()` in `taskGroupSummaryFirestoreRepository.ts` returns `true` for `pull_request` tasks with `implemented` status:

```typescript
function hasCompletedExecutionTask(task: CodeTask): boolean {
  return (
    (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
    (task.agentType === 'pull_request' && task.status === 'implemented')  // ← BUG
  );
}
```

But `derivePipeline()` in `groupByLinearIssue.ts` only checks `stepMap.get('execution')` — it does NOT treat `pull_request` as execution. When a `pull_request` task completes with `implemented` status, the summary's `hasCompletedExecution` flag is set to `true`, blocking the `needs-action` check in `deriveAggregateStatusFromSummary`, while the read-time pipeline still shows the actionable Code button.

## Evidence

**INT-1255 production data** (`task_group_summaries`):
- `aggregateStatus: 'done'` (should be `'needs-action'`)
- `hasCompletedExecution: true` (should be `false`)
- `hasCompletedExecutionAgent: false` (correct)
- `hasCompletedPlanning: true` (correct)
- `agentTypesPresent: ['planning', 'review', 'remediation', 'pull_request']` (no `execution` type)
- Culprit: `task_2197651...` (`pull_request`, `implemented`, PR 1622)

**Data impact**: 1 non-archived group affected (INT-1255). `user_group_counts.needsAction` is 0 (should be 1), `done` inflated by 1.

## File Structure

| File                                                                                          | Action   | Responsibility                                                                                      |
| --------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`                  | Modify   | Remove `pull_request` from `hasCompletedExecutionTask`, merge with `hasCompletedExecutionAgentOnly` |
| `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts` | Modify   | Add regression test for `pull_request` scenario                                                     |
| `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`   | Modify   | Add test: `pull_request` + `implemented` must NOT set `hasCompletedExecution`                       |
| `apps/code-agent/src/__tests__/domain/issueGrouping/consistencyCheck.test.ts`                 | Create   | Consistency tests between write-time and read-time paths                                            |
| `scripts/repair-pull-request-execution-flag.ts`                                               | Create   | One-time data repair script                                                                         |

---

### Task 1: Fix `hasCompletedExecutionTask` and consolidate with `hasCompletedExecutionAgentOnly`

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts` (lines 68-77)
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`

- [ ] **Step 1: Write the failing test**

In `taskGroupSummaryFirestoreRepository.test.ts`, add a test inside the existing `updateAfterCreate` describe block:

```typescript
it('does not set hasCompletedExecution for pull_request tasks with implemented status', async () => {
  const repo = createTaskGroupSummaryFirestoreRepository({
    firestore: fakeFirestore as unknown as Firestore,
    logger,
  });
  const now = Timestamp.now();
  const task = makeTask({
    id: 'task-pr-impl',
    userId: 'user-pr',
    linearIssueId: 'INT-PR',
    agentType: 'pull_request',
    status: 'implemented',
    createdAt: now,
    updatedAt: now,
  });
  await repo.updateAfterCreate(task);

  const doc = await fakeFirestore.collection('task_group_summaries').doc('user-pr_INT-PR').get();
  expect(doc.get('hasCompletedExecution')).toBe(false);
  expect(doc.get('hasCompletedExecutionAgent')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts -t "does not set hasCompletedExecution for pull_request"`
Expected: FAIL — `hasCompletedExecution` is `true` due to current `hasCompletedExecutionTask` including `pull_request`.

- [ ] **Step 3: Fix `hasCompletedExecutionTask` to exclude `pull_request`**

In `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`, change:

```typescript
function hasCompletedExecutionTask(task: CodeTask): boolean {
  return (
    (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
    (task.agentType === 'pull_request' && task.status === 'implemented')
  );
}
```

To:

```typescript
function hasCompletedExecutionTask(task: CodeTask): boolean {
  return task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed');
}
```

Then remove the now-redundant `hasCompletedExecutionAgentOnly` function (lines 75-77) and replace all its usages with `hasCompletedExecutionTask`. There are exactly 2 call sites for `hasCompletedExecutionAgentOnly`:
1. Line ~346: `if (hasCompletedExecutionAgentOnly(task))` in `updateAfterCreate` → change to `hasCompletedExecutionTask`
2. Line ~458: `if (hasCompletedExecutionAgentOnly(newTask))` in `updateAfterStatusChange` → change to `hasCompletedExecutionTask`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts -t "does not set hasCompletedExecution for pull_request"`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts
git commit -m "fix(code-agent): exclude pull_request from hasCompletedExecutionTask

pull_request agent type was incorrectly counted as completed execution in
group summaries, causing groups to show aggregateStatus='done' instead of
'needs-action'. This diverged from the read-time derivePipeline which
only checks the execution agent type.

Also consolidates hasCompletedExecutionAgentOnly into hasCompletedExecutionTask
since they are now identical.

Fixes INT-1267"
```

---

### Task 2: Add regression test for `deriveAggregateStatusFromSummary`

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`

- [ ] **Step 1: Write the test for the divergence scenario**

Add to the existing test file:

```typescript
it('returns needs-action when planning completed and hasCompletedExecution is false (pull_request does not block)', () => {
  // Scenario: planning completed, pull_request task completed (implemented),
  // but no execution agent task completed. The summary should show needs-action.
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedPlanning: true,
      hasCompletedExecution: false,  // pull_request no longer sets this
      hasCompletedExecutionAgent: false,
      hasImplementationTaskId: false,
      hasImplementationReadyLabel: true,
    }),
  ).toBe('needs-action');
});

it('returns done when hasCompletedExecution is true from real execution agent', () => {
  // Scenario: actual execution agent completed — not needs-action
  expect(
    deriveAggregateStatusFromSummary({
      ...base,
      hasCompletedPlanning: true,
      hasCompletedExecution: true,
      hasCompletedExecutionAgent: true,
      hasImplementationTaskId: false,
      hasImplementationReadyLabel: true,
    }),
  ).toBe('done');
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts`
Expected: All tests pass (these tests validate the existing correct behavior of `deriveAggregateStatusFromSummary` — the bug was in the flag computation, not in the derivation function itself).

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/issueGrouping/deriveAggregateStatusFromSummary.test.ts
git commit -m "test(code-agent): add regression tests for pull_request execution flag scenario"
```

---

### Task 3: Add consistency test between write-time and read-time paths

**Files:**
- Create: `apps/code-agent/src/__tests__/domain/issueGrouping/consistencyCheck.test.ts`

This test constructs representative task arrays, runs both computation paths, and asserts they produce the same `aggregateStatus`. This catches future divergences.

- [ ] **Step 1: Create the consistency test file**

```typescript
/**
 * Consistency tests ensuring write-time (deriveAggregateStatusFromSummary) and
 * read-time (derivePipeline + deriveAggregateStatus) paths produce the same
 * aggregateStatus for identical task data.
 *
 * Background: INT-1267 discovered that pull_request agent type was treated
 * differently by the two paths, causing groups to appear in the wrong filter.
 */

import { describe, it, expect } from 'vitest';
import { derivePipeline, deriveAggregateStatus } from '../../../domain/issueGrouping/groupByLinearIssue.js';
import { deriveAggregateStatusFromSummary } from '../../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import type { SerializedTask } from '../../../domain/issueGrouping/types.js';

function makeSerializedTask(overrides: Partial<SerializedTask> & { id: string; status: string }): SerializedTask {
  return {
    userId: 'user-1',
    prompt: 'test',
    sanitizedPrompt: 'test',
    systemPromptHash: 'hash',
    workerType: 'opus',
    workerLocation: 'us-central1',
    repository: 'test/repo',
    baseBranch: 'development',
    traceId: 'trace-1',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build summary fields from a task array, simulating what the repository
 * decorator computes incrementally.
 */
function buildSummaryFieldsFromTasks(tasks: SerializedTask[]) {
  const ACTIVE_STATUSES = new Set(['running', 'dispatched', 'queued']);
  let activeTaskCount = 0;
  let hasCompletedPlanning = false;
  let hasCompletedExecution = false;
  let hasCompletedExecutionAgent = false;
  let hasImplementationTaskId = false;
  let hasPrUrl = false;
  let latestTaskStatus = '';
  let latestReviewNeedsRemediation: boolean | null = null;
  let taskCount = 0;

  for (const task of tasks) {
    if (task.status === 'archived') continue;
    taskCount++;
    if (ACTIVE_STATUSES.has(task.status)) activeTaskCount++;
    if (task.agentType === 'planning' && task.status === 'planned') hasCompletedPlanning = true;
    // Must match hasCompletedExecutionTask in taskGroupSummaryFirestoreRepository.ts
    if (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) {
      hasCompletedExecution = true;
      hasCompletedExecutionAgent = true;
    }
    if (task.implementationTaskId !== undefined || (task.fanOutChildTaskIds !== undefined && task.fanOutChildTaskIds.length > 0)) {
      hasImplementationTaskId = true;
    }
    if (task.result?.prUrl !== undefined) hasPrUrl = true;
    latestTaskStatus = task.status;
    if (task.agentType === 'review' && task.result !== undefined) {
      if (task.result.needs_remediation === '0') latestReviewNeedsRemediation = false;
      else if (task.result.needs_remediation === '1') latestReviewNeedsRemediation = true;
    }
  }

  return {
    taskCount,
    activeTaskCount,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasCompletedExecutionAgent,
    hasImplementationTaskId,
    hasPrUrl,
    latestTaskStatus,
    latestReviewNeedsRemediation,
    hasImplementationReadyLabel: true as boolean | undefined,
    hasMergeReadyLabel: false as boolean | undefined,
  };
}

describe('write-time vs read-time aggregateStatus consistency', () => {
  const scenarios: { name: string; tasks: SerializedTask[] }[] = [
    {
      name: 'planning completed + pull_request implemented (no execution)',
      tasks: [
        makeSerializedTask({
          id: 'task-plan',
          status: 'planned',
          agentType: 'planning',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
          linearIssue: {
            identifier: 'INT-TEST',
            title: 'Test',
            state: { name: 'In Progress', type: 'started' },
            priority: 3,
            assignee: null,
            labels: [{ name: 'ready-to-implement' }, { name: 'code-task' }],
            url: 'https://linear.app/test',
            commentCount: 0,
            lastCommentAt: null,
          },
        }),
        makeSerializedTask({
          id: 'task-pr',
          status: 'implemented',
          agentType: 'pull_request',
          createdAt: '2026-01-01T02:00:00.000Z',
          updatedAt: '2026-01-01T03:00:00.000Z',
        }),
      ],
    },
    {
      name: 'planning completed + review completed (no execution)',
      tasks: [
        makeSerializedTask({
          id: 'task-plan',
          status: 'planned',
          agentType: 'planning',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
          linearIssue: {
            identifier: 'INT-TEST',
            title: 'Test',
            state: { name: 'In Progress', type: 'started' },
            priority: 3,
            assignee: null,
            labels: [{ name: 'ready-to-implement' }, { name: 'code-task' }],
            url: 'https://linear.app/test',
            commentCount: 0,
            lastCommentAt: null,
          },
        }),
        makeSerializedTask({
          id: 'task-review',
          status: 'reviewed',
          agentType: 'review',
          createdAt: '2026-01-01T02:00:00.000Z',
          updatedAt: '2026-01-01T03:00:00.000Z',
          result: { needs_remediation: '0' },
        }),
      ],
    },
    {
      name: 'planning completed + execution completed',
      tasks: [
        makeSerializedTask({
          id: 'task-plan',
          status: 'planned',
          agentType: 'planning',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T01:00:00.000Z',
          linearIssue: {
            identifier: 'INT-TEST',
            title: 'Test',
            state: { name: 'In Progress', type: 'started' },
            priority: 3,
            assignee: null,
            labels: [{ name: 'ready-to-implement' }, { name: 'code-task' }],
            url: 'https://linear.app/test',
            commentCount: 0,
            lastCommentAt: null,
          },
        }),
        makeSerializedTask({
          id: 'task-exec',
          status: 'implemented',
          agentType: 'execution',
          createdAt: '2026-01-01T02:00:00.000Z',
          updatedAt: '2026-01-01T03:00:00.000Z',
          result: { prUrl: 'https://github.com/test/repo/pull/123' },
        }),
      ],
    },
  ];

  for (const scenario of scenarios) {
    it(`produces consistent status for: ${scenario.name}`, () => {
      // Read-time path
      const pipeline = derivePipeline(scenario.tasks);
      const readTimeStatus = deriveAggregateStatus(scenario.tasks, pipeline);

      // Write-time path (simulate summary fields)
      const summaryFields = buildSummaryFieldsFromTasks(scenario.tasks);
      const writeTimeStatus = deriveAggregateStatusFromSummary(summaryFields);

      expect(writeTimeStatus).toBe(readTimeStatus);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/code-agent && pnpm vitest run src/__tests__/domain/issueGrouping/consistencyCheck.test.ts`
Expected: All 3 scenarios pass.

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/issueGrouping/consistencyCheck.test.ts
git commit -m "test(code-agent): add consistency tests between write-time and read-time aggregateStatus paths

Ensures deriveAggregateStatusFromSummary and derivePipeline+deriveAggregateStatus
produce the same result for representative task combinations. Catches future
divergences like the pull_request bug (INT-1267)."
```

---

### Task 4: Create data repair script

**Files:**
- Create: `scripts/repair-pull-request-execution-flag.ts`

- [ ] **Step 1: Create the repair script**

Follow the pattern of `scripts/repair-archived-group-status.ts`. The script:
1. Queries `task_group_summaries` where `hasCompletedExecution == true` AND `hasCompletedExecutionAgent == false`
2. For each, sets `hasCompletedExecution = false` and recomputes `aggregateStatus` via `deriveAggregateStatusFromSummary`
3. If `aggregateStatus` changed, updates `user_group_counts` delta (decrement old, increment new)
4. Supports `--dry-run`

```typescript
#!/usr/bin/env npx tsx
/**
 * One-time repair: fix group summaries where hasCompletedExecution was set by
 * pull_request tasks instead of execution tasks.
 *
 * Root cause: hasCompletedExecutionTask() included pull_request agent type,
 * causing hasCompletedExecution=true even when no execution agent completed.
 * This blocked the needs-action check in deriveAggregateStatusFromSummary.
 *
 * Usage:
 *   npx tsx scripts/repair-pull-request-execution-flag.ts [--dry-run]
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_ID = 'intexuraos-dev-pbuchman';
const SA_KEY_PATH = '/secrets/gcp-sa.json';

if (getApps().length === 0) {
  if (existsSync(SA_KEY_PATH)) {
    const serviceAccount = JSON.parse(readFileSync(SA_KEY_PATH, 'utf-8')) as object;
    initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: PROJECT_ID,
    });
    console.log(`Initialized Firebase with service account from ${SA_KEY_PATH}`);
  } else {
    const { applicationDefault } = await import('firebase-admin/app');
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
    console.log('Initialized Firebase with application default credentials');
  }
}

const db = getFirestore();

type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed' | 'archived';

function statusToCountField(status: GroupStatus): 'active' | 'needsAction' | 'done' | 'failed' | 'archived' {
  switch (status) {
    case 'active': return 'active';
    case 'needs-action': return 'needsAction';
    case 'done': return 'done';
    case 'failed': return 'failed';
    case 'archived': return 'archived';
  }
}

function deriveAggregateStatusFromSummary(fields: {
  taskCount?: number;
  activeTaskCount: number;
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  hasCompletedExecutionAgent: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  latestTaskStatus: string;
  latestReviewNeedsRemediation: boolean | null;
  hasImplementationReadyLabel?: boolean;
  hasMergeReadyLabel?: boolean;
}): GroupStatus {
  if (fields.taskCount !== undefined && fields.taskCount <= 0) return 'archived';
  if (fields.activeTaskCount > 0) return 'active';
  if (fields.hasCompletedExecutionAgent && fields.latestReviewNeedsRemediation !== false) return 'active';
  if (fields.hasCompletedPlanning && !fields.hasCompletedExecution && !fields.hasImplementationTaskId && (fields.hasImplementationReadyLabel ?? true)) return 'needs-action';
  if (fields.hasPrUrl && fields.latestReviewNeedsRemediation === false && (fields.hasMergeReadyLabel ?? false)) return 'needs-action';
  if (fields.latestTaskStatus === 'failed' || fields.latestTaskStatus === 'interrupted') return 'failed';
  return 'done';
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // Find affected summaries
  const snap = await db.collection('task_group_summaries')
    .where('hasCompletedExecution', '==', true)
    .where('hasCompletedExecutionAgent', '==', false)
    .get();

  console.log(`Found ${snap.size} affected group summaries`);

  if (snap.size === 0) {
    console.log('Nothing to repair.');
    return;
  }

  // Group by userId for counts update
  const countDeltas = new Map<string, Map<GroupStatus, number>>();
  let repaired = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const userId = data.userId as string;
    const oldStatus = data.aggregateStatus as GroupStatus;

    // Fix the flag
    const fixed = { ...data, hasCompletedExecution: false };
    const newStatus = deriveAggregateStatusFromSummary({
      taskCount: fixed.taskCount as number | undefined,
      activeTaskCount: fixed.activeTaskCount as number,
      hasCompletedPlanning: fixed.hasCompletedPlanning === true,
      hasCompletedExecution: false,
      hasCompletedExecutionAgent: fixed.hasCompletedExecutionAgent === true,
      hasImplementationTaskId: fixed.hasImplementationTaskId === true,
      hasPrUrl: fixed.hasPrUrl === true,
      latestTaskStatus: fixed.latestTaskStatus as string,
      latestReviewNeedsRemediation: fixed.latestReviewNeedsRemediation as boolean | null,
      hasImplementationReadyLabel: fixed.hasImplementationReadyLabel as boolean | undefined,
      hasMergeReadyLabel: fixed.hasMergeReadyLabel as boolean | undefined,
    });

    console.log(`  ${data.linearIssueId ?? data.groupKey}: ${oldStatus} -> ${newStatus}`);

    if (!DRY_RUN) {
      await doc.ref.update({
        hasCompletedExecution: false,
        aggregateStatus: newStatus,
        updatedAt: Timestamp.now(),
      });
    }
    repaired++;

    // Track count deltas
    if (oldStatus !== newStatus) {
      if (!countDeltas.has(userId)) {
        countDeltas.set(userId, new Map());
      }
      const deltas = countDeltas.get(userId)!;
      deltas.set(oldStatus, (deltas.get(oldStatus) ?? 0) - 1);
      deltas.set(newStatus, (deltas.get(newStatus) ?? 0) + 1);
    }
  }

  // Apply count deltas
  for (const [userId, deltas] of countDeltas) {
    const countsRef = db.collection('user_group_counts').doc(userId);
    const countsDoc = await countsRef.get();

    if (!countsDoc.exists) {
      console.log(`  WARNING: No counts doc for user ${userId}`);
      continue;
    }

    const updates: Record<string, number> = {};
    for (const [status, delta] of deltas) {
      const field = statusToCountField(status);
      const currentValue = (countsDoc.data()?.[field] as number | undefined) ?? 0;
      updates[field] = Math.max(0, currentValue + delta);
    }

    console.log(`  Updating counts for ${userId}:`, updates);
    if (!DRY_RUN) {
      await countsRef.update({ ...updates, updatedAt: Timestamp.now() });
    }
  }

  console.log(`\nRepaired ${repaired} summaries. ${DRY_RUN ? '(DRY RUN — no changes written)' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run with --dry-run to verify**

Run: `npx tsx scripts/repair-pull-request-execution-flag.ts --dry-run`
Expected: Shows 3 affected summaries (INT-1227, INT-1243, INT-1255), with status transitions logged.

- [ ] **Step 3: Commit**

```bash
git add scripts/repair-pull-request-execution-flag.ts
git commit -m "scripts: add repair script for pull_request execution flag (INT-1267)"
```

---

### Task 5: Run full CI verification

- [ ] **Step 1: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All tests pass.

- [ ] **Step 2: Run repair script live (after deployment)**

Run: `npx tsx scripts/repair-pull-request-execution-flag.ts`
Expected: 3 summaries repaired, counts updated.
