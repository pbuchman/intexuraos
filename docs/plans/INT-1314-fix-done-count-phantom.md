# Fix Code Tasks Filter Showing Wrong 'DONE' Count

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the issue-groups endpoint so that filter badge counts are always correct, regardless of which statuses are included in the current `groupStatus` filter.

**Architecture:** The phantom detection added in commit `16533d381` only corrects counts for statuses included in the request's `statusFilter`. Counts for statuses NOT in the filter are returned as-is from the precomputed `user_group_counts` Firestore document, which includes phantom groups (groups whose only tasks are archived or ask_agent). The fix adds a secondary phantom-detection query for any status with a non-zero precomputed count that is absent from the current filter.

**Tech Stack:** TypeScript, Fastify, Firestore, Vitest

---

## Investigation Findings

### The Bug

When the web app requests `/code/issue-groups?groupStatus=active,needs-action,failed` (without "done"), the API returns `done: 2` in the counts. But when "done" IS included in the filter (`groupStatus=active,needs-action,failed,done`), the API correctly returns `done: 0`.

The filter badges always show counts from the API response, so the "Done" badge shows "(2)" even though clicking it reveals zero groups.

### Root Cause Chain

1. **Commit `174eb198a` (Apr 5)** added `ask_agent` task filtering to the display logic in `issueGroupRoutes.ts`. Tasks with `agentType === 'ask_agent'` are now excluded from the groups list.

2. **However**, the precomputed `user_group_counts` Firestore document was NOT updated. The delta functions (`applyNewGroupDelta`, `applyStatusChangeDelta`) still count groups that contain only ask_agent tasks. This created 2 "phantom" done groups — summaries exist in `task_group_summaries` with `aggregateStatus='done'`, but all their tasks are ask_agent type and get filtered out at display time.

3. **Commit `16533d381` (Apr 6)** added phantom detection to correct counts at query time. It iterates over `summaries` (returned by `listGroupSummaries`), finds summaries that produced zero displayable tasks, and subtracts them from the precomputed counts.

4. **The bug:** `listGroupSummaries` applies a Firestore `where('aggregateStatus', 'in', statusFilter)` clause. When "done" is NOT in the `statusFilter`, done summaries are never fetched. The phantom detection loop iterates only over fetched summaries, so it cannot detect done phantoms. The precomputed `done: 2` passes through uncorrected.

### Evidence

- Production logs show the web app consistently requests `groupStatus=active,needs-action,failed` (without done) as the default view
- The phantom detection warning log never fires for done phantoms because those summaries are never in scope
- The two curl examples in the issue description prove the filter-dependent behavior

### Key Files

| File                                                                                 | Role                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/code/issueGroupRoutes.ts:185-356`                        | Route handler with phantom detection (lines 304-327)                        |
| `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts:622-682` | `listGroupSummaries` — applies statusFilter at Firestore query level        |
| `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts:604-620` | `getUserGroupCounts` — returns precomputed counts                           |
| `apps/code-agent/src/domain/ports/taskGroupSummaryRepository.ts`                     | Repository interface                                                        |
| `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts:1741-1848`            | Existing phantom tests (only test the happy path where status IS in filter) |

---

## Implementation Plan

### Task 1: Add failing test — phantom count correction for statuses NOT in filter

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test inside the `phantom group count correction` describe block (after line 1848):

```typescript
it('corrects done count when done is NOT in the status filter', async () => {
  // A phantom done summary exists but "done" is not in the requested filter
  const phantomDoneSummary = makeSummary({
    linearIssueId: 'INT-PHANTOM-DONE',
    aggregateStatus: 'done',
    taskCount: 1,
  });

  // Precomputed counts say done=2, but both are phantoms
  mockCounts = {
    ...mockCounts,
    done: 2,
    totalGroups: 2,
  };

  // The main query (active,needs-action,failed) returns no summaries
  // The phantom-detection query for "done" returns the phantom summary
  const summaryRepo = makeGroupSummaryRepo({
    getUserGroupCounts: async () => ok(mockCounts),
    listGroupSummaries: async (input) => {
      if (input.statusFilter?.includes('done') === true) {
        return ok({ summaries: [phantomDoneSummary] });
      }
      return ok({ summaries: [] });
    },
  });

  // Create an ask_agent task for the phantom (filtered from display)
  const askInput = makeTaskInput({
    linearIssueId: 'INT-PHANTOM-DONE',
    agentType: 'ask_agent',
  });
  const createResult = await codeTaskRepo.create(askInput);
  expect(createResult.ok).toBe(true);

  setServices(makeBaseServices({ groupSummaryRepo: summaryRepo }));
  await server.close();
  server = await buildServer();

  // Request WITHOUT "done" in the filter
  const response = await server.inject({
    method: 'GET',
    url: '/code/issue-groups?groupStatus=active,needs-action,failed',
    headers: { authorization: 'Bearer test-jwt' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload) as {
    data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number };
  };
  // done count must be corrected to 0 even though "done" wasn't in the filter
  expect(body.data.counts['done']).toBe(0);
  expect(body.data.groups).toHaveLength(0);
  expect(body.data.totalGroups).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts -t "corrects done count when done is NOT in the status filter"`

Expected: FAIL — `done` count will be `2` instead of `0` because phantom detection doesn't cover statuses outside the filter.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "test(code-agent): add failing test for phantom done count outside filter"
```

---

### Task 2: Fix phantom detection to cover all statuses with non-zero counts

**Files:**
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts:195-327`

The fix adds a secondary query: after the main `listGroupSummaries` call, identify which statuses have non-zero precomputed counts but were NOT in the `statusFilter`. For those statuses, run an additional `listGroupSummaries` call to fetch their summaries and include them in phantom detection.

- [ ] **Step 1: Implement the fix in issueGroupRoutes.ts**

In the route handler, after line 215 (`const { summaries, nextCursor: summariesNextCursor } = summariesResult.value;`), add logic to fetch summaries for un-filtered statuses with non-zero counts:

```typescript
// 2b. Fetch summaries for statuses NOT in the current filter that have
// non-zero precomputed counts. These are needed for phantom detection
// so that badge counts are correct even for statuses not being displayed.
let phantomCheckSummaries: TaskGroupSummary[] = [];
if (statusFilter !== undefined) {
  const statusesWithCounts: GroupStatus[] = [];
  if (countsValue.active > 0 && !statusFilter.includes('active')) statusesWithCounts.push('active');
  if (countsValue.needsAction > 0 && !statusFilter.includes('needs-action')) statusesWithCounts.push('needs-action');
  if (countsValue.done > 0 && !statusFilter.includes('done')) statusesWithCounts.push('done');
  if (countsValue.failed > 0 && !statusFilter.includes('failed')) statusesWithCounts.push('failed');

  if (statusesWithCounts.length > 0) {
    const phantomResult = await summaryRepo.listGroupSummaries({
      userId,
      sortBy,
      limit: 100, // Upper bound — phantom groups are rare
      statusFilter: statusesWithCounts,
    });
    if (phantomResult.ok) {
      phantomCheckSummaries = phantomResult.value.summaries;
    }
  }
}
```

Then update the phantom detection loop (lines 304-318) to iterate over BOTH `summaries` and `phantomCheckSummaries`:

```typescript
// 5b. Detect phantom summaries across ALL statuses (both filtered and non-filtered).
const displayedGroupKeys = new Set(
  paginatedGroups.map((g) => g.linearIssueId ?? g.latestTask.id),
);
const phantomStatusDeltas: Record<string, number> = {};
const allSummariesForPhantomCheck = [...summaries, ...phantomCheckSummaries];
for (const summary of allSummariesForPhantomCheck) {
  const summaryKey = summary.linearIssueId ?? summary.groupKey.replace(/^standalone_/, '');
  if (!displayedGroupKeys.has(summaryKey)) {
    const status = summary.aggregateStatus;
    phantomStatusDeltas[status] = (phantomStatusDeltas[status] ?? 0) + 1;
  }
}
```

For the phantom-check summaries (non-filtered statuses), we need to also fetch their tasks to determine if they're truly phantoms. However, since these summaries are for statuses NOT in the display filter, they produce zero displayed groups by definition — their tasks aren't shown. The key question is: would they produce displayable tasks if the user toggled that filter on?

To determine this correctly, fetch and filter tasks for the phantom-check summaries the same way as the main summaries:

Add a task-fetching loop for `phantomCheckSummaries` (similar to lines 220-250) and include those tasks in the phantom check. Only summaries whose tasks are ALL filtered out (archived or ask_agent) are true phantoms.

**Important:** The phantom-check summaries must have their tasks fetched and filtered. A summary is a phantom only if it produces zero displayable tasks. Simply being outside the display filter does NOT make it a phantom.

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts -t "corrects done count when done is NOT in the status filter"`

Expected: PASS — done count now corrected to 0.

- [ ] **Step 3: Run all existing phantom tests to verify no regressions**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts -t "phantom"`

Expected: All phantom tests pass.

- [ ] **Step 4: Commit the fix**

```bash
git add apps/code-agent/src/routes/code/issueGroupRoutes.ts
git commit -m "fix(code-agent): detect phantom groups for statuses outside the current filter

The phantom detection added in 16533d381 only corrected counts for
statuses included in the request filter. Counts for non-filtered
statuses were returned as-is from precomputed user_group_counts,
which include phantom groups (ask_agent-only or fully-archived).

Add a secondary query to fetch summaries for any status with a
non-zero count that is absent from the filter. Fetch and filter
their tasks to identify true phantoms, then subtract from counts."
```

---

### Task 3: Add edge-case tests

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

- [ ] **Step 1: Add test for mixed phantom and real groups across filter boundary**

```typescript
it('corrects counts for multiple non-filtered statuses with phantoms', async () => {
  // done=2 (both phantom), failed=1 (phantom) — none in the filter
  mockCounts = {
    ...mockCounts,
    done: 2,
    failed: 1,
    totalGroups: 3,
  };

  const phantomDone1 = makeSummary({ linearIssueId: 'INT-PD1', aggregateStatus: 'done', taskCount: 1 });
  const phantomDone2 = makeSummary({ linearIssueId: 'INT-PD2', aggregateStatus: 'done', taskCount: 1 });
  const phantomFailed = makeSummary({ linearIssueId: 'INT-PF', aggregateStatus: 'failed', taskCount: 1 });

  const summaryRepo = makeGroupSummaryRepo({
    getUserGroupCounts: async () => ok(mockCounts),
    listGroupSummaries: async (input) => {
      const filter = input.statusFilter ?? [];
      const results: TaskGroupSummary[] = [];
      if (filter.includes('done')) results.push(phantomDone1, phantomDone2);
      if (filter.includes('failed')) results.push(phantomFailed);
      return ok({ summaries: results });
    },
  });

  // Create ask_agent tasks for all phantoms
  for (const id of ['INT-PD1', 'INT-PD2', 'INT-PF']) {
    const input = makeTaskInput({ linearIssueId: id, agentType: 'ask_agent' });
    await codeTaskRepo.create(input);
  }

  setServices(makeBaseServices({ groupSummaryRepo: summaryRepo }));
  await server.close();
  server = await buildServer();

  const response = await server.inject({
    method: 'GET',
    url: '/code/issue-groups?groupStatus=active,needs-action',
    headers: { authorization: 'Bearer test-jwt' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload) as {
    data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number };
  };
  expect(body.data.counts['done']).toBe(0);
  expect(body.data.counts['failed']).toBe(0);
  expect(body.data.totalGroups).toBe(0);
});
```

- [ ] **Step 2: Add test for no false correction when non-filtered status has real groups**

```typescript
it('does not subtract real groups from non-filtered status counts', async () => {
  // done=1 with a real (non-phantom) task — should stay at 1
  mockCounts = { ...mockCounts, done: 1, totalGroups: 1 };

  const realDoneSummary = makeSummary({
    linearIssueId: 'INT-REAL-DONE',
    aggregateStatus: 'done',
    taskCount: 1,
  });

  const summaryRepo = makeGroupSummaryRepo({
    getUserGroupCounts: async () => ok(mockCounts),
    listGroupSummaries: async (input) => {
      if (input.statusFilter?.includes('done') === true) {
        return ok({ summaries: [realDoneSummary] });
      }
      return ok({ summaries: [] });
    },
  });

  // Create a real planning task (not ask_agent, not archived)
  const realInput = makeTaskInput({
    linearIssueId: 'INT-REAL-DONE',
    agentType: 'planning',
  });
  const createResult = await codeTaskRepo.create(realInput);
  expect(createResult.ok).toBe(true);
  if (createResult.ok) {
    await codeTaskRepo.update(createResult.value.id, { status: 'planned' });
  }

  setServices(makeBaseServices({ groupSummaryRepo: summaryRepo }));
  await server.close();
  server = await buildServer();

  const response = await server.inject({
    method: 'GET',
    url: '/code/issue-groups?groupStatus=active,needs-action,failed',
    headers: { authorization: 'Bearer test-jwt' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload) as {
    data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number };
  };
  // done count should remain 1 — real group, not a phantom
  expect(body.data.counts['done']).toBe(1);
});
```

- [ ] **Step 3: Run all tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "test(code-agent): add edge-case tests for cross-filter phantom detection"
```

---

### Task 4: Run full CI verification

- [ ] **Step 1: Build packages**

Run: `cd /repo && pnpm build`

- [ ] **Step 2: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

- [ ] **Step 3: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All checks pass.

- [ ] **Step 4: Final commit if any CI-driven fixes needed**

---

## Endpoint Changes

- **Modified:** `GET /code/issue-groups` — phantom detection now covers all statuses with non-zero precomputed counts, not just those in the `groupStatus` filter. Adds one additional Firestore read when non-filtered statuses have non-zero counts.
- **Created:** None
- **Removed:** None
- **Unchanged:** All other endpoints
