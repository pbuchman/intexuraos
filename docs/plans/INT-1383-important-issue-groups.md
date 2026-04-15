# Issue Group "Important" Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to mark issue groups as "important" with a visual indicator (exclamation-mark icon on orange/amber background) that persists in Firestore.

**Architecture:** Add an `isImportant` boolean field to the `TaskGroupSummary` Firestore document. Expose a new `POST /code/issue-groups/:groupKey/important` toggle endpoint behind Auth0 JWT. Surface the flag through the existing `GET /code/issue-groups` response. On the frontend, render a clickable icon before the archive checkbox in `IssueGroupRow`, calling the new endpoint optimistically.

**Tech Stack:** Fastify (backend), Firestore (persistence), React + TailwindCSS + Lucide icons (frontend), Vitest (testing)

---

## File Structure

| Action   | File                                                                         | Responsibility                                                   |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/models/taskGroupSummary.ts`                      | Add `isImportant?: boolean` to `TaskGroupSummary`                |
| Modify   | `apps/code-agent/src/domain/ports/taskGroupSummaryRepository.ts`             | Add `setImportant()` method to repository port                   |
| Modify   | `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts` | Implement `setImportant()`, read `isImportant` in `docToSummary` |
| Modify   | `apps/code-agent/src/__tests__/fakes/fakeTaskGroupSummaryRepository.ts`      | Implement `setImportant()` in fake                               |
| Modify   | `apps/code-agent/src/domain/issueGrouping/types.ts`                          | Add `isImportant?: boolean` to backend `IssueGroup` type         |
| Modify   | `apps/code-agent/src/routes/code/issueGroupRoutes.ts`                        | Add toggle endpoint + attach `isImportant` to GET response       |
| Modify   | `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`              | Tests for toggle endpoint + isImportant in GET response          |
| Modify   | `apps/web/src/types/issueGroups.ts`                                          | Add `isImportant?: boolean` to frontend `IssueGroup` type        |
| Modify   | `apps/web/src/services/issueGroupsApi.ts`                                    | Add `setGroupImportant()` API function                           |
| Modify   | `apps/web/src/components/code-tasks/IssueGroupRow.tsx`                       | Add important toggle icon button                                 |
| Modify   | `apps/web/src/pages/CodeTasksPage.tsx`                                       | Wire toggle handler + optimistic update                          |
| Modify   | `apps/web/src/hooks/useIssueGroups.ts`                                       | Add `toggleImportant` to hook return                             |

---

## Endpoint Changes

### Created
- `POST /code/issue-groups/:groupKey/important` — Toggle `isImportant` flag for a group. Auth0 JWT required. Body: `{ important: boolean }`. Response: `{ important: boolean }`.

### Modified
- `GET /code/issue-groups` — Each group in the response now includes `isImportant?: boolean` (only present and `true` when the group is marked important; omitted when `false`/unset for backward compatibility).

### Unchanged
- All other code-agent routes remain unchanged.

---

### Task 1: Backend Model — Add `isImportant` to `TaskGroupSummary`

**Files:**
- Modify: `apps/code-agent/src/domain/models/taskGroupSummary.ts:11-46`

- [ ] **Step 1: Add the field to TaskGroupSummary interface**

Add `isImportant?: boolean` to the `TaskGroupSummary` interface, after the label flags block (line 40):

```typescript
// In TaskGroupSummary interface, after labelsUpdatedAt:

  // User-set flags
  /** True when the user has marked this group as important. Absent = not important. */
  isImportant?: boolean;
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/models/taskGroupSummary.ts
git commit -m "feat(code-agent): add isImportant field to TaskGroupSummary model"
```

---

### Task 2: Backend Port — Add `setImportant()` to Repository Interface

**Files:**
- Modify: `apps/code-agent/src/domain/ports/taskGroupSummaryRepository.ts:13-43`

- [ ] **Step 1: Add the method signature to `TaskGroupSummaryRepository`**

Add after the `recomputeWithLabels` method (around line 42):

```typescript
  /**
   * Toggle the isImportant flag on a group summary.
   * Returns NOT_FOUND if no summary exists for the given (userId, groupKey).
   */
  setImportant(
    userId: string,
    groupKey: string,
    important: boolean,
  ): Promise<Result<void, GroupSummaryError>>;
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/ports/taskGroupSummaryRepository.ts
git commit -m "feat(code-agent): add setImportant to TaskGroupSummaryRepository port"
```

---

### Task 3: Backend Repository — Implement `setImportant()` in Firestore Repository

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`

- [ ] **Step 1: Update `docToSummary` to read `isImportant`**

In the `docToSummary` function, add after the `labelsUpdatedAt` spread (around line 149):

```typescript
    ...(data['isImportant'] === true
      ? { isImportant: true }
      : {}),
```

This follows the same optional-field pattern used for `hasImplementationReadyLabel` and `hasMergeReadyLabel` — the field is only present in the returned object when `true`, keeping legacy documents backward-compatible.

- [ ] **Step 2: Write the failing test for `setImportant`**

Add a new `describe('setImportant', ...)` block in `taskGroupSummaryFirestoreRepository.test.ts`:

```typescript
describe('setImportant', () => {
  it('marks a group as important', async () => {
    // Setup: create a task so a group summary exists
    const task = buildTask({ userId: 'user-1', linearIssueId: 'INT-100', status: 'planned', agentType: 'planning' });
    await repo.updateAfterCreate(task);

    // Act
    const result = await repo.setImportant('user-1', 'INT-100', true);

    // Assert
    expect(result.ok).toBe(true);
    const doc = await firestore.collection('task_group_summaries').doc('user-1_INT-100').get();
    expect(doc.data()?.['isImportant']).toBe(true);
  });

  it('unmarks a group as important', async () => {
    const task = buildTask({ userId: 'user-1', linearIssueId: 'INT-100', status: 'planned', agentType: 'planning' });
    await repo.updateAfterCreate(task);
    await repo.setImportant('user-1', 'INT-100', true);

    const result = await repo.setImportant('user-1', 'INT-100', false);

    expect(result.ok).toBe(true);
    const doc = await firestore.collection('task_group_summaries').doc('user-1_INT-100').get();
    expect(doc.data()?.['isImportant']).toBeUndefined();
  });

  it('returns NOT_FOUND for non-existent group', async () => {
    const result = await repo.setImportant('user-1', 'nonexistent', true);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
```

Note: The `buildTask` helper and `repo`/`firestore` variables should already exist in the test file — follow the same setup pattern used by other tests in the same file.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/code-agent && npx vitest run src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — `setImportant` is not a function.

- [ ] **Step 4: Implement `setImportant` in the Firestore repository**

In `taskGroupSummaryFirestoreRepository.ts`, add the implementation in the returned object (alongside the other methods). The pattern follows how `recomputeWithLabels` works — direct Firestore document update:

```typescript
    async setImportant(
      userId: string,
      groupKey: string,
      important: boolean,
    ): Promise<Result<void, GroupSummaryError>> {
      const docId = `${userId}_${groupKey}`;
      const docRef = firestore.collection(SUMMARIES_COLLECTION).doc(docId);
      try {
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${groupKey}` });
        }
        if (important) {
          await docRef.update({ isImportant: true, updatedAt: Timestamp.now() });
        } else {
          // Remove the field entirely when unsetting (matches optional-field pattern)
          await docRef.update({
            isImportant: FieldValue.delete(),
            updatedAt: Timestamp.now(),
          });
        }
        return ok(undefined);
      } catch (error) {
        return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
      }
    },
```

Note: `FieldValue` must be imported from `@google-cloud/firestore`. Check if it's already imported at the top of the file. If not, add it:

```typescript
import { Timestamp, FieldValue } from '@google-cloud/firestore';
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/code-agent && npx vitest run src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts
git commit -m "feat(code-agent): implement setImportant in Firestore repository"
```

---

### Task 4: Backend Fake — Implement `setImportant()` in Fake Repository

**Files:**
- Modify: `apps/code-agent/src/__tests__/fakes/fakeTaskGroupSummaryRepository.ts`

- [ ] **Step 1: Add `setImportant` to the fake implementation**

In `createFakeTaskGroupSummaryRepository()`, add the method after `recomputeWithLabels`:

```typescript
    async setImportant(
      userId: string,
      groupKey: string,
      important: boolean,
    ): Promise<Result<void, GroupSummaryError>> {
      const key = summaryKey(userId, groupKey);
      const current = summaries.get(key);
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${groupKey}` });
      }
      if (important) {
        summaries.set(key, { ...current, isImportant: true, updatedAt: now() });
      } else {
        const { isImportant: _, ...rest } = current;
        summaries.set(key, { ...rest, updatedAt: now() } as TaskGroupSummary);
      }
      return ok(undefined);
    },
```

Also update the `FakeTaskGroupSummaryRepository` interface if it extends `TaskGroupSummaryRepository` — it should automatically inherit `setImportant` from the parent interface.

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/__tests__/fakes/fakeTaskGroupSummaryRepository.ts
git commit -m "feat(code-agent): implement setImportant in fake repository"
```

---

### Task 5: Backend Types — Add `isImportant` to Backend `IssueGroup`

**Files:**
- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts:92-100`

- [ ] **Step 1: Add `isImportant` to `IssueGroup`**

```typescript
export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: SerializedTask['linearIssue'] | undefined;
  tasks: SerializedTask[];
  pipeline: PipelineState;
  latestTask: SerializedTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
  isImportant?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/types.ts
git commit -m "feat(code-agent): add isImportant to IssueGroup type"
```

---

### Task 6: Backend Route — Toggle Endpoint + Attach `isImportant` to GET Response

**Files:**
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

- [ ] **Step 0: Update `makeGroupSummaryRepo` default stub to include `setImportant`**

The current `makeGroupSummaryRepo()` helper does not include a `setImportant` method, and all its methods are stateless no-ops. For the toggle endpoint tests to work, `makeGroupSummaryRepo` needs a default `setImportant` stub, and tests that exercise the toggle must use the stateful `createFakeTaskGroupSummaryRepository` fake (from Task 4) instead of the no-op stub.

Add a default no-op `setImportant` to `makeGroupSummaryRepo`:

```typescript
function makeGroupSummaryRepo(overrides: Partial<TaskGroupSummaryRepository> = {}): TaskGroupSummaryRepository {
  // ... existing defaults ...
  return {
    updateAfterCreate: async (): Promise<void> => { return; },
    updateAfterStatusChange: async (): Promise<void> => { return; },
    updateAfterDelete: async (): Promise<void> => { return; },
    getUserGroupCounts: async (): ReturnType<TaskGroupSummaryRepository['getUserGroupCounts']> => ok(defaultCounts),
    listGroupSummaries: async (): ReturnType<TaskGroupSummaryRepository['listGroupSummaries']> => ok({ summaries: [] }),
    recomputeGroupFromTasks: async (): Promise<void> => { return; },
    recomputeWithLabels: async (): ReturnType<TaskGroupSummaryRepository['recomputeWithLabels']> => ok(undefined),
    setImportant: async (): ReturnType<TaskGroupSummaryRepository['setImportant']> => ok(undefined),
    ...overrides,
  };
}
```

For the toggle endpoint tests below, use the `createFakeTaskGroupSummaryRepository` from `fakeTaskGroupSummaryRepository.ts` to get stateful `updateAfterCreate` + `setImportant` behavior. Pass it via `makeBaseServices({ groupSummaryRepo: fakeRepo })`.

- [ ] **Step 1: Write the failing tests for the toggle endpoint**

Add to `issueGroups.test.ts`:

```typescript
describe('POST /code/issue-groups/:groupKey/important', () => {
  it('marks a group as important', async () => {
    // Setup: create a task so a group summary exists
    // (Use the same test helpers/fakes already present in the test file)
    const createResponse = await app.inject({
      method: 'POST',
      url: '/code/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        prompt: 'test prompt',
        workerType: 'opus',
        linearIssueId: 'INT-500',
      },
    });
    expect(createResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: 'POST',
      url: '/code/issue-groups/INT-500/important',
      headers: { authorization: 'Bearer test-token' },
      payload: { important: true },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; data: { important: boolean } };
    expect(body.data.important).toBe(true);
  });

  it('unmarks a group as important', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/code/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        prompt: 'test prompt',
        workerType: 'opus',
        linearIssueId: 'INT-501',
      },
    });
    expect(createResponse.statusCode).toBe(200);

    // Mark as important first
    await app.inject({
      method: 'POST',
      url: '/code/issue-groups/INT-501/important',
      headers: { authorization: 'Bearer test-token' },
      payload: { important: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/code/issue-groups/INT-501/important',
      headers: { authorization: 'Bearer test-token' },
      payload: { important: false },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; data: { important: boolean } };
    expect(body.data.important).toBe(false);
  });

  it('returns NOT_FOUND for non-existent group', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/code/issue-groups/nonexistent/important',
      headers: { authorization: 'Bearer test-token' },
      payload: { important: true },
    });

    expect(response.statusCode).toBe(404);
  });
});
```

**IMPORTANT:** These tests require a **stateful** `groupSummaryRepo` so that `updateAfterCreate` (triggered by `POST /code/tasks`) actually stores a summary, and `setImportant` can then mutate it. Use `createFakeTaskGroupSummaryRepository()` (from Task 4) instead of the default `makeGroupSummaryRepo()` stub. Initialize the test app with `makeBaseServices({ groupSummaryRepo: fakeRepo })`.

Adapt the test setup to match the existing patterns in `issueGroups.test.ts` — check how the test app is initialized, how auth tokens work (likely a `FakeAuthPlugin`), and how tasks are created. The test examples above show the intent; the exact request payloads may need adjustment based on the test file's existing `beforeEach` setup.

- [ ] **Step 2: Write the failing test for `isImportant` in GET response**

Add to the existing `GET /code/issue-groups` describe block:

```typescript
it('includes isImportant in response when group is marked important', async () => {
  // Setup: create task and mark group as important
  await app.inject({
    method: 'POST',
    url: '/code/tasks',
    headers: { authorization: 'Bearer test-token' },
    payload: {
      prompt: 'test prompt',
      workerType: 'opus',
      linearIssueId: 'INT-600',
    },
  });
  await app.inject({
    method: 'POST',
    url: '/code/issue-groups/INT-600/important',
    headers: { authorization: 'Bearer test-token' },
    payload: { important: true },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/code/issue-groups',
    headers: { authorization: 'Bearer test-token' },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body) as { data: { groups: Array<{ isImportant?: boolean; linearIssueId: string | null }> } };
  const group = body.data.groups.find((g) => g.linearIssueId === 'INT-600');
  expect(group?.isImportant).toBe(true);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/code-agent && npx vitest run src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: FAIL — route not found / `isImportant` not in response.

- [ ] **Step 4: Implement the toggle endpoint**

In `issueGroupRoutes.ts`, add a new route inside the `fastify.register` callback (after the existing GET route):

```typescript
    fastify.post<{
      Params: { groupKey: string };
      Body: { important: boolean };
    }>(
      '/code/issue-groups/:groupKey/important',
      {
        schema: {
          params: {
            type: 'object',
            properties: {
              groupKey: { type: 'string' },
            },
            required: ['groupKey'],
          },
          body: {
            type: 'object',
            properties: {
              important: { type: 'boolean' },
            },
            required: ['important'],
          },
        },
      },
      async (request: FastifyRequest<{ Params: { groupKey: string }; Body: { important: boolean } }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/issue-groups/:groupKey/important',
          includeParams: true,
        });

        const { groupSummaryRepo } = getServices();
        const summaryRepo = groupSummaryRepo as NonNullable<typeof groupSummaryRepo>;
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId -- ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        const { groupKey } = request.params;
        const { important } = request.body;

        const result = await summaryRepo.setImportant(userId, groupKey, important);

        if (!result.ok) {
          if (result.error.code === 'NOT_FOUND') {
            return await reply.fail('NOT_FOUND', result.error.message);
          }
          request.log.error({ error: result.error, groupKey }, 'Failed to set important flag');
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }

        request.log.info({ userId, groupKey, important }, 'Group important flag updated');
        return await reply.ok({ important });
      }
    );
```

- [ ] **Step 5: Attach `isImportant` to GET response**

In the existing GET handler, after the `groupByLinearIssue` + `sortIssueGroups` calls (around line 369), build a lookup map from summaries and attach `isImportant` to each group:

```typescript
        // Build isImportant lookup from summaries
        const importantByGroupKey = new Map<string, boolean>();
        for (const summary of summaries) {
          if (summary.isImportant === true) {
            importantByGroupKey.set(summary.groupKey, true);
          }
        }

        // Attach isImportant to groups
        for (const group of paginatedGroups) {
          const groupKey = group.linearIssueId ?? `standalone_${group.latestTask.id}`;
          if (importantByGroupKey.get(groupKey) === true) {
            group.isImportant = true;
          }
        }
```

Place this AFTER `const paginatedGroups = sortIssueGroups(unsortedGroups, sortBy);` and BEFORE the phantom detection logic.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/code-agent && npx vitest run src/__tests__/routes/code/issueGroups.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 7: Run full workspace verification**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/routes/code/issueGroupRoutes.ts apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "feat(code-agent): add POST /code/issue-groups/:groupKey/important endpoint"
```

---

### Task 7: Frontend Types — Add `isImportant` to Frontend `IssueGroup`

**Files:**
- Modify: `apps/web/src/types/issueGroups.ts:27-35`

- [ ] **Step 1: Add `isImportant` to the frontend `IssueGroup` interface**

```typescript
export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: CodeTask['linearIssue'] | undefined;
  tasks: CodeTask[];
  pipeline: PipelineState;
  latestTask: CodeTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
  isImportant?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/types/issueGroups.ts
git commit -m "feat(web): add isImportant to IssueGroup type"
```

---

### Task 8: Frontend API — Add `setGroupImportant()` Function

**Files:**
- Modify: `apps/web/src/services/issueGroupsApi.ts`

- [ ] **Step 1: Add the API function**

Append to the end of `issueGroupsApi.ts`:

```typescript
/**
 * Toggle the important flag on an issue group.
 */
export async function setGroupImportant(
  accessToken: string,
  groupKey: string,
  important: boolean,
): Promise<{ important: boolean }> {
  return await apiRequest<{ important: boolean }>(
    config.codeAgentUrl,
    `/code/issue-groups/${encodeURIComponent(groupKey)}/important`,
    accessToken,
    {
      method: 'POST',
      body: { important },
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/services/issueGroupsApi.ts
git commit -m "feat(web): add setGroupImportant API function"
```

---

### Task 9: Frontend Hook — Add `toggleImportant` to `useIssueGroups`

**Files:**
- Modify: `apps/web/src/hooks/useIssueGroups.ts`

- [ ] **Step 1: Add `toggleImportant` function and export it from the hook**

Import `setGroupImportant` at the top:

```typescript
import { listIssueGroups as listIssueGroupsApi, setGroupImportant } from '@/services/issueGroupsApi';
```

Add `toggleImportant` to the `UseIssueGroupsResult` interface:

```typescript
export interface UseIssueGroupsResult {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
  toggleImportant: (groupKey: string) => void;
}
```

Add the implementation inside `useIssueGroups`, before the return statement:

```typescript
  const toggleImportant = useCallback(
    (groupKey: string): void => {
      // Optimistic update: toggle in local state immediately
      setGroups((prev) =>
        prev.map((g) => {
          const key = g.linearIssueId ?? `standalone_${g.latestTask.id}`;
          if (key !== groupKey) return g;
          const newImportant = g.isImportant !== true;
          return { ...g, isImportant: newImportant || undefined };
        }),
      );

      // Fire-and-forget API call
      void (async (): Promise<void> => {
        try {
          const token = await getAccessToken();
          const currentGroup = groups.find((g) => (g.linearIssueId ?? `standalone_${g.latestTask.id}`) === groupKey);
          const newImportant = currentGroup?.isImportant !== true;
          await setGroupImportant(token, groupKey, newImportant);
        } catch (err) {
          // Revert on error by refreshing
          void refresh(false);
        }
      })();
    },
    [getAccessToken, groups, refresh],
  );
```

Add `toggleImportant` to the return object:

```typescript
  return {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
    toggleImportant,
  };
```

- [ ] **Step 2: Update `mergeGroups` to preserve `isImportant` in equality check**

In the `mergeGroups` function, update the equality check to include `isImportant`:

```typescript
    if (
      existing?.aggregateStatus === g.aggregateStatus &&
      existing.latestTask.updatedAt === g.latestTask.updatedAt &&
      existing.isImportant === g.isImportant
    ) {
      return existing;
    }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useIssueGroups.ts
git commit -m "feat(web): add toggleImportant to useIssueGroups hook"
```

---

### Task 10: Frontend UI — Add Important Icon to `IssueGroupRow`

**Files:**
- Modify: `apps/web/src/components/code-tasks/IssueGroupRow.tsx`

- [ ] **Step 1: Add `onToggleImportant` and `isImportant` to `IssueGroupRowProps`**

Update the props interface:

```typescript
interface IssueGroupRowProps {
  group: IssueGroup;
  timeTick: number;
  onAction: (taskId: string, action: 'delete' | 'retry' | 'implement' | 'archive') => void;
  onArchiveGroup: (taskIds: string[]) => void;
  onDeleteGroup: (taskIds: string[]) => void;
  onOpenLogs: (taskId: string) => void;
  actioningTaskId?: string | null;
  actioningType?: ActioningType | undefined;
  isSelected?: boolean;
  isSelectable?: boolean;
  isBatchActioning?: boolean;
  onToggleSelection?: ((groupKey: string) => void) | undefined;
  onToggleImportant?: ((groupKey: string) => void) | undefined;
  groupKey?: string;
}
```

- [ ] **Step 2: Add the `AlertTriangle` import from Lucide**

Update the lucide-react import line at the top of the file:

```typescript
import { AlertTriangle, ChevronDown, ChevronRight, Play, RotateCcw, ExternalLink, Check, X, Loader2, Clock, ScrollText, Trash2, GitMerge, Archive } from 'lucide-react';
```

- [ ] **Step 3: Create the `ImportantToggle` component**

Add after the `SelectionCheckbox` component (around line 305):

```typescript
// --- Important toggle ---

function ImportantToggle({
  isImportant,
  groupKey,
  onToggle,
}: {
  isImportant: boolean;
  groupKey: string;
  onToggle: (key: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e): void => {
        e.stopPropagation();
        onToggle(groupKey);
      }}
      className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
        isImportant
          ? 'bg-amber-500 text-white hover:bg-amber-600'
          : 'text-slate-300 hover:bg-amber-100 hover:text-amber-500 dark:text-slate-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400'
      }`}
      title={isImportant ? 'Remove important flag' : 'Mark as important'}
      aria-label={isImportant ? 'Remove important flag' : 'Mark as important'}
    >
      <AlertTriangle className="h-3 w-3" />
    </button>
  );
}
```

- [ ] **Step 4: Render the important icon in the desktop layout**

In the desktop grid layout, change the grid template to accommodate the important icon. The current grid is `grid-cols-[28px_1fr_1fr_140px_120px_36px]`. Update to `grid-cols-[20px_28px_1fr_1fr_140px_120px_36px]` and add the important column before the checkbox column.

Replace the desktop grid div (around line 412):

```typescript
          <div className="hidden grid-cols-[20px_28px_1fr_1fr_140px_120px_36px] items-center gap-2 lg:grid">
            {/* Important column */}
            <div className="flex items-center justify-center">
              {onToggleImportant !== undefined && groupKey !== undefined ? (
                <ImportantToggle
                  isImportant={group.isImportant === true}
                  groupKey={groupKey}
                  onToggle={onToggleImportant}
                />
              ) : null}
            </div>
            {/* Checkbox column */}
```

Everything else in the desktop layout stays the same.

- [ ] **Step 5: Render the important icon in the mobile layout**

In the mobile layout `<div className="flex items-center gap-2">` (around line 518), add the important toggle before the selection checkbox:

```typescript
          <div className="flex items-center gap-2">
            {onToggleImportant !== undefined && groupKey !== undefined ? (
              <ImportantToggle
                isImportant={group.isImportant === true}
                groupKey={groupKey}
                onToggle={onToggleImportant}
              />
            ) : null}
            {isSelectable && onToggleSelection !== undefined && groupKey !== undefined ? (
```

- [ ] **Step 6: Update the memo comparison function**

Add `isImportant` comparison to the memo function at the bottom of the component (around line 698):

```typescript
  prev.group.isImportant === next.group.isImportant &&
```

Add after `prev.group.mostRecentDispatchedAt === next.group.mostRecentDispatchedAt &&`.

Also add:

```typescript
  prev.onToggleImportant === next.onToggleImportant &&
```

After `prev.onToggleSelection === next.onToggleSelection,`.

- [ ] **Step 7: Destructure `onToggleImportant` in the component**

In the component function signature, add `onToggleImportant` to the destructured props:

```typescript
const IssueGroupRow = memo(function IssueGroupRow({
  group,
  onAction,
  onArchiveGroup,
  onDeleteGroup,
  onOpenLogs,
  actioningTaskId,
  actioningType,
  isSelected = false,
  isSelectable = false,
  isBatchActioning = false,
  onToggleSelection,
  onToggleImportant,
  groupKey,
}: IssueGroupRowProps): React.JSX.Element {
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/code-tasks/IssueGroupRow.tsx
git commit -m "feat(web): add important toggle icon to IssueGroupRow"
```

---

### Task 11: Frontend Page — Wire Everything Together in `CodeTasksPage`

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

- [ ] **Step 0: Fix `getGroupKey` to match backend standalone key format**

The existing `getGroupKey` function returns `group.latestTask.id` for standalone groups, but the backend stores standalone summaries under `standalone_<taskId>`. Update the function so the frontend key matches the backend key — this is required for the important toggle (and archive/selection) to work correctly for standalone groups:

```typescript
function getGroupKey(group: IssueGroup): string {
  return group.linearIssueId ?? `standalone_${group.latestTask.id}`;
}
```

- [ ] **Step 1: Destructure `toggleImportant` from `useIssueGroups`**

Update the hook call (around line 11 area in the component body) to destructure `toggleImportant`:

```typescript
  const {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
    toggleImportant,
  } = useIssueGroups({
    groupStatus: activeFilters,
    sortBy: activeSort,
  });
```

- [ ] **Step 2: Create a stable callback for `onToggleImportant`**

Add a callback wrapper (near the other handlers):

```typescript
  const handleToggleImportant = useCallback(
    (groupKey: string): void => { toggleImportant(groupKey); },
    [toggleImportant],
  );
```

- [ ] **Step 3: Pass `onToggleImportant` to `IssueGroupRow`**

In the `groups.map(...)` rendering (around line 588), add the prop:

```typescript
                <IssueGroupRow
                  key={key}
                  group={group}
                  timeTick={timeTick}
                  onAction={fireAction}
                  onArchiveGroup={handleArchiveGroup}
                  onDeleteGroup={handleDeleteGroup}
                  onOpenLogs={setPreviewTaskId}
                  actioningTaskId={actioningTaskId}
                  actioningType={actioningType}
                  groupKey={key}
                  isSelectable={selectable && !isViewingArchived}
                  isSelected={selectedGroupKeys.has(key)}
                  isBatchActioning={batchActionGroupKeys.has(key)}
                  onToggleSelection={selectable && !isViewingArchived ? handleToggleSelection : undefined}
                  onToggleImportant={handleToggleImportant}
                />
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat(web): wire important toggle into CodeTasksPage"
```

---

### Task 12: Frontend Column Header — Update Desktop Grid Alignment

**Files:**
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`

- [ ] **Step 1: Find the `ColumnHeader` component in `CodeTasksPage.tsx`**

Search for the `ColumnHeader` function in the file. It renders the header row above the issue group list. Its grid template must match the updated `IssueGroupRow` grid.

Update its grid classes from `grid-cols-[28px_1fr_1fr_140px_120px_36px]` to `grid-cols-[20px_28px_1fr_1fr_140px_120px_36px]` and add an empty first column:

```typescript
function ColumnHeader(): React.JSX.Element {
  return (
    <div className="hidden grid-cols-[20px_28px_1fr_1fr_140px_120px_36px] items-center gap-2 px-4 pb-1 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500 lg:grid">
      <div />  {/* Important */}
      <div />  {/* Checkbox */}
      <div>Issue</div>
      <div>Pipeline</div>
      <div>Time</div>
      <div className="text-right">Output</div>
      <div />
    </div>
  );
}
```

Note: Check the existing `ColumnHeader` implementation first — it may have slightly different column labels or structure. Match it exactly, just prepending the empty `<div />` column for the important icon.

- [ ] **Step 2: Run the web app build to verify no errors**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | tail -20
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CodeTasksPage.tsx
git commit -m "feat(web): update ColumnHeader grid to include important column"
```

---

### Task 13: Full CI Verification

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

- [ ] **Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: All checks PASS.

- [ ] **Step 3: Fix any issues found**

If any tests fail or type errors appear, fix them and re-run CI.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address CI issues for important flag feature"
```

---

## Design Decisions

1. **`isImportant` stored on `TaskGroupSummary` (not on individual tasks):** The flag is a group-level user preference, not a task-level status. Storing it on the summary avoids needing to update every task in a group and keeps the flag independent of task lifecycle.

2. **`POST` not `PATCH` for the toggle:** Follows the existing pattern used for `POST /code/tasks/:taskId/archive` — action-oriented endpoints use POST in this codebase.

3. **Optimistic update with revert-on-error:** The UI toggles immediately without waiting for the API response. On failure, a background refresh reverts the state. This provides instant feedback for what is a low-risk toggle.

4. **Field omitted when `false` (not set to `false`):** When unsetting, the field is deleted from Firestore rather than set to `false`. This matches the established pattern for optional flags like `hasImplementationReadyLabel` — absent means "not set/not applicable."

5. **`AlertTriangle` icon from Lucide (already bundled):** An exclamation mark in a triangle on amber/orange background. Lucide is already imported in `IssueGroupRow.tsx`, so no new dependency is needed. The amber color scheme matches the existing archive action styling.

6. **Grid column width `20px` for the icon:** The important icon is smaller than the checkbox column (28px) since it's a compact toggle. This keeps the visual hierarchy: important flag (subtle) → checkbox (selection) → content.
