# Fix Missing Code-Task Groups in Filtered List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the code-task group list return every group that should be visible for the active filters, with backend pagination using the same ordering semantics as the UI.

**Architecture:** Keep `/code/issue-groups` as the authoritative grouped-list endpoint and keep the response schema unchanged. Add stable Firestore sort keys to `task_group_summaries`, page by those keys instead of raw `linearIssueId`, and prevent stale archival from hiding groups that still have open GitHub pull requests.

**Safe Rollout:** Do not deploy the `GET /code/issue-groups` query switch until existing `task_group_summaries` documents have been backfilled with `linearIssueSortKey`. Firestore excludes documents that lack an `orderBy` field, so rollout must be sequenced as: add model/serializer fields and indexes, deploy and run the focused backfill, verify zero missing sort keys, then enable the new query shape.

**Tech Stack:** TypeScript, Fastify, Firestore, Vite/React consumer, Vitest, existing migration scripts.

---

## Investigation

Generated: `2026-05-06T09:20:58Z`

GitHub open PRs from `gh pr list --state open --limit 100`:

| PR | Title | Branch | Status in group summaries |
| --- | --- | --- | --- |
| #2047 | `[INT-1594] Propagate image-service usage metadata and billing facts` | `task_ee31e61e-e3d5-479f-bfea-6c9934f9c5f3` | `INT-1594`, `needs-action`, visible in default filtered first page |
| #1903 | `[INT-1423] [plan] Multi-repo support - comprehensive occurrence audit` | `plan/int-1423-multi-repo-support-v2` | `INT-1423`, `archived`, hidden unless archived groups are requested |
| #1894 | `Development 3.7` | `development` | not a code-task group |
| #1747 | `Hetzner prod env scaffold (INT-750)` | `feature/hetzner-prod-scaffold-int-750` | `INT-750`, `archived`, hidden unless archived groups are requested |

Firestore evidence from production data using `/secrets/gcp-sa.json`:

- `user_group_counts` for `google-oauth2|113131655542389277022`: `active=2`, `needsAction=1`, `done=5`, `failed=0`, `archived=773`, `totalGroups=781`.
- The default non-archived query for `GET /code/issue-groups` returns 8 summaries and includes `INT-1594` with `prNumber=2047`.
- `INT-1423` has archived tasks for open PR #1903 and a newer archived execution task for merged PR #1994; the summary stores `prNumber=1994`, so PR-number sorting does not prioritize the still-open #1903 group.
- `INT-750` has only archived tasks for draft open PR #1747.
- Archived `linear-id` sorting uses Firestore `orderBy('linearIssueId', 'desc')`, which sorts lexicographically. The first archived page starts with `INT-999`, `INT-998`, `INT-997`, not recent `INT-1601`/`INT-159x` groups. The route then re-sorts that already-paginated page numerically, so the page boundary is based on a different order than the UI displays.

Root causes:

1. `apps/code-agent/src/infra/firestore/taskGroupSummary/queries.ts` pages before the route re-sorts. For `sortBy=linear-id`, Firestore uses raw string ordering while `sortIssueGroups()` parses numeric issue numbers.
2. For standalone groups, the in-memory comparator sorts them before linked Linear issues, while Firestore `linearIssueId` ordering puts nulls in a different place.
3. `archiveStaleGroups` can archive all tasks in a group that still has an open GitHub PR because it only checks task staleness and active task status, not current PR state.
4. Once an open-PR group is archived, the default non-archived filters correctly exclude it, and the archived filter can bury it behind hundreds of paged results.

## Endpoint Changes

Modified:

- `GET /code/issue-groups`: keep request/response schema unchanged; change backend ordering for `sortBy=linear-id` so Firestore pagination uses the same numeric sort semantics as the UI only after the sort-key backfill has completed.
- `POST /internal/archive-stale-groups`: keep request/response schema unchanged; retain groups with open GitHub PRs instead of archiving them as stale.

Created:

- None.

Removed:

- None.

Unchanged:

- `GET /code/github-pr-summaries`: remains the source of GitHub PR summary data and keeps the existing response schema.
- `GET /code/tasks`: unchanged.
- Web API client response types in `apps/web/src/types/issueGroups.ts`: unchanged unless implementation chooses to expose optional diagnostics.

## Rollout Safety Gate

The implementation must keep legacy summary documents visible throughout rollout. Firestore `orderBy('linearIssueSortKey')` returns only documents that already contain `linearIssueSortKey`, so enabling that query before the backfill can hide existing groups from `/code/issue-groups`.

Required rollout order:

1. Ship Task 1 serializer/model changes so all newly written and recomputed summaries include `linearIssueNumber` and `linearIssueSortKey`.
2. Ship Task 2 Step 4 index migration and wait until the composite indexes are ready.
3. Ship Task 3 backfill script without enabling the new `linear-id` query shape.
4. Run `backfillTaskGroupSummarySortKeys.ts --dry-run`, then run it without `--dry-run`.
5. Verify the backfill reports `updated=0` on a second dry run and a direct Firestore scan finds no `task_group_summaries` documents missing `linearIssueSortKey`.
6. Only after Step 5, deploy the Task 2 Step 3 query switch from `linearIssueId` to `linearIssueSortKey`.

If the implementation must land in a single code deployment, add a temporary compatibility path instead of switching directly: either keep using `linearIssueId` until a runtime backfill-complete flag is enabled, or merge a bounded fallback query for missing-field documents before applying response pagination. Do not rely on an in-place post-deploy backfill alone to protect the query.

## File Structure

Modify:

- `apps/code-agent/src/domain/models/taskGroupSummary.ts` - add persisted sort-key fields.
- `apps/code-agent/src/infra/firestore/taskGroupSummary/serializer.ts` - compute, read, and recompute sort keys.
- `apps/code-agent/src/infra/firestore/taskGroupSummary/queries.ts` - use stable sort keys for `linear-id`.
- `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts` - ensure legacy docs can be listed and recomputed safely.
- `apps/code-agent/src/scripts/backfillGroupSummaries.ts` - ensure full recomputes write the new sort keys.
- `apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts` - add an idempotent focused backfill for existing summary docs.
- `apps/code-agent/src/domain/usecases/archiveStaleGroups.ts` - skip stale archival when any group task belongs to an open PR.
- `apps/code-agent/src/services.ts` and `apps/code-agent/src/services/types.ts` - wire `gitHubPRSummaryRepo` into stale archival.
- `migrations/105_task-group-summaries-linear-sort-key-indexes.mjs` - add composite indexes for new sort keys.

Test:

- `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts`
- `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts`
- `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`
- `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`
- `apps/code-agent/src/__tests__/usecases/archiveStaleGroups.test.ts`
- `migrations/__tests__/105-task-group-summaries-linear-sort-key-indexes.test.ts`

## Task 1: Persist Numeric Linear Sort Keys

**Files:**
- Modify: `apps/code-agent/src/domain/models/taskGroupSummary.ts`
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummary/serializer.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts`

- [ ] **Step 1: Add failing serializer tests**

Add tests that prove `INT-1601` gets numeric key `1601`, `INT-999` gets `999`, and standalone groups get a sentinel key that sorts before linked issues when ordered descending.

```typescript
it('computes numeric sort fields for Linear issue groups', () => {
  const task = makeTask({ linearIssueId: 'INT-1601' });
  const summary = buildInitialSummary(task, Timestamp.fromDate(new Date('2026-05-06T00:00:00.000Z')));

  expect(summary.linearIssueNumber).toBe(1601);
  expect(summary.linearIssueSortKey).toBe(1601);
});

it('computes standalone sort fields that sort before linked issues', () => {
  const task = makeTask({ linearIssueId: undefined });
  const summary = buildInitialSummary(task, Timestamp.fromDate(new Date('2026-05-06T00:00:00.000Z')));

  expect(summary.linearIssueNumber).toBeNull();
  expect(summary.linearIssueSortKey).toBe(Number.MAX_SAFE_INTEGER);
});
```

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts
```

Expected: FAIL because `linearIssueNumber` and `linearIssueSortKey` do not exist.

- [ ] **Step 3: Implement sort-key helpers and model fields**

Add fields to `TaskGroupSummary`:

```typescript
/** Parsed numeric issue number, e.g. INT-1601 -> 1601. Null for standalone or unparsable IDs. */
linearIssueNumber: number | null;
/** Firestore sort key for the UI's Linear sort. Standalone/unparsable groups sort first. */
linearIssueSortKey: number;
```

Add a serializer helper:

```typescript
const LINEAR_ISSUE_NUMBER_REGEX = /\w+-(\d+)/;

export function getLinearIssueSortFields(linearIssueId: string | null): {
  linearIssueNumber: number | null;
  linearIssueSortKey: number;
} {
  if (linearIssueId === null) {
    return { linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER };
  }
  const match = LINEAR_ISSUE_NUMBER_REGEX.exec(linearIssueId);
  const value = match?.[1] !== undefined ? Number(match[1]) : null;
  return {
    linearIssueNumber: value,
    linearIssueSortKey: value ?? Number.MAX_SAFE_INTEGER,
  };
}
```

Use the helper in `buildInitialSummary()`, `docToSummary()`, and `computeSummaryFromTasks()` paths so new, existing, and recomputed docs all produce the same values.

- [ ] **Step 4: Re-run serializer tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts
```

Expected: PASS.

## Task 2: Page by the Same Linear Ordering the UI Displays

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummary/queries.ts`
- Modify: `migrations/105_task-group-summaries-linear-sort-key-indexes.mjs`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`
- Test: `migrations/__tests__/105-task-group-summaries-linear-sort-key-indexes.test.ts`

- [ ] **Step 1: Add failing query and repository tests**

Add a repository test that seeds summaries for `INT-999`, `INT-1601`, and a standalone group, requests `sortBy: 'linear-id'`, and expects the page order to match `sortIssueGroups()` globally:

```typescript
it('paginates linear-id using numeric issue order instead of lexicographic ID order', async () => {
  fakeFirestore.seedCollection('task_group_summaries', [
    makeSummaryDoc({ userId: 'user-1', linearIssueId: 'INT-999', groupKey: 'INT-999', linearIssueNumber: 999, linearIssueSortKey: 999 }),
    makeSummaryDoc({ userId: 'user-1', linearIssueId: 'INT-1601', groupKey: 'INT-1601', linearIssueNumber: 1601, linearIssueSortKey: 1601 }),
    makeSummaryDoc({ userId: 'user-1', linearIssueId: null, groupKey: 'standalone_task-1', linearIssueNumber: null, linearIssueSortKey: Number.MAX_SAFE_INTEGER }),
  ]);

  const result = await repo.listGroupSummaries({
    userId: 'user-1',
    sortBy: 'linear-id',
    limit: 3,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.summaries.map((s) => s.groupKey)).toEqual([
    'standalone_task-1',
    'INT-1601',
    'INT-999',
  ]);
});
```

Add a route pagination test with `limit=2` to prove `INT-1601` is on page 1 and `INT-999` is not incorrectly promoted by lexicographic ordering.

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts src/__tests__/routes/code/issueGroups.test.ts
```

Expected: FAIL while `queries.ts` still orders by `linearIssueId`.

- [ ] **Step 3: Change the query builder after the backfill safety gate**

Do this step only after the Rollout Safety Gate is complete. If the implementation is shipped before the production backfill can run, keep the existing `linearIssueId` query active behind a backfill-complete flag or add a temporary compatibility path that keeps documents missing `linearIssueSortKey` visible.

Change the `linear-id` case in `buildListQuery()`:

```typescript
case 'linear-id':
  query = query
    .orderBy('linearIssueSortKey', 'desc')
    .orderBy('latestTaskUpdatedAt', 'desc');
  break;
```

Keep cursor handling based on `DocumentSnapshot`. Firestore will use all declared `orderBy` fields from the snapshot when applying `startAfter(startAfterDoc)`.

- [ ] **Step 4: Add immutable Firestore index migration**

Create `migrations/105_task-group-summaries-linear-sort-key-indexes.mjs`:

```javascript
export const metadata = {
  id: '105',
  name: 'task-group-summaries-linear-sort-key-indexes',
  description:
    'Composite indexes for task_group_summaries supporting numeric Linear issue sort keys with and without status filters',
  createdAt: '2026-05-06',
};

export const indexes = [
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'aggregateStatus', order: 'ASCENDING' },
      { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'task_group_summaries',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'linearIssueSortKey', order: 'DESCENDING' },
      { fieldPath: 'latestTaskUpdatedAt', order: 'DESCENDING' },
    ],
  },
];

export async function up(context) {
  console.log('  Deploying task_group_summaries numeric Linear sort-key composite indexes...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing indexes requires manual deletion via Firebase console');
}
```

Add the migration test mirroring `077-task-group-summaries-last-updated-indexes.test.ts`.

- [ ] **Step 5: Re-run focused tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts src/__tests__/routes/code/issueGroups.test.ts
pnpm test -- migrations/__tests__/105-task-group-summaries-linear-sort-key-indexes.test.ts
```

Expected: PASS.

## Task 3: Backfill Existing Summary Documents

**Files:**
- Create: `apps/code-agent/src/scripts/backfillTaskGroupSummarySortKeys.ts`
- Modify: `apps/code-agent/src/scripts/backfillGroupSummaries.ts`

- [ ] **Step 1: Add an idempotent backfill script**

Create a script that scans `task_group_summaries`, computes `getLinearIssueSortFields(linearIssueId)`, and updates only documents where either field is missing or incorrect.

```typescript
const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const db = new Firestore();
  let updated = 0;
  let scanned = 0;
  const wouldUpdate: Array<{ id: string; linearIssueNumber: number | null; linearIssueSortKey: number }> = [];
  let batch = db.batch();
  let pending = 0;

  const snapshot = await db.collection('task_group_summaries').get();
  for (const doc of snapshot.docs) {
    scanned++;
    const data = doc.data();
    const linearIssueId = data['linearIssueId'] !== undefined && data['linearIssueId'] !== null
      ? String(data['linearIssueId'])
      : null;
    const fields = getLinearIssueSortFields(linearIssueId);
    if (
      data['linearIssueNumber'] === fields.linearIssueNumber &&
      data['linearIssueSortKey'] === fields.linearIssueSortKey
    ) {
      continue;
    }
    if (dryRun) {
      wouldUpdate.push({ id: doc.id, ...fields });
    } else {
      batch.set(doc.ref, fields, { merge: true });
    }
    updated++;
    pending++;
    if (pending >= BATCH_SIZE) {
      if (!dryRun) {
        await batch.commit();
      }
      batch = db.batch();
      pending = 0;
    }
  }

  if (!dryRun && pending > 0) {
    await batch.commit();
  }
  console.log(JSON.stringify({ dryRun, scanned, updated, wouldUpdate }));
}
```

Also update `backfillGroupSummaries.ts` so any full recompute writes the two new fields. Its inline `computeSummaryFromTasks()` returns a full `TaskGroupSummary`, so it must compute `getLinearIssueSortFields(linearIssueId)` and include both `linearIssueNumber` and `linearIssueSortKey` in the returned object rather than relying on the serializer path.

- [ ] **Step 2: Dry-run against dev/prod Firestore before deployment**

Run from repo root after implementation:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json pnpm --filter code-agent exec tsx src/scripts/backfillTaskGroupSummarySortKeys.ts --dry-run
```

Expected: logs total scanned and the number of summary docs needing the new keys.

- [ ] **Step 3: Apply after indexes exist and before enabling the new query**

This is a required precondition for deploying Task 2 Step 3. The new `orderBy('linearIssueSortKey')` query must not be enabled while any legacy `task_group_summaries` document is missing the field.

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json pnpm --filter code-agent exec tsx src/scripts/backfillTaskGroupSummarySortKeys.ts
```

Expected: all existing `task_group_summaries` have `linearIssueNumber` and `linearIssueSortKey`.

- [ ] **Step 4: Verify the backfill completion gate**

Run the dry-run again:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json pnpm --filter code-agent exec tsx src/scripts/backfillTaskGroupSummarySortKeys.ts --dry-run
```

Expected: `updated=0`.

Run a direct missing-field scan:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json node -e "const {Firestore}=require('@google-cloud/firestore'); const db=new Firestore({projectId:'intexuraos-dev-pbuchman'}); db.collection('task_group_summaries').get().then((s)=>{ const missing=s.docs.filter((d)=>d.get('linearIssueSortKey')===undefined).map((d)=>d.id); console.log(JSON.stringify({missingCount:missing.length, missing:missing.slice(0,20)})); process.exit(missing.length === 0 ? 0 : 1); }).catch((e)=>{ console.error(e); process.exit(1); });"
```

Expected: `missingCount=0`. Only then enable or deploy the Task 2 Step 3 query switch.

## Task 4: Do Not Hide Groups with Open Pull Requests During Stale Archival

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/archiveStaleGroups.ts`
- Modify: `apps/code-agent/src/services.ts`
- Modify: `apps/code-agent/src/services/types.ts`
- Test: `apps/code-agent/src/__tests__/usecases/archiveStaleGroups.test.ts`

- [ ] **Step 1: Add a failing stale-archive test**

Add a test where an old group has a task with `repository='pbuchman/intexuraos'`, `prNumber=1903`, and the GitHub PR summary repo reports that PR as open. The stale archive use case must retain the group.

Define this test's `makePrSummary()` helper in `archiveStaleGroups.test.ts` by importing or duplicating the helper shape currently used in `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`; it is not already local to the stale-archive test file.

```typescript
it('retains stale groups when any task belongs to an open GitHub PR', async () => {
  const task = makeTask({
    id: 'task-open-pr',
    linearIssueId: 'INT-1423',
    repository: 'pbuchman/intexuraos',
    prNumber: 1903,
    status: 'reviewed',
    updatedAt: Timestamp.fromDate(daysAgo(20)),
  });
  repo.seed([task]);
  githubPrSummaryRepo.findAllOpen.mockResolvedValue(ok([
    makePrSummary({ repository: 'pbuchman/intexuraos', pullRequestNumber: 1903, state: 'open' }),
  ]));

  const result = await archiveStaleGroups({ staleDays: 7 });

  expect(result.ok).toBe(true);
  expect(repo.updatedTaskIds()).toEqual([]);
  expect(result.value.groupsRetained).toBe(1);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/usecases/archiveStaleGroups.test.ts
```

Expected: FAIL because stale archival ignores GitHub PR state.

- [ ] **Step 3: Implement the open-PR guard**

Extend `ArchiveStaleGroupsDeps`:

```typescript
gitHubPRSummaryRepo: Pick<GitHubPRSummaryRepository, 'findAllOpen'>;
```

Build a set once per use-case run:

```typescript
const openPrResult = await gitHubPRSummaryRepo.findAllOpen();
if (!openPrResult.ok) {
  logger.error({ error: openPrResult.error.message }, 'Failed to list open PR summaries');
  return err(new Error(openPrResult.error.message));
}
const openPrKeys = new Set(
  openPrResult.value.map((pr) => `${pr.repository}#${String(pr.pullRequestNumber)}`),
);
```

Before the stale cutoff check archives a group:

```typescript
const hasOpenPullRequest = tasks.some(
  (task) => task.prNumber !== undefined && openPrKeys.has(`${task.repository}#${String(task.prNumber)}`),
);
if (hasOpenPullRequest) {
  groupsRetained++;
  logger.info({ groupKey, taskCount, reason: 'has_open_pull_request' }, 'Retaining issue group');
  continue;
}
```

Wire the dependency from `services.ts` using the existing `gitHubPRSummaryRepo`.

- [ ] **Step 4: Re-run stale archival tests**

Run:

```bash
pnpm --filter code-agent test -- src/__tests__/usecases/archiveStaleGroups.test.ts
```

Expected: PASS.

## Task 5: Report Already Hidden Open-PR Groups Before Data Repair

**Files:**
- Create: `apps/code-agent/src/scripts/reportArchivedOpenPrGroups.ts`

- [ ] **Step 1: Add a report-only script**

Create a report script that joins `github-pr-summaries` where `state == 'open'` with archived `code_tasks` and `task_group_summaries`, and prints grouped JSON like:

```json
{
  "openPrGroupsArchived": [
    {
      "linearIssueId": "INT-1423",
      "repository": "pbuchman/intexuraos",
      "pullRequestNumber": 1903,
      "archivedTaskCount": 9,
      "summaryStatus": "archived"
    }
  ]
}
```

- [ ] **Step 2: Run the report in production data**

Run:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json pnpm --filter code-agent exec tsx src/scripts/reportArchivedOpenPrGroups.ts
```

Expected: report includes `INT-1423/#1903` and `INT-750/#1747` until repaired or intentionally left archived.

- [ ] **Step 3: Document the repair decision in the issue or follow-up plan**

Use the report to choose one of these explicit policies before writing a restore script:

- If the group was archived only by stale archival and the PR is still open, restore the latest task per agent type to its last terminal non-archived status if that status can be reconstructed from logs or task result fields.
- If the last terminal status cannot be reconstructed safely, leave the task archived and add an explicit UI/API affordance later for "open PRs with archived tasks" rather than guessing task status.

Do not mass-update archived task statuses in this implementation. The report is the safe artifact that makes hidden open-PR groups explicit; a later restoration task can use it after the status-reconstruction policy is approved.

## Verification

Run from repo root:

```bash
pnpm --filter code-agent test -- src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts src/__tests__/routes/code/issueGroups.test.ts src/__tests__/usecases/archiveStaleGroups.test.ts
pnpm test -- migrations/__tests__/105-task-group-summaries-linear-sort-key-indexes.test.ts
pnpm run verify:workspace:tracked -- code-agent
pnpm run ci:tracked
```

Expected: all commands pass.

Pre-query-switch production safety check: run Task 3 Step 4 and confirm no summary docs are missing `linearIssueSortKey`.

Manual production data check after deployment and sort-key backfill: use the same Firestore query shape as `GET /code/issue-groups` for `sortBy=linear-id` and confirm `linearIssueSortKey` orders numerically. A quick one-off check can run from `apps/code-agent`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json node -e "const {Firestore}=require('@google-cloud/firestore'); const db=new Firestore({projectId:'intexuraos-dev-pbuchman'}); db.collection('task_group_summaries').where('userId','==','google-oauth2|113131655542389277022').where('aggregateStatus','in',['archived']).orderBy('linearIssueSortKey','desc').orderBy('latestTaskUpdatedAt','desc').limit(5).get().then((s)=>console.log(s.docs.map((d)=>({linearIssueId:d.get('linearIssueId'), linearIssueSortKey:d.get('linearIssueSortKey')}))));"
```

Expected:

- Archived `linear-id` first page no longer starts at `INT-999` when newer `INT-160x` archived groups exist.
- Default non-archived first page still includes `INT-1594/#2047`.
- Report script identifies any still-archived open PR groups explicitly instead of leaving them invisible by accident.
