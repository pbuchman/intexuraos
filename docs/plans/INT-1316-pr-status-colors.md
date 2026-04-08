# PR Status Color-Coded Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color-code the PR badge in the code tasks list to reflect PR state (mergeable, merged, closed, open) using GitHub-inspired pastel colors.

**Architecture:** Extend `PipelineState.pr` with a `status` field derived from task data in the backend `derivePipeline()` function. Add `prMergedAt` to `SerializedTask` so the backend can detect merged PRs. Add `prClosedAt` to the domain model (set by `handlePrClose` webhook) to detect closed PRs. The frontend applies conditional Tailwind classes based on `pr.status`.

**Tech Stack:** TypeScript, Fastify (backend), React + TailwindCSS (frontend)

---

## Color Mapping

| PR State      | When                                       | Background                            | Text                                   | Border                                           | GitHub Analog        |
| ------------- | ------------------------------------------ | ------------------------------------- | -------------------------------------- | ------------------------------------------------ | -------------------- |
| **mergeable** | Merge button shown (solid green)           | `bg-green-600`                        | `text-white`                           | none                                             | Green "Merge" button |
| **open**      | PR exists, no merge action                 | `bg-green-100 dark:bg-green-900/30`   | `text-green-700 dark:text-green-400`   | `border-green-300/50 dark:border-green-600/30`   | Green open badge     |
| **merged**    | PR was merged (`prMergedAt` set)           | `bg-purple-100 dark:bg-purple-900/30` | `text-purple-700 dark:text-purple-400` | `border-purple-300/50 dark:border-purple-600/30` | Purple merged badge  |
| **closed**    | PR closed without merge (`prClosedAt` set) | `bg-red-100 dark:bg-red-900/30`       | `text-red-700 dark:text-red-400`       | `border-red-300/50 dark:border-red-600/30`       | Red closed badge     |

> Note: The **mergeable** state keeps the existing Merge button (solid green `bg-green-600` with `text-white`). No change needed there. The color changes apply to the `#{number}` badge shown when there is NO merge action.

## File Structure

| File                                                                            | Action   | Responsibility                                                                        |
| ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/models/codeTask.ts`                                 | Modify   | Add `prClosedAt` field                                                                |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`                 | Modify   | Add `prClosedAt` to `UpdateCodeTaskData`                                              |
| `apps/code-agent/src/domain/usecases/handlePrClose.ts`                          | Modify   | Set `prClosedAt` when PR closed without merge                                         |
| `apps/code-agent/src/domain/issueGrouping/types.ts`                             | Modify   | Add `prMergedAt`/`prClosedAt` to `SerializedTask`, add `status` to `PipelineState.pr` |
| `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`                | Modify   | Derive `pr.status` from task data                                                     |
| `apps/code-agent/src/routes/code/issueGroupRoutes.ts`                           | Modify   | Serialize `prMergedAt`/`prClosedAt` in `taskToSerializedTask`                         |
| `apps/web/src/types/issueGroups.ts`                                             | Modify   | Add `status` to frontend `PipelineState.pr` type                                      |
| `apps/web/src/components/code-tasks/IssueGroupRow.tsx`                          | Modify   | Apply status-based CSS classes to PR badge                                            |
| `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` | Modify   | Add tests for `pr.status` derivation                                                  |
| `apps/code-agent/src/__tests__/domain/usecases/handlePrClose.test.ts`           | Modify   | Add test for `prClosedAt`                                                             |
| `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`                 | Modify   | Add test for serialized `prMergedAt`/`prClosedAt`                                     |

## Endpoint Changes

- **Modified:** `GET /code/issue-groups` — response shape `pipeline.pr` gains a `status` field (`'open' | 'merged' | 'closed' | 'mergeable'`)
- **Created:** none
- **Removed:** none
- **Unchanged:** All other endpoints

---

### Task 1: Add `prClosedAt` to Domain Model and Repository

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:196` (after `prMergedAt`)
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts:78` (after `prMergedAt`)

- [ ] **Step 1: Write failing test for `handlePrClose` setting `prClosedAt`**

Open `apps/code-agent/src/__tests__/domain/usecases/handlePrClose.test.ts` and add a test case that verifies when `isMerged` is `false`, the `prClosedAt` field is set on discovered tasks. Follow the existing test pattern for `prMergedAt`.

```typescript
it('sets prClosedAt on discovered tasks when PR is closed without merge', async () => {
  // Arrange: create a task with a PR
  // Act: call handlePrClose with isMerged: false
  // Assert: codeTaskRepo.update was called with prClosedAt set to a Date
});
```

Look at the existing test for `prMergedAt` in the same file and mirror the pattern, changing `isMerged: true` to `isMerged: false` and asserting `prClosedAt` instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/handlePrClose.test.ts --reporter=verbose`
Expected: FAIL — `prClosedAt` not set

- [ ] **Step 3: Add `prClosedAt` to domain model**

In `apps/code-agent/src/domain/models/codeTask.ts`, after line 196 (`prMergedAt?: Timestamp;`), add:

```typescript
  prClosedAt?: Timestamp;      // When PR was closed without merge (set by handlePrClose webhook, INT-1316)
```

- [ ] **Step 4: Add `prClosedAt` to `UpdateCodeTaskData`**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, find the `UpdateCodeTaskData` interface and add after `prMergedAt`:

```typescript
  prClosedAt?: Date;  // When PR was closed without merge (INT-1316)
```

- [ ] **Step 5: Set `prClosedAt` in `handlePrClose`**

In `apps/code-agent/src/domain/usecases/handlePrClose.ts`, find the block starting at line 129 (`// --- Set prMergedAt on discovered tasks (INT-1174) ---`). After the existing `if (isMerged)` block (ending around line 147), add a parallel block for closed PRs:

```typescript
  // --- Set prClosedAt on discovered tasks (INT-1316) ---
  if (!isMerged) {
    const closedAt = new Date(sourceTimestamp);
    const taskIdsToMark = new Set<string>();

    if (findByPRResult.ok && findByPRResult.value !== null) {
      taskIdsToMark.add(findByPRResult.value.id);
    }
    if (findLatestResult.ok && findLatestResult.value !== null) {
      taskIdsToMark.add(findLatestResult.value.id);
    }

    for (const taskId of taskIdsToMark) {
      void codeTaskRepo.update(taskId, { prClosedAt: closedAt }).catch((updateErr: unknown) => {
        logger.warn({ taskId, prNumber, error: updateErr },
          'handlePrClose: failed to set prClosedAt (best-effort)');
      });
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/handlePrClose.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/domain/usecases/handlePrClose.ts apps/code-agent/src/__tests__/domain/usecases/handlePrClose.test.ts
git commit -m "feat(code-agent): add prClosedAt tracking for closed PRs (INT-1316)"
```

---

### Task 2: Extend `SerializedTask` and `PipelineState` Types (Backend)

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts`

- [ ] **Step 1: Add `prMergedAt` and `prClosedAt` to `SerializedTask`**

In `apps/code-agent/src/domain/issueGrouping/types.ts`, add two optional fields to the `SerializedTask` interface (after the `prNumber` field at line 53):

```typescript
  prMergedAt?: string;    // ISO timestamp — set when PR was merged
  prClosedAt?: string;    // ISO timestamp — set when PR was closed without merge
```

- [ ] **Step 2: Add `status` to `PipelineState.pr`**

In the same file, change the `pr` field type on line 18 from:

```typescript
  pr: { url: string; number: string } | null;
```

to:

```typescript
  pr: { url: string; number: string; status: 'open' | 'merged' | 'closed' | 'mergeable' } | null;
```

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/types.ts
git commit -m "feat(code-agent): extend pipeline types with PR status (INT-1316)"
```

---

### Task 3: Serialize `prMergedAt`/`prClosedAt` in Issue Groups Route

**Files:**
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts:33-129`

- [ ] **Step 1: Write failing test**

In `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`, add a test that verifies `prMergedAt` and `prClosedAt` are included in the serialized task output when present. Follow the existing test patterns in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add `prMergedAt`/`prClosedAt` to `taskToSerializedTask`**

In `apps/code-agent/src/routes/code/issueGroupRoutes.ts`:

1. Add to the function parameter type (after `prNumber?: number;` at line 59):

```typescript
  prMergedAt?: unknown;   // Firestore Timestamp | string
  prClosedAt?: unknown;   // Firestore Timestamp | string
```

2. Add serialization logic after the `prNumber` line (line 124), inside the optional-field block:

```typescript
  /* v8 ignore start -- test-infra: FakeFirestore update() drops Timestamp fields (isFieldValueDelete matches Timestamp.isEqual) so prMergedAt/prClosedAt cannot be reliably set in tests @preserve */
  const prMergedAt = timestampToIso(task.prMergedAt as { toDate: () => Date } | string | undefined);
  const prClosedAt = timestampToIso(task.prClosedAt as { toDate: () => Date } | string | undefined);
  if (prMergedAt !== undefined) { serialized.prMergedAt = prMergedAt; }
  if (prClosedAt !== undefined) { serialized.prClosedAt = prClosedAt; }
  /* v8 ignore stop @preserve */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/code/issueGroupRoutes.ts apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "feat(code-agent): serialize prMergedAt/prClosedAt in issue groups (INT-1316)"
```

---

### Task 4: Derive `pr.status` in `derivePipeline`

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts:128-148`
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

- [ ] **Step 1: Write failing tests for PR status derivation**

Add these test cases to `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`:

```typescript
describe('derivePipeline pr.status', () => {
  it('returns status "merged" when any task has prMergedAt', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        agentType: 'execution',
        status: 'implemented',
        prMergedAt: '2026-03-01T12:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
      }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr?.status).toBe('merged');
  });

  it('returns status "closed" when any task has prClosedAt and no prMergedAt', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        agentType: 'execution',
        status: 'implemented',
        prClosedAt: '2026-03-01T12:00:00.000Z',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
      }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr?.status).toBe('closed');
  });

  it('returns status "mergeable" when merge step is actionable', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
        linearIssue: {
          identifier: 'INT-100',
          title: 'Test',
          state: { name: 'In Progress', type: 'started' },
          priority: 2,
          assignee: null,
          labels: [{ name: 'ready-to-merge' }],
          url: 'https://linear.app/test/INT-100',
          commentCount: 0,
          lastCommentAt: null,
        },
      }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr?.status).toBe('mergeable');
  });

  it('returns status "open" when PR exists but not merged, closed, or mergeable', () => {
    const tasks = [
      makeTask({
        id: 'task-1',
        agentType: 'execution',
        status: 'implemented',
        result: { prUrl: 'https://github.com/owner/repo/pull/42' },
      }),
    ];
    const pipeline = derivePipeline(tasks);
    expect(pipeline.pr?.status).toBe('open');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts --reporter=verbose`
Expected: FAIL — `status` property doesn't exist on `pr`

- [ ] **Step 3: Implement `pr.status` derivation in `derivePipeline`**

In `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`, replace the PR extraction block (lines 128-140) with:

```typescript
  // PR step -- extract from first non-archived task that has a prUrl
  let pr: PipelineState['pr'] = null;
  for (const task of tasks) {
    if (task.status === 'archived') continue;
    const prUrl = task.result?.prUrl;
    if (prUrl !== undefined) {
      const match = PR_URL_REGEX.exec(prUrl);
      if (match?.[1] !== undefined) {
        // Derive PR status from task data
        const hasMergeStep = steps.some((s) => s.agentType === 'merge' && s.state === 'actionable');
        const isMerged = tasks.some((t) => t.prMergedAt !== undefined);
        const isClosed = tasks.some((t) => t.prClosedAt !== undefined);

        let status: 'open' | 'merged' | 'closed' | 'mergeable';
        if (isMerged) {
          status = 'merged';
        } else if (isClosed) {
          status = 'closed';
        } else if (hasMergeStep) {
          status = 'mergeable';
        } else {
          status = 'open';
        }

        pr = { url: prUrl, number: match[1], status };
        break;
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts
git commit -m "feat(code-agent): derive pr.status in pipeline (INT-1316)"
```

---

### Task 5: Update Frontend Types and PR Badge Styling

**Files:**
- Modify: `apps/web/src/types/issueGroups.ts:22`
- Modify: `apps/web/src/components/code-tasks/IssueGroupRow.tsx:355-367`

- [ ] **Step 1: Update frontend `PipelineState.pr` type**

In `apps/web/src/types/issueGroups.ts`, change line 22 from:

```typescript
  pr: { url: string; number: string } | null;
```

to:

```typescript
  pr: { url: string; number: string; status: 'open' | 'merged' | 'closed' | 'mergeable' } | null;
```

- [ ] **Step 2: Create a helper function for PR badge classes**

In `apps/web/src/components/code-tasks/IssueGroupRow.tsx`, add this helper function near the top of the file (after imports, before the component):

```typescript
function getPrBadgeClasses(status: 'open' | 'merged' | 'closed' | 'mergeable'): string {
  switch (status) {
    case 'merged':
      return 'border border-purple-300/50 bg-purple-100 text-purple-700 hover:bg-purple-200 dark:border-purple-600/30 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50';
    case 'closed':
      return 'border border-red-300/50 bg-red-100 text-red-700 hover:bg-red-200 dark:border-red-600/30 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50';
    case 'open':
      return 'border border-green-300/50 bg-green-100 text-green-700 hover:bg-green-200 dark:border-green-600/30 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50';
    case 'mergeable':
      return 'border border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/20 dark:text-green-400';
  }
}
```

- [ ] **Step 3: Update the PR badge rendering**

In `IssueGroupRow.tsx`, find the PR badge block (lines 355-367). Replace the className from the hardcoded blue styling to use the helper:

Change from:
```tsx
className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 ${px} py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400`}
```

to:
```tsx
className={`${OUTPUT_CHIP} inline-flex items-center gap-1 rounded-full ${getPrBadgeClasses(pipeline.pr.status)} ${px} py-1 text-xs font-medium transition-colors`}
```

- [ ] **Step 4: Verify build succeeds**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web`
Expected: Build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/issueGroups.ts apps/web/src/components/code-tasks/IssueGroupRow.tsx
git commit -m "feat(web): color-code PR badges by status (INT-1316)"
```

---

### Task 6: Run Full CI

- [ ] **Step 1: Build all packages first**

Run: `cd /repo && pnpm build`
Expected: All packages build successfully.

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All checks pass — lint, types, tests, coverage.

- [ ] **Step 3: Fix any issues found**

If CI fails, read the output carefully and fix. Common issues:
- Missing `status` field in test fixtures that create `PipelineState.pr` objects
- Coverage gaps in new code paths

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: address CI feedback for PR status colors (INT-1316)"
```
