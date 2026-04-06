# Restore 'Done' Code Task Groups in List View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where "done" code task groups appear in the filter badge count but show nothing in the list.

**Architecture:** The issue groups endpoint (`GET /code/issue-groups`) reconstructs groups from tasks via `groupByLinearIssue()`, but groups whose tasks are ALL filtered out (archived tasks excluded, `ask_agent` tasks excluded) silently vanish from the response while the precomputed `user_group_counts` cache still counts them. The fix adjusts the returned counts to reflect only groups that actually produced displayable tasks, preventing the count/list mismatch. A secondary fix excludes `ask_agent` tasks from summary tracking to prevent future drift.

**Tech Stack:** TypeScript, Fastify, Firestore, Vitest

---

## Root Cause Analysis

### How the bug manifests

1. The filter badge shows "Done 2" (from precomputed `user_group_counts` Firestore document)
2. User clicks "Done" filter
3. Backend queries `task_group_summaries` where `aggregateStatus = 'done'` -- returns 2 summary docs
4. For each summary, backend fetches actual tasks from `code_tasks` collection
5. Tasks are filtered: `(includeArchived || t.status !== 'archived') && t.agentType !== 'ask_agent'`
6. If ALL tasks for a summary are filtered out, `groupByLinearIssue([])` returns `[]`
7. Response: `{ groups: [], counts: { done: 2 }, totalGroups: 2 }` -- count says 2, list is empty

### Two contributing causes

1. **Group reconstruction drops empty groups**: `groupByLinearIssue()` builds groups purely from tasks. Summaries with 0 displayable tasks produce no group.
2. **`ask_agent` tasks inflate summary counts**: Summary tracking includes `ask_agent` tasks in `taskCount` and status derivation, but the display route filters them out. A group with only `ask_agent` non-archived tasks appears "done" in summaries but has 0 displayable tasks.
3. **Fire-and-forget summary updates**: The `codeTaskRepositoryWithGroupUpdates` decorator uses `void ... .catch()` for summary updates. If the Firestore transaction fails (contention, timeout), the task status changes but the summary/counts are stale. The `user_group_counts` doc can permanently drift from actual `task_group_summaries` state.

## File Structure

### Files to modify

| File                                                                                          | Responsibility                                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/code/issueGroupRoutes.ts`                                         | Adjust returned counts to match actual displayable groups                   |
| `apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts`                | Skip group summary updates for `ask_agent` tasks                            |
| `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`                               | New test cases for phantom group handling                                   |
| `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts` | Test `ask_agent` exclusion                                                  |

---

## Task 1: Fix count/list mismatch in issue groups route

The primary fix: after reconstructing groups from tasks, adjust the returned counts to subtract "phantom" summaries (those that were returned by the query but produced 0 displayable tasks).

**Files:**
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts:290-337`
- Test: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

- [ ] **Step 1: Write the failing test -- phantom done group produces corrected count**

In `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`, add a new `describe` block after the existing tests:

```typescript
describe('phantom group count correction', () => {
  it('adjusts done count when summary exists but all tasks are archived', async () => {
    // Summary says 'done' but all tasks for this group are archived
    const phantomSummary = makeSummary({
      linearIssueId: 'INT-PHANTOM',
      aggregateStatus: 'done',
      taskCount: 1,
    });
    const realSummary = makeSummary({
      linearIssueId: 'INT-REAL',
      aggregateStatus: 'done',
      taskCount: 1,
    });

    mockSummaries = [phantomSummary, realSummary];
    mockCounts = {
      ...mockCounts,
      done: 2,
      totalGroups: 2,
    };

    // Create a real task for INT-REAL (status=reviewed, visible)
    const realInput = makeTaskInput({
      linearIssueId: 'INT-REAL',
      agentType: 'planning',
    });
    const realCreateResult = await codeTaskRepo.create(realInput);
    expect(realCreateResult.ok).toBe(true);
    if (realCreateResult.ok) {
      await codeTaskRepo.update(realCreateResult.value.id, { status: 'planned' });
    }

    // Create an archived task for INT-PHANTOM (not visible when includeArchived=false)
    const phantomInput = makeTaskInput({
      linearIssueId: 'INT-PHANTOM',
      agentType: 'planning',
    });
    const phantomCreateResult = await codeTaskRepo.create(phantomInput);
    expect(phantomCreateResult.ok).toBe(true);
    if (phantomCreateResult.ok) {
      await codeTaskRepo.update(phantomCreateResult.value.id, { status: 'archived' });
    }

    setServices(makeBaseServices({
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => ok(mockCounts),
        listGroupSummaries: async () => ok({ summaries: mockSummaries }),
      }),
    }));
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=done',
      headers: { authorization: 'Bearer test-jwt' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number } };
    // Should have 1 displayable group, not 2
    expect(body.data.groups).toHaveLength(1);
    // Counts should be corrected: done reduced by 1 phantom
    expect(body.data.counts.done).toBe(1);
    expect(body.data.totalGroups).toBe(1);
  });

  it('adjusts count when summary exists but all tasks are ask_agent', async () => {
    const askAgentSummary = makeSummary({
      linearIssueId: 'INT-ASK',
      aggregateStatus: 'done',
      taskCount: 1,
    });
    mockSummaries = [askAgentSummary];
    mockCounts = { ...mockCounts, done: 1, totalGroups: 1 };

    // Create an ask_agent task (filtered out by display logic)
    const askInput = makeTaskInput({
      linearIssueId: 'INT-ASK',
      agentType: 'ask_agent',
    });
    const createResult = await codeTaskRepo.create(askInput);
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      await codeTaskRepo.update(createResult.value.id, { status: 'reviewed' });
    }

    setServices(makeBaseServices({
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => ok(mockCounts),
        listGroupSummaries: async () => ok({ summaries: mockSummaries }),
      }),
    }));
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=done',
      headers: { authorization: 'Bearer test-jwt' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number } };
    expect(body.data.groups).toHaveLength(0);
    expect(body.data.counts.done).toBe(0);
    expect(body.data.totalGroups).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: Tests FAIL because the route currently returns uncorrected counts (done: 2 when only 1 group is visible).

- [ ] **Step 3: Implement phantom group detection and count correction**

In `apps/code-agent/src/routes/code/issueGroupRoutes.ts`, after the existing group reconstruction logic (around line 290-303), add phantom detection. Replace the section from `// 5. Hydrate tasks...` through the return statement:

```typescript
        // 5. Hydrate tasks with linear issue data and group them
        const allPageTasks: SerializedTask[] = tasksByGroup.flat().map((task) => {
          if (task.linearIssueId !== undefined) {
            const linearIssue = hydratedIssuesByIdentifier.get(task.linearIssueId);
            if (linearIssue !== undefined) {
              return { ...task, linearIssue };
            }
          }
          return task;
        });

        const unsortedGroups = groupByLinearIssue(allPageTasks);
        const paginatedGroups = sortIssueGroups(unsortedGroups, sortBy);

        // 5b. Detect phantom summaries: summaries returned by the query that
        // produced zero displayable tasks (all tasks archived or ask_agent).
        // Their status must be subtracted from the precomputed counts so the
        // filter badges match what the user actually sees.
        const displayedGroupKeys = new Set(
          paginatedGroups.map((g) => g.linearIssueId ?? g.latestTask.id),
        );
        const phantomStatusDeltas: Record<string, number> = {};
        for (let i = 0; i < summaries.length; i++) {
          const summary = summaries[i]!;
          const summaryKey = summary.linearIssueId ?? summary.groupKey.replace(/^standalone_/, '');
          if (!displayedGroupKeys.has(summaryKey)) {
            const status = summary.aggregateStatus;
            phantomStatusDeltas[status] = (phantomStatusDeltas[status] ?? 0) + 1;
          }
        }

        // 6. Compute corrected counts
        const correctedCounts = {
          active: Math.max(0, countsValue.active - (phantomStatusDeltas['active'] ?? 0)),
          'needs-action': Math.max(0, countsValue.needsAction - (phantomStatusDeltas['needs-action'] ?? 0)),
          done: Math.max(0, countsValue.done - (phantomStatusDeltas['done'] ?? 0)),
          failed: Math.max(0, countsValue.failed - (phantomStatusDeltas['failed'] ?? 0)),
          archived: Math.max(0, countsValue.archived - (phantomStatusDeltas['archived'] ?? 0)),
        };

        let totalGroups: number;
        if (statusFilter !== undefined) {
          const countMap: Record<string, number> = correctedCounts;
          /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes countMap[s] typed as number | undefined; statusFilter values are always valid GroupStatus keys present in countMap, so undefined branch is unreachable @preserve */
          totalGroups = statusFilter.reduce((sum, s) => sum + (countMap[s] ?? 0), 0);
          /* v8 ignore stop @preserve */
        } else {
          totalGroups = Object.values(correctedCounts).reduce((sum, n) => sum + n, 0);
        }

        if (Object.keys(phantomStatusDeltas).length > 0) {
          request.log.warn(
            { phantomStatusDeltas, summaryCount: summaries.length, displayedCount: paginatedGroups.length },
            'Detected phantom summaries with no displayable tasks — counts corrected',
          );
        }

        request.log.info(
          { returnedGroups: paginatedGroups.length, hasMore: summariesNextCursor !== undefined },
          'Returning issue groups'
        );

        return await reply.ok({
          groups: paginatedGroups,
          counts: correctedCounts,
          totalGroups,
          ...(summariesNextCursor !== undefined && { nextCursor: summariesNextCursor }),
        });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: All tests PASS, including the new phantom group tests.

- [ ] **Step 5: Run full workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`

Expected: All tests pass, coverage maintained.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/code/issueGroupRoutes.ts apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "fix(code-agent): correct phantom group counts in issue-groups endpoint

When a summary exists but all its tasks are filtered out (archived or
ask_agent), the group disappears from the list. Detect these phantom
summaries and subtract them from the returned counts so filter badges
match the visible list."
```

---

## Task 2: Exclude ask_agent tasks from group summary tracking

Prevent the mismatch at the source: `ask_agent` tasks should not affect summary `taskCount`, `aggregateStatus`, or `user_group_counts`. This prevents future phantom groups from accumulating.

**Files:**
- Modify: `apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts:21-46`
- Test: `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`

- [ ] **Step 1: Write the failing test -- ask_agent tasks skip summary updates**

In `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`, add tests:

```typescript
it('does NOT call updateAfterCreate for ask_agent tasks', async () => {
  const askTask = makeTask({ agentType: 'ask_agent' });
  vi.mocked(inner.create).mockResolvedValue(ok(askTask));
  const updateAfterCreateSpy = vi.spyOn(groupSummaryRepo, 'updateAfterCreate');

  await decorated.create(makeCreateInput({ agentType: 'ask_agent' }));

  await Promise.resolve();
  expect(updateAfterCreateSpy).not.toHaveBeenCalled();
});

it('does NOT call updateAfterStatusChange for ask_agent tasks', async () => {
  const oldTask = makeTask({ agentType: 'ask_agent', status: 'running' });
  const newTask = makeTask({ agentType: 'ask_agent', status: 'reviewed' });
  vi.mocked(inner.findById).mockResolvedValue(ok(oldTask));
  vi.mocked(inner.update).mockResolvedValue(ok(newTask));
  const updateAfterStatusChangeSpy = vi.spyOn(groupSummaryRepo, 'updateAfterStatusChange');

  await decorated.update('task-1', { status: 'reviewed' });

  await Promise.resolve();
  expect(updateAfterStatusChangeSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL -- ask_agent tasks currently DO trigger summary updates.

- [ ] **Step 3: Implement ask_agent exclusion in the decorator**

In `apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts`, add the `ask_agent` guard:

For the `create` method, change:
```typescript
      if (result.ok) {
```
to:
```typescript
      if (result.ok && result.value.agentType !== 'ask_agent') {
```

For the `update` method, change:
```typescript
      if (result.ok && input.status !== undefined && oldTaskResult?.ok === true) {
```
to:
```typescript
      if (result.ok && input.status !== undefined && oldTaskResult?.ok === true && result.value.agentType !== 'ask_agent') {
```

For the `deleteTask` method, change:
```typescript
      if (result.ok && oldTaskResult.ok) {
```
to:
```typescript
      if (result.ok && oldTaskResult.ok && oldTaskResult.value.agentType !== 'ask_agent') {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 5: Run full workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent 2>&1 | tail -30`

Expected: All tests pass, coverage maintained.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/repositories/codeTaskRepositoryWithGroupUpdates.ts apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts
git commit -m "fix(code-agent): exclude ask_agent tasks from group summary tracking

ask_agent tasks are filtered from display in the issue-groups endpoint
but were being counted in summary taskCount and status derivation.
Skip summary updates entirely for ask_agent tasks to prevent phantom
groups from accumulating."
```

---

## Task 3: Final CI verification

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build 2>&1 | tail -10`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tail -30`

Expected: All checks pass.

- [ ] **Step 3: Verify no coverage regressions**

Check that the new code paths in `issueGroupRoutes.ts` and `codeTaskRepositoryWithGroupUpdates.ts` are fully covered by the tests added in Tasks 1 and 2.

---

## Endpoint Changes

### Modified
- `GET /code/issue-groups` -- Response `counts` object now reflects only groups with displayable tasks. Phantom summaries (where all tasks are archived or ask_agent) are subtracted from the precomputed counts. No request format changes.

### Created
None.

### Removed
None.

### Unchanged
- `POST /internal/code/group-summary/recompute`
- `POST /code/tasks/:taskId/archive`
- `POST /internal/auto-archive-merged-tasks`
