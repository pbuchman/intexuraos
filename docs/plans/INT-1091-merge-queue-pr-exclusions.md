# Merge Queue PR Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to check/uncheck individual PRs in the merge queue UI so the scheduler only merges selected PRs during a drain cycle, with immediate persistence (no save button).

**Architecture:** Extend the existing `MergeQueueWatch` Firestore document with an `excludedPrNumbers: number[]` field. Add a dedicated `PUT /code/merge-queue/watch/:watchId/exclusions` endpoint for the UI to persist toggles instantly. Modify the `mergeQueueTick` use case to filter out excluded PRs before processing. On the frontend, add checkboxes to every `PrRow` with optimistic updates, a selection summary counter, and bulk select/deselect actions.

**Tech Stack:** TypeScript, Fastify, Firestore, React, TailwindCSS, Vitest

---

## Design Decisions

### 1. Storage: `excludedPrNumbers` on the watch document

Exclusions are stored directly on the `merge_queue_watches` Firestore document as `excludedPrNumbers: number[]`. This is the right choice because:

- Exclusions only matter when a watch is active (no watch = nothing to exclude from)
- The tick use case already reads the watch document, so no extra Firestore query
- When a watch is cancelled or drained, exclusions naturally disappear
- No new Firestore collection or composite index needed

**Default value:** `[]` (empty array = all PRs included). A PR whose number appears in `excludedPrNumbers` is skipped by the scheduler.

### 2. Pre-watch exclusions (no active watch yet)

When the user opens the page and no watch exists, checkboxes still appear. Exclusion state is held in React state (in-memory). When the user creates a watch (toggles auto-merge on), the frontend sends `excludedPrNumbers` as part of the create request. This means the `POST /code/merge-queue/watch` body gains an optional `excludedPrNumbers` field.

### 3. Immediate persistence (no save button)

Each checkbox toggle fires an API call immediately:
- **Active watch exists:** `PUT /code/merge-queue/watch/:watchId/exclusions` with the full `excludedPrNumbers` array
- **No active watch:** State held locally; sent on watch creation

The UI uses **optimistic updates**: checkbox toggles instantly in the UI, reverts on API error with a toast.

### 4. Stale PR cleanup

When a PR is merged or closed, its number may remain in `excludedPrNumbers`. This is harmless — the tick use case only processes PRs that exist in the Firestore PR summary cache, so stale exclusion numbers are simply ignored. No cleanup is needed.

---

## UX Improvements (beyond the base requirement)

### A. Selection summary counter
Above the PR list, display: **"N of M PRs selected for merge"** — gives instant visibility into how many PRs will be included in the next drain cycle.

### B. Bulk actions: Select All / Deselect All
Two small text buttons next to the counter: "Select all" and "Deselect all" for quick bulk operations. Only visible when there are 2+ PRs.

### C. Visual dimming of excluded PRs
Unchecked (excluded) PRs get `opacity-50` styling (already used for ineligible PRs) plus a subtle dashed left border instead of the solid color accent. This gives a clear visual distinction without hiding information.

### D. Optimistic updates with error recovery
Checkbox toggles instantly. If the API call fails, the toggle reverts and a red error message appears briefly (3s) at the top of the PR list: "Failed to update exclusion. Please try again."

### E. Checkbox only on eligible PRs
Non-eligible PRs (wrong author, not your PR) already show as dimmed. These should NOT get a checkbox — they won't be merged regardless, so a checkbox would be confusing. Checkboxes only appear on PRs where `authorIsEligible === true`.

### F. Exclusion count in WatchStatusCard
When there are excluded PRs, the active watch card shows: "Merged: N · Skipped: N · Excluded: N" — so users see the exclusion count at a glance.

---

## Endpoint Changes

| Endpoint                                          | Status       | Description                                           |
| ------------------------------------------------- | ------------ | ----------------------------------------------------- |
| `PUT /code/merge-queue/watch/:watchId/exclusions` | **New**      | Set the excluded PR numbers for a watch               |
| `POST /code/merge-queue/watch`                    | **Modified** | Accept optional `excludedPrNumbers: number[]` in body |
| `GET /code/merge-queue/watches`                   | **Modified** | Response includes `excludedPrNumbers` field           |
| `POST /internal/merge-queue/tick`                 | **Modified** | Tick use case filters excluded PRs (no route change)  |
| `DELETE /code/merge-queue/watch/:watchId`         | Unchanged    |                                                       |
| `GET /code/merge-queue/branches`                  | Unchanged    |                                                       |
| `GET /code/merge-queue/prs`                       | Unchanged    |                                                       |

---

## Shared Contract (for parallel execution)

Both subtasks (code-agent backend + web frontend) depend on this contract. Each agent MUST use these exact types and API shapes.

### API Contract: `PUT /code/merge-queue/watch/:watchId/exclusions`

```
Request:
  Method: PUT
  Path: /code/merge-queue/watch/:watchId/exclusions
  Auth: JWT (same as other merge-queue routes)
  Body: { "excludedPrNumbers": number[] }

Response (success):
  Status: 200
  Body: { "success": true, "data": { "excludedPrNumbers": number[] } }

Response (not found):
  Status: 404
  Body: { "success": false, "error": { "code": "NOT_FOUND", "message": "Watch <id> not found" } }

Response (forbidden):
  Status: 403
  Body: { "success": false, "error": { "code": "FORBIDDEN", "message": "Not authorized to modify this watch" } }

Response (not active):
  Status: 409
  Body: { "success": false, "error": { "code": "CONFLICT", "message": "Cannot modify exclusions on a non-active watch" } }
```

### API Contract: `POST /code/merge-queue/watch` (modified)

```
Body adds optional field:
  { "owner": string, "repo": string, "baseBranch": string, "excludedPrNumbers"?: number[] }

Default when omitted: [] (empty array, all PRs included)
```

### API Contract: `GET /code/merge-queue/watches` (modified response)

```
Each watch in the response gains:
  { ...existingFields, "excludedPrNumbers": number[] }
```

### Domain Model Extension

```typescript
// In: apps/code-agent/src/domain/models/mergeQueueWatch.ts
// Add to MergeQueueWatch interface:
export interface MergeQueueWatch {
  // ... existing fields ...
  excludedPrNumbers: number[];  // PR numbers to skip during merge. Default: []
}
```

### Repository Extension

```typescript
// In: apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts
// Add to UpdateWatchInput:
export interface UpdateWatchInput {
  // ... existing fields ...
  excludedPrNumbers?: number[];
}

// Add to CreateWatchInput:
export interface CreateWatchInput {
  // ... existing fields ...
  excludedPrNumbers?: number[];
}
```

### Frontend Type Extension

```typescript
// In: apps/web/src/types/mergeQueue.ts
// Add to MergeQueueWatch:
export interface MergeQueueWatch {
  // ... existing fields ...
  excludedPrNumbers: number[];
}
```

---

## File Structure

### Backend (code-agent) — files to modify

| File                                                                              | Action   | Responsibility                                                       |
| --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `apps/code-agent/src/domain/models/mergeQueueWatch.ts`                            | Modify   | Add `excludedPrNumbers` field                                        |
| `apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts`            | Modify   | Add `excludedPrNumbers` to `UpdateWatchInput` and `CreateWatchInput` |
| `apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts`                | Modify   | Handle `excludedPrNumbers` in `create()` and `update()`              |
| `apps/code-agent/src/domain/usecases/mergeQueueTick.ts`                           | Modify   | Filter excluded PRs before processing                                |
| `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`                      | Modify   | Add `PUT exclusions` route, extend `POST watch`                      |
| `apps/code-agent/src/routes/merge-queue/serializeWatch.ts`                        | Modify   | Include `excludedPrNumbers` in serialization                         |
| `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`            | Modify   | Test exclusion filtering                                             |
| `apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`       | Modify   | Test new endpoint + modified create                                  |
| `apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts` | Modify   | Test persistence of `excludedPrNumbers`                              |

### Frontend (web) — files to modify

| File                                                      | Action   | Responsibility                                                                               |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `apps/web/src/types/mergeQueue.ts`                        | Modify   | Add `excludedPrNumbers` to `MergeQueueWatch`                                                 |
| `apps/web/src/services/mergeQueueApi.ts`                  | Modify   | Add `updateExclusions()` function, extend `createWatch()` signature with `excludedPrNumbers` |
| `apps/web/src/hooks/useMergeQueue.ts`                     | Modify   | Manage exclusion state, provide toggle handler                                               |
| `apps/web/src/components/merge-queue/PrRow.tsx`           | Modify   | Add checkbox                                                                                 |
| `apps/web/src/components/merge-queue/PrList.tsx`          | Modify   | Add selection counter, bulk actions, pass callbacks                                          |
| `apps/web/src/components/merge-queue/WatchStatusCard.tsx` | Modify   | Show exclusion count                                                                         |
| `apps/web/src/pages/MergeQueuePage.tsx`                   | Modify   | Wire exclusion state through components                                                      |

---

## Task 1: Backend — code-agent service

> **Service boundary:** `apps/code-agent/`
> **Owner agent:** code-agent backend agent
> **No dependencies on Task 2** — uses the shared contract above.

### Task 1.1: Extend domain model with `excludedPrNumbers`

**Files:**
- Modify: `apps/code-agent/src/domain/models/mergeQueueWatch.ts`
- Modify: `apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts`

- [ ] **Step 1: Add `excludedPrNumbers` to `MergeQueueWatch` interface**

In `apps/code-agent/src/domain/models/mergeQueueWatch.ts`, add after the `cancelledAt` field:

```typescript
  excludedPrNumbers: number[];
```

- [ ] **Step 2: Add `excludedPrNumbers` to `UpdateWatchInput`**

In `apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts`, add to `UpdateWatchInput`:

```typescript
  excludedPrNumbers?: number[];
```

- [ ] **Step 3: Add `excludedPrNumbers` to `CreateWatchInput`**

In `apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts`, add to `CreateWatchInput`:

```typescript
  excludedPrNumbers?: number[];
```

- [ ] **Step 4: Update `makeWatch` test helper immediately**

In `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`, add `excludedPrNumbers: []` to the `makeWatch` helper's default return value (after `skippedPrs: []`). This prevents cascading type errors in all downstream tasks.

```typescript
excludedPrNumbers: [],
```

- [ ] **Step 5: Verify types compile**

Run: `cd /repo && pnpm build --filter=code-agent`
Expected: May fail because Firestore repo needs updating — that's OK at this step, but test helpers should compile.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/models/mergeQueueWatch.ts apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts
git commit -m "feat(code-agent): add excludedPrNumbers to merge queue watch domain model"
```

### Task 1.2: Update Firestore repository to persist `excludedPrNumbers`

**Files:**
- Modify: `apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`

- [ ] **Step 1: Write failing test — create() stores excludedPrNumbers**

In the test file, add a new test in the `create()` describe block:

```typescript
it('stores excludedPrNumbers when provided', async () => {
  const result = await repo.create({
    userId: 'user-1',
    gitHubUsername: 'testuser',
    owner: 'testorg',
    repo: 'testrepo',
    baseBranch: 'development',
    excludedPrNumbers: [42, 99],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.excludedPrNumbers).toStrictEqual([42, 99]);
});
```

- [ ] **Step 2: Write failing test — create() defaults to empty array**

```typescript
it('defaults excludedPrNumbers to empty array when not provided', async () => {
  const result = await repo.create({
    userId: 'user-1',
    gitHubUsername: 'testuser',
    owner: 'testorg',
    repo: 'testrepo',
    baseBranch: 'development',
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.excludedPrNumbers).toStrictEqual([]);
});
```

- [ ] **Step 3: Write failing test — update() persists excludedPrNumbers**

```typescript
it('updates excludedPrNumbers', async () => {
  const createResult = await repo.create({
    userId: 'user-1',
    gitHubUsername: 'testuser',
    owner: 'testorg',
    repo: 'testrepo',
    baseBranch: 'development',
  });
  expect(createResult.ok).toBe(true);
  if (!createResult.ok) return;

  const updateResult = await repo.update(createResult.value.id, {
    excludedPrNumbers: [10, 20],
  });
  expect(updateResult.ok).toBe(true);

  const findResult = await repo.findById(createResult.value.id);
  expect(findResult.ok).toBe(true);
  if (!findResult.ok) return;
  expect(findResult.value.excludedPrNumbers).toStrictEqual([10, 20]);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`
Expected: FAIL — `excludedPrNumbers` not stored/returned.

- [ ] **Step 5: Update `create()` in Firestore repository**

In `apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts`, in the `create()` method, update the `data` object:

```typescript
const data = {
  userId: input.userId,
  gitHubUsername: input.gitHubUsername,
  owner: input.owner,
  repo: input.repo,
  baseBranch: input.baseBranch,
  status: 'active' as const,
  mergedPrs: [],
  skippedPrs: [],
  excludedPrNumbers: input.excludedPrNumbers ?? [],
  lastError: null,
  lastErrorAt: null,
  createdAt: now,
  lastTickAt: null,
  drainedAt: null,
  cancelledAt: null,
};
```

- [ ] **Step 6: Update `update()` in Firestore repository**

In the `update()` method, add handling for the new field after the `cancelledAt` block:

```typescript
if (input.excludedPrNumbers !== undefined) {
  updateData['excludedPrNumbers'] = input.excludedPrNumbers;
}
```

- [ ] **Step 7: Add backwards-compatibility guard at the repository data-mapping layer**

Old Firestore documents created before this change won't have `excludedPrNumbers`. The Firestore repository casts `doc.data() as Omit<MergeQueueWatch, 'id'>`, so old documents will have `undefined` at runtime despite the TypeScript type saying `number[]`. Apply the `?? []` guard in every method that reads documents. In `findById`, `findAllActive`, `findActiveByUserAndBranch`, and `findByUserAndRepo`, update the data mapping to include the fallback:

```typescript
// Example for findById:
const data = snapshot.data() as Omit<MergeQueueWatch, 'id'>;
return ok({
  id: snapshot.id,
  ...data,
  excludedPrNumbers: data.excludedPrNumbers ?? [],
});
```

Apply the same `excludedPrNumbers: data.excludedPrNumbers ?? []` pattern in all four read methods. This ensures every consumer (tick use case, serializer, etc.) receives a clean `number[]` without needing their own fallbacks.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts
git commit -m "feat(code-agent): persist excludedPrNumbers in Firestore merge queue watch repository"
```

### Task 1.3: Update serialization to include `excludedPrNumbers`

**Files:**
- Modify: `apps/code-agent/src/routes/merge-queue/serializeWatch.ts`
- Test: `apps/code-agent/src/__tests__/routes/merge-queue/serializeWatch.test.ts` (confirmed to exist)

- [ ] **Step 1: Write a test for `serializeWatch` including `excludedPrNumbers`**

Add a test case in the existing `apps/code-agent/src/__tests__/routes/merge-queue/serializeWatch.test.ts` that verifies `excludedPrNumbers` appears in the serialized output. Additionally, add a test in the route tests (`mergeQueueRoutes.test.ts`) that verifies the full `GET /code/merge-queue/watches` response includes `excludedPrNumbers`. Add to the `GET /code/merge-queue/watches` describe block:

```typescript
it('includes excludedPrNumbers in serialized watch response', async () => {
  mockMergeQueueWatchRepo.findByUserAndRepo = vi.fn().mockResolvedValue(
    ok([{
      id: 'watch_abc',
      userId: 'test-user-id',
      owner: 'testorg',
      repo: 'testrepo',
      baseBranch: 'development',
      status: 'active',
      mergedPrs: [],
      skippedPrs: [],
      excludedPrNumbers: [42, 99],
      lastError: null,
      lastErrorAt: null,
      createdAt: new Date(),
      lastTickAt: null,
      drainedAt: null,
      cancelledAt: null,
    }])
  );

  const res = await server.inject({
    method: 'GET',
    url: '/code/merge-queue/watches?owner=testorg&repo=testrepo',
    headers: { authorization: 'Bearer valid-token' },
  });

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { success: boolean; data: { watches: Array<{ excludedPrNumbers: number[] }> } };
  expect(body.data.watches[0]?.excludedPrNumbers).toStrictEqual([42, 99]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts -t "excludedPrNumbers in serialized"`
Expected: FAIL — `excludedPrNumbers` not in response.

- [ ] **Step 3: Add `excludedPrNumbers` to `serializeWatch`**

In `apps/code-agent/src/routes/merge-queue/serializeWatch.ts`, add to the returned object after the `mergedPrs` field:

```typescript
excludedPrNumbers: watch.excludedPrNumbers ?? [],
```

Note: The `?? []` is technically redundant since the repository layer now provides the fallback (Task 1.2 Step 7), but it's a safe defensive guard for the serialization boundary.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts -t "excludedPrNumbers in serialized"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/serializeWatch.ts apps/code-agent/src/__tests__/routes/merge-queue/serializeWatch.test.ts apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts
git commit -m "feat(code-agent): include excludedPrNumbers in merge queue watch API response"
```

### Task 1.4: Add PUT exclusions route

**Files:**
- Modify: `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`

- [ ] **Step 1: Write failing test — PUT exclusions happy path**

Add to the test file:

```typescript
describe('PUT /code/merge-queue/watch/:watchId/exclusions', () => {
  it('updates exclusions on an active watch', async () => {
    mockMergeQueueWatchRepo.findById = vi.fn().mockResolvedValue(
      ok({
        id: 'watch_abc',
        userId: 'test-user-id',
        status: 'active',
        excludedPrNumbers: [],
      })
    );
    mockMergeQueueWatchRepo.update = vi.fn().mockResolvedValue(ok(undefined));

    const res = await server.inject({
      method: 'PUT',
      url: '/code/merge-queue/watch/watch_abc/exclusions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { excludedPrNumbers: [42, 99] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; data: { excludedPrNumbers: number[] } };
    expect(body.success).toBe(true);
    expect(body.data.excludedPrNumbers).toStrictEqual([42, 99]);
    expect(mockMergeQueueWatchRepo.update).toHaveBeenCalledWith('watch_abc', {
      excludedPrNumbers: [42, 99],
    });
  });

  it('returns 404 when watch not found', async () => {
    mockMergeQueueWatchRepo.findById = vi.fn().mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Watch watch_xyz not found' })
    );

    const res = await server.inject({
      method: 'PUT',
      url: '/code/merge-queue/watch/watch_xyz/exclusions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { excludedPrNumbers: [1] },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when user does not own the watch', async () => {
    mockMergeQueueWatchRepo.findById = vi.fn().mockResolvedValue(
      ok({
        id: 'watch_abc',
        userId: 'other-user-id',
        status: 'active',
        excludedPrNumbers: [],
      })
    );

    const res = await server.inject({
      method: 'PUT',
      url: '/code/merge-queue/watch/watch_abc/exclusions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { excludedPrNumbers: [1] },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when watch is not active', async () => {
    mockMergeQueueWatchRepo.findById = vi.fn().mockResolvedValue(
      ok({
        id: 'watch_abc',
        userId: 'test-user-id',
        status: 'drained',
        excludedPrNumbers: [],
      })
    );

    const res = await server.inject({
      method: 'PUT',
      url: '/code/merge-queue/watch/watch_abc/exclusions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { excludedPrNumbers: [1] },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when excludedPrNumbers is not an array', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/code/merge-queue/watch/watch_abc/exclusions',
      headers: { authorization: 'Bearer valid-token' },
      payload: { excludedPrNumbers: 'not-an-array' },
    });

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the PUT exclusions route**

In `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`, add inside the `fastify.register` block (after the DELETE route, before the GET routes):

```typescript
// PUT /code/merge-queue/watch/:watchId/exclusions — set excluded PRs
fastify.put(
  '/code/merge-queue/watch/:watchId/exclusions',
  async (request: FastifyRequest, reply: FastifyReply) => {
    logIncomingRequest(request, {
      message: 'Received request to PUT /code/merge-queue/watch/:watchId/exclusions',
    });

    const userId = getUserId(request);
    const { watchId } = request.params as { watchId: string };
    const body = request.body as { excludedPrNumbers?: unknown } | undefined;

    // Validate body
    const rawExcluded = body?.excludedPrNumbers;
    if (!Array.isArray(rawExcluded) || !rawExcluded.every((n): n is number => typeof n === 'number')) {
      return await reply.fail('INVALID_REQUEST', 'excludedPrNumbers must be an array of numbers');
    }

    const excludedPrNumbers: number[] = rawExcluded;

    const { mergeQueueWatchRepo } = getServices();

    // Find the watch
    const findResult = await mergeQueueWatchRepo.findById(watchId);
    if (!findResult.ok) {
      if (findResult.error.code === 'NOT_FOUND') {
        return await reply.fail('NOT_FOUND', findResult.error.message);
      }
      return await reply.fail('INTERNAL_ERROR', findResult.error.message);
    }

    // Authorization check
    if (findResult.value.userId !== userId) {
      return await reply.fail('FORBIDDEN', 'Not authorized to modify this watch');
    }

    // Only allow modifications on active watches
    if (findResult.value.status !== 'active') {
      return await reply.fail('CONFLICT', 'Cannot modify exclusions on a non-active watch');
    }

    // Persist
    const updateResult = await mergeQueueWatchRepo.update(watchId, { excludedPrNumbers });
    if (!updateResult.ok) {
      request.log.error({ error: updateResult.error }, 'Failed to update watch exclusions');
      return await reply.fail('INTERNAL_ERROR', updateResult.error.message);
    }

    return await reply.ok({ excludedPrNumbers });
  }
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts
git commit -m "feat(code-agent): add PUT exclusions endpoint for merge queue watches"
```

### Task 1.5: Extend POST watch to accept `excludedPrNumbers`

**Files:**
- Modify: `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`

- [ ] **Step 1: Write failing test — create watch with excludedPrNumbers**

Add to the test file in the `POST /code/merge-queue/watch` describe block:

```typescript
it('passes excludedPrNumbers to repository when provided', async () => {
  nock('https://api.github.com')
    .get('/user').reply(200, { login: 'testuser' })
    .get('/repos/testorg/testrepo').reply(200, { permissions: { push: true } });

  mockMergeQueueWatchRepo.create = vi.fn().mockResolvedValue(
    ok({
      id: 'watch_new',
      userId: 'test-user-id',
      gitHubUsername: 'testuser',
      owner: 'testorg',
      repo: 'testrepo',
      baseBranch: 'development',
      status: 'active',
      mergedPrs: [],
      skippedPrs: [],
      excludedPrNumbers: [10, 20],
      lastError: null,
      lastErrorAt: null,
      createdAt: new Date(),
      lastTickAt: null,
      drainedAt: null,
      cancelledAt: null,
    })
  );

  const res = await server.inject({
    method: 'POST',
    url: '/code/merge-queue/watch',
    headers: { authorization: 'Bearer valid-token' },
    payload: { owner: 'testorg', repo: 'testrepo', baseBranch: 'development', excludedPrNumbers: [10, 20] },
  });

  expect(res.statusCode).toBe(200);
  expect(mockMergeQueueWatchRepo.create).toHaveBeenCalledWith(
    expect.objectContaining({ excludedPrNumbers: [10, 20] })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts -t "passes excludedPrNumbers"`
Expected: FAIL

- [ ] **Step 3: Update POST watch route to pass `excludedPrNumbers`**

In the POST `/code/merge-queue/watch` handler, update the body parsing:

```typescript
const body = request.body as { owner?: string; repo?: string; baseBranch?: string; excludedPrNumbers?: unknown } | undefined;
```

And update the `create` call:

```typescript
// Parse optional excludedPrNumbers
const rawExcluded = body?.excludedPrNumbers;
const excludedPrNumbers: number[] = Array.isArray(rawExcluded) && rawExcluded.every((n): n is number => typeof n === 'number')
  ? rawExcluded
  : [];

const createResult = await mergeQueueWatchRepo.create({
  userId,
  gitHubUsername,
  owner,
  repo,
  baseBranch,
  excludedPrNumbers,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts
git commit -m "feat(code-agent): accept excludedPrNumbers when creating merge queue watch"
```

### Task 1.6: Filter excluded PRs in mergeQueueTick use case

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/mergeQueueTick.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`

- [ ] **Step 1: Write failing test — excluded PRs are skipped**

Add to the test file:

```typescript
it('skips PRs that are in the watch excludedPrNumbers', async () => {
  const watch = makeWatch({ excludedPrNumbers: [1] });
  deps.mergeQueueWatchRepo.findAllActive = vi.fn().mockResolvedValue(ok([watch]));
  deps.userServiceClient.getOAuthToken = vi.fn().mockResolvedValue(ok({ accessToken: 'token' }));

  const pr1 = makePrSummary({ pullRequestNumber: 1, authorLogin: 'testuser' });
  const pr2 = makePrSummary({ pullRequestNumber: 2, authorLogin: 'testuser' });
  deps.gitHubPRSummaryRepo.findOpenByBaseBranch = vi.fn().mockResolvedValue(ok([pr1, pr2]));

  // Only PR #2 should be processed (PR #1 is excluded)
  deps.gitHubPRClient.getPullRequestDetails = vi.fn().mockResolvedValue(
    ok(makePrDetails({ number: 2, mergeable: true, headSha: 'sha2' }))
  );
  deps.gitHubPRClient.getCombinedCheckStatus = vi.fn().mockResolvedValue(ok({ state: 'success' }));
  deps.gitHubPRClient.mergePullRequest = vi.fn().mockResolvedValue(ok({ sha: 'merged-sha' }));

  const result = await tick();
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const tickResult = result.value[0];
  expect(tickResult).toBeDefined();
  if (tickResult === undefined) return;
  expect(tickResult.action).toBe('merged');
  expect(tickResult.mergedPrNumber).toBe(2);

  // PR #1 should NOT have been fetched for details
  expect(deps.gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalledWith(
    expect.anything(), expect.anything(), expect.anything(), 1
  );
});

it('returns skipped_all (not drained) when all eligible PRs are excluded', async () => {
  // When the user excludes all PRs, the watch must NOT drain — it stays active
  // so the user can re-include PRs later without recreating the watch.
  const watch = makeWatch({ excludedPrNumbers: [1, 2] });
  deps.mergeQueueWatchRepo.findAllActive = vi.fn().mockResolvedValue(ok([watch]));
  deps.userServiceClient.getOAuthToken = vi.fn().mockResolvedValue(ok({ accessToken: 'token' }));

  const pr1 = makePrSummary({ pullRequestNumber: 1, authorLogin: 'testuser' });
  const pr2 = makePrSummary({ pullRequestNumber: 2, authorLogin: 'testuser' });
  deps.gitHubPRSummaryRepo.findOpenByBaseBranch = vi.fn().mockResolvedValue(ok([pr1, pr2]));

  const result = await tick();
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const tickResult = result.value[0];
  expect(tickResult).toBeDefined();
  if (tickResult === undefined) return;
  expect(tickResult.action).toBe('skipped_all');  // NOT 'drained' — PRs exist, just excluded
  expect(tickResult.skipped).toStrictEqual([]);   // Empty — nothing attempted, user excluded all
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts -t "excluded"`
Expected: FAIL

- [ ] **Step 3: Add exclusion filtering to the tick use case**

In `apps/code-agent/src/domain/usecases/mergeQueueTick.ts`, in the `processWatch` function, update the watch parameter type to include `excludedPrNumbers`:

```typescript
async function processWatch(
  watch: { id: string; userId: string; gitHubUsername: string; owner: string; repo: string; baseBranch: string; excludedPrNumbers: number[] }
): Promise<TickResult> {
```

**CRITICAL ordering:** The exclusion filter MUST happen AFTER the existing "zero eligible PRs = drain" check (Step 3g). If it happens before, excluding all PRs would prematurely drain the watch, deactivating auto-merge even though eligible PRs exist. The correct ordering is:

```
1. Filter eligible authors → eligiblePrs (existing Step 3e, unchanged)
2. Sort eligiblePrs (existing Step 3f, unchanged)
3. If eligiblePrs.length === 0 → drain (existing Step 3g, unchanged)
4. Filter excluded from eligiblePrs → prsToProcess (NEW step)
5. If prsToProcess.length === 0 → skipped_all (NOT drain — PRs exist, just excluded)
6. Iterate prsToProcess (existing loop, operates on prsToProcess)
```

After the existing drain check (Step 3g) and before the iteration loop (Step 3h), add:

```typescript
    // Step 3g-2: Filter out excluded PRs (AFTER drain check to avoid premature drain)
    const excludedSet = new Set(watch.excludedPrNumbers);
    const prsToProcess = eligiblePrs.filter((pr) => !excludedSet.has(pr.number));

    // Step 3g-3: If all eligible PRs are excluded, skip (but do NOT drain)
    //
    // SEMANTIC NOTE: This returns `skipped_all` with `skipped: []`, which is
    // distinct from the post-loop `skipped_all` (tick.ts ~line 231) where
    // `skipped.length > 0` (PRs were attempted but blocked). The difference:
    //   - skipped: []    → "nothing tried — user excluded all eligible PRs"
    //   - skipped: [...]  → "everything tried but blocked by merge status"
    // Consumers of `skipped_all` (e.g., mergeQueueTickRoute, monitoring) MUST
    // NOT assume `skipped.length > 0`. Add a test covering this invariant in
    // Task 1.6 Step 2 (the all-excluded test already asserts `skipped: []`).
    if (prsToProcess.length === 0) {
      await recordSuccessfulTick(watchId, []);
      return {
        watchId, owner, repo, baseBranch,
        action: 'skipped_all',
        remainingPrs: allPrs.length,
        skipped: [],
      };
    }
```

Then update the iteration loop to use `prsToProcess` instead of `eligiblePrs`:
- Change `for (const pr of eligiblePrs)` to `for (const pr of prsToProcess)`
- **Keep** `remainingPrs: allPrs.length - 1` and `remainingPrs: allPrs.length` **unchanged** — `remainingPrs` represents total open PRs, not included-only PRs.

**Important:** The `excludedPrNumbers` field defaults to `[]` for existing watch documents in Firestore. The `excludedSet` will be empty, so all PRs pass through — backwards compatible.

**Downstream consumer audit (REQUIRED before merging Task 1.6):** The implementing agent MUST audit `mergeQueueTickRoute.ts` and any monitoring/logging consumers of `TickAction` to verify they handle `skipped_all` with `skipped: []` correctly. If any consumer assumes `skipped.length > 0` when `action === 'skipped_all'`, fix it or add a guard. Document the audit result in the commit message.

- [ ] **Step 4: No `?? []` guard needed in tick use case**

The backwards-compatibility `?? []` guard for old Firestore documents is already applied at the repository layer (Task 1.2 Step 7). The tick use case receives clean `MergeQueueWatch` objects with `excludedPrNumbers: number[]` guaranteed. No additional fallback is needed here.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`
Expected: PASS (all tests including existing ones)

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/domain/usecases/mergeQueueTick.ts apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts
git commit -m "feat(code-agent): filter excluded PRs in merge queue tick use case"
```

### Task 1.7: Run full backend workspace verification

- [ ] **Step 1: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS — all tests pass, coverage meets thresholds

- [ ] **Step 2: Fix any remaining issues and commit**

---

## Task 2: Frontend — web app

> **Service boundary:** `apps/web/`
> **Owner agent:** web frontend agent
> **No dependencies on Task 1** — uses the shared contract above. The frontend can be built against the contract; the backend agent implements the same contract.

### Task 2.1: Extend frontend types and API service

**Files:**
- Modify: `apps/web/src/types/mergeQueue.ts`
- Modify: `apps/web/src/services/mergeQueueApi.ts`

- [ ] **Step 1: Add `excludedPrNumbers` to `MergeQueueWatch` type**

In `apps/web/src/types/mergeQueue.ts`, add to `MergeQueueWatch`:

```typescript
  excludedPrNumbers: number[];
```

- [ ] **Step 2: Add `updateExclusions()` API function**

In `apps/web/src/services/mergeQueueApi.ts`, add:

```typescript
export async function updateExclusions(
  accessToken: string,
  watchId: string,
  excludedPrNumbers: number[]
): Promise<{ excludedPrNumbers: number[] }> {
  return await apiRequest(config.codeAgentUrl, `/code/merge-queue/watch/${watchId}/exclusions`, accessToken, {
    method: 'PUT',
    body: { excludedPrNumbers },
  });
}
```

- [ ] **Step 3: Update `createWatch()` to accept `excludedPrNumbers`**

Update the existing `createWatch` function signature and body:

```typescript
export async function createWatch(
  accessToken: string,
  owner: string,
  repo: string,
  baseBranch: string,
  excludedPrNumbers?: number[]
): Promise<MergeQueueWatch> {
  return await apiRequest(config.codeAgentUrl, '/code/merge-queue/watch', accessToken, {
    method: 'POST',
    body: { owner, repo, baseBranch, excludedPrNumbers: excludedPrNumbers ?? [] },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types/mergeQueue.ts apps/web/src/services/mergeQueueApi.ts
git commit -m "feat(web): add exclusion types and API functions for merge queue"
```

### Task 2.2: Add exclusion state management to useMergeQueue hook

**Files:**
- Modify: `apps/web/src/hooks/useMergeQueue.ts`

- [ ] **Step 1: Add exclusion-related state and exports**

Add imports at the top:

```typescript
import { updateExclusions } from '@/services/mergeQueueApi';
```

Add new state variables after existing state:

```typescript
const [excludedPrNumbers, setExcludedPrNumbers] = useState<Set<number>>(new Set());
const [exclusionError, setExclusionError] = useState<string | null>(null);
```

- [ ] **Step 2: Sync exclusions from watch data**

Add an effect that syncs exclusion state when watch data changes (e.g., initial load, polling). **Important:** Guard with an in-flight flag to prevent poll-driven syncs from overwriting optimistic state while an exclusion API call is pending.

```typescript
const [exclusionInFlight, setExclusionInFlight] = useState(false);

// Sync exclusion state from active watch (skips while API call is in-flight)
// Note: Use `watches` and `selectedBranch` directly (not via refs) since they
// are already in the dependency array and the effect re-runs when they change.
useEffect(() => {
  if (exclusionInFlight) return;  // Don't overwrite optimistic state during API call
  const activeWatch = watches.find(
    (w) => w.baseBranch === selectedBranch && w.status === 'active'
  );
  if (activeWatch !== undefined) {
    setExcludedPrNumbers(new Set(activeWatch.excludedPrNumbers));
  } else {
    setExcludedPrNumbers(new Set());
  }
}, [watches, selectedBranch, exclusionInFlight]);
```

The toggle/bulk action handlers should set `setExclusionInFlight(true)` before the API call and `setExclusionInFlight(false)` in the finally block. This prevents a 30s poll from reverting a checkbox toggle that hasn't been confirmed by Firestore yet.

**Post-flight sync cooldown:** When `exclusionInFlight` flips from `true` → `false`, the useEffect re-runs immediately. If a background poll completed *during* the API call and returned stale data (before the PUT reached Firestore), the sync will briefly overwrite optimistic state with old data — causing a visible checkbox flicker that self-corrects on the next poll. To mitigate this, add a 2-second cooldown after a successful API call before re-enabling sync:

```typescript
const [syncCooldown, setSyncCooldown] = useState(false);

// In the useEffect, also guard on syncCooldown:
useEffect(() => {
  if (exclusionInFlight || syncCooldown) return;
  // ... existing sync logic ...
}, [watches, selectedBranch, exclusionInFlight, syncCooldown]);

// In handler finally blocks, after setExclusionInFlight(false):
setSyncCooldown(true);
setTimeout(() => { setSyncCooldown(false); }, 2000);
```

This gives Firestore 2 seconds to propagate the write before the next sync re-reads watch data, eliminating the flicker in all practical scenarios.

- [ ] **Step 2b: Declare `excludedPrNumbersRef` (BEFORE any callbacks)**

**CRITICAL: This ref MUST be declared before Steps 3 and 4.** The callbacks below read `excludedPrNumbersRef.current` — if the ref doesn't exist yet, TypeScript will fail to compile. Place this immediately after the state declarations and sync effect:

```typescript
const excludedPrNumbersRef = useRef(excludedPrNumbers);
excludedPrNumbersRef.current = excludedPrNumbers;
```

This ref is used by `handleToggleExclusion`, `handleSelectAll`, `handleDeselectAll`, and `doToggleWatch` to read the current exclusion state without adding it to `useCallback` dependency arrays.

- [ ] **Step 3: Implement the toggle handler**

Add the `handleToggleExclusion` callback. **Important:** Keep the state updater pure — compute next state in the updater, fire the API call outside it. This prevents React Strict Mode (which calls updaters twice in dev) from double-firing API calls.

```typescript
const handleToggleExclusion = useCallback((prNumber: number): void => {
  setExclusionError(null);

  // Compute next state (pure updater — no side effects)
  const prev = excludedPrNumbersRef.current;
  const next = new Set(prev);
  if (next.has(prNumber)) {
    next.delete(prNumber);
  } else {
    next.add(prNumber);
  }

  // Optimistic update
  setExcludedPrNumbers(next);

  // Persist outside the updater
  const activeWatch = watchesRef.current.find(
    (w) => w.baseBranch === selectedBranchRef.current && w.status === 'active'
  );
  if (activeWatch !== undefined) {
    setExclusionInFlight(true);
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        await updateExclusions(token, activeWatch.watchId, [...next]);
      } catch (err) {
        // Revert on failure
        setExcludedPrNumbers(prev);
        setExclusionError(err instanceof Error ? err.message : 'Failed to update exclusion');
        setTimeout(() => { setExclusionError(null); }, 3000);
      } finally {
        setExclusionInFlight(false);
        setSyncCooldown(true);
        setTimeout(() => { setSyncCooldown(false); }, 2000);
      }
    })();
  }
}, [getAccessToken]);
// ^ Minimal dep array is intentional: `excludedPrNumbersRef`, `watchesRef`, and
// `selectedBranchRef` are accessed via refs to avoid stale closures and prevent
// callback identity churn on every state change. Only `getAccessToken` (stable
// from Auth0) is a direct dependency.
```

Note: `excludedPrNumbersRef` was declared in Step 2b above — do NOT re-declare it here.

- [ ] **Step 4: Implement bulk actions**

Same pattern: pure state computation, API call outside the updater.

```typescript
const handleSelectAll = useCallback((): void => {
  const prev = excludedPrNumbersRef.current;
  const next = new Set<number>();  // empty = all included
  setExcludedPrNumbers(next);

  const activeWatch = watchesRef.current.find(
    (w) => w.baseBranch === selectedBranchRef.current && w.status === 'active'
  );
  if (activeWatch !== undefined) {
    setExclusionInFlight(true);
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        await updateExclusions(token, activeWatch.watchId, []);
      } catch (err) {
        setExcludedPrNumbers(prev);
        setExclusionError(err instanceof Error ? err.message : 'Failed to update exclusions');
        setTimeout(() => { setExclusionError(null); }, 3000);
      } finally {
        setExclusionInFlight(false);
        setSyncCooldown(true);
        setTimeout(() => { setSyncCooldown(false); }, 2000);
      }
    })();
  }
}, [getAccessToken]);

const handleDeselectAll = useCallback((eligiblePrNumbers: number[]): void => {
  const prev = excludedPrNumbersRef.current;
  const next = new Set(eligiblePrNumbers);
  setExcludedPrNumbers(next);

  const activeWatch = watchesRef.current.find(
    (w) => w.baseBranch === selectedBranchRef.current && w.status === 'active'
  );
  if (activeWatch !== undefined) {
    setExclusionInFlight(true);
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        await updateExclusions(token, activeWatch.watchId, [...next]);
      } catch (err) {
        setExcludedPrNumbers(prev);
        setExclusionError(err instanceof Error ? err.message : 'Failed to update exclusions');
        setTimeout(() => { setExclusionError(null); }, 3000);
      } finally {
        setExclusionInFlight(false);
        setSyncCooldown(true);
        setTimeout(() => { setSyncCooldown(false); }, 2000);
      }
    })();
  }
}, [getAccessToken]);
```

- [ ] **Step 5: Update `doToggleWatch` to send exclusions on create**

In the existing `doToggleWatch` function, update the `createWatch` call:

```typescript
await createWatch(token, owner, repo, branch, [...excludedPrNumbers]);
```

Read via the `excludedPrNumbersRef` already declared in Step 3 (do NOT re-declare it here — it's the same ref used by the toggle/bulk handlers).

In `doToggleWatch`:

```typescript
await createWatch(token, owner, repo, branch, [...excludedPrNumbersRef.current]);
```

- [ ] **Step 6: Update return object**

Add to the returned object:

```typescript
return {
  // ... existing fields ...
  excludedPrNumbers,
  exclusionError,
  handleToggleExclusion,
  handleSelectAll,
  handleDeselectAll,
};
```

Update the `UseMergeQueueResult` interface:

```typescript
interface UseMergeQueueResult {
  // ... existing fields ...
  excludedPrNumbers: Set<number>;
  exclusionError: string | null;
  handleToggleExclusion: (prNumber: number) => void;
  handleSelectAll: () => void;
  handleDeselectAll: (eligiblePrNumbers: number[]) => void;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useMergeQueue.ts
git commit -m "feat(web): add exclusion state management to useMergeQueue hook"
```

### Task 2.2a: Add tests for useMergeQueue exclusion logic

**Files:**
- Modify: `apps/web/src/hooks/__tests__/useMergeQueue.test.ts`

**Why this task exists:** Per CLAUDE.md, tests are *required* for `hooks/` (not optional like UI components). The hook gains significant new logic: `handleToggleExclusion`, `handleSelectAll`, `handleDeselectAll`, optimistic update/revert, `exclusionInFlight` guard, and `syncCooldown`. All must be tested.

- [ ] **Step 1: Write test — toggle exclusion optimistic update**

Add a test that verifies `handleToggleExclusion(42)` immediately adds PR #42 to `excludedPrNumbers`, and calling it again removes it (toggle behavior). Assert the state change is synchronous (optimistic).

- [ ] **Step 2: Write test — toggle exclusion reverts on API failure**

Mock `updateExclusions` to reject. Call `handleToggleExclusion(42)`, wait for the async operation to settle. Assert: (a) `excludedPrNumbers` reverts to the original state, (b) `exclusionError` is set with an error message, (c) after 3 seconds, `exclusionError` clears to null.

- [ ] **Step 3: Write test — handleSelectAll clears all exclusions**

With an active watch and some PRs excluded, call `handleSelectAll()`. Assert `excludedPrNumbers` becomes empty and `updateExclusions` is called with `[]`.

- [ ] **Step 4: Write test — handleDeselectAll excludes all eligible PRs**

Call `handleDeselectAll([1, 2, 3])`. Assert `excludedPrNumbers` becomes `new Set([1, 2, 3])` and `updateExclusions` is called with `[1, 2, 3]`.

- [ ] **Step 5: Write test — exclusionInFlight prevents sync from poll**

Simulate: (a) call `handleToggleExclusion` (sets `exclusionInFlight` true), (b) trigger a watches update (simulating a 30s poll), (c) assert `excludedPrNumbers` was NOT overwritten by the poll data while the API call is in-flight.

- [ ] **Step 6: Write test — syncCooldown prevents flicker after API call**

Simulate: (a) complete a toggle API call, (b) immediately trigger a watches update with stale data, (c) assert `excludedPrNumbers` retains the optimistic value during the 2-second cooldown window.

- [ ] **Step 7: Write test — createWatch sends excludedPrNumbers**

With no active watch, set some exclusions via toggle, then call `doToggleWatch`. Assert `createWatch` is called with `excludedPrNumbers` matching the in-memory state.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/__tests__/useMergeQueue.test.ts
git commit -m "test(web): add tests for useMergeQueue exclusion logic"
```

### Task 2.3: Add checkbox to PrRow component

**Files:**
- Modify: `apps/web/src/components/merge-queue/PrRow.tsx`

- [ ] **Step 1: Update PrRow props**

```typescript
interface PrRowProps {
  pr: MergeQueuePr;
  isNextToMerge: boolean;
  isExcluded: boolean;
  onToggleExclusion: ((prNumber: number) => void) | null;  // null when not eligible
}
```

- [ ] **Step 2: Add checkbox to desktop layout**

In the desktop grid, update the grid template to add a checkbox column. Change:

```
lg:grid-cols-[60px_1fr_120px_100px_100px]
```

to:

```
lg:grid-cols-[32px_60px_1fr_120px_100px_100px]
```

Add the checkbox as the first column item (before PR number):

```typescript
<div className="flex items-center justify-center">
  {onToggleExclusion !== null ? (
    <input
      type="checkbox"
      checked={!isExcluded}
      onChange={(): void => { onToggleExclusion(pr.number); }}
      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
      aria-label={isExcluded ? `Include PR #${String(pr.number)} in merge queue` : `Exclude PR #${String(pr.number)} from merge queue`}
    />
  ) : null}
</div>
```

- [ ] **Step 3: Add checkbox to mobile layout**

Add the checkbox at the start of the mobile layout's first flex row:

```typescript
{onToggleExclusion !== null ? (
  <input
    type="checkbox"
    checked={!isExcluded}
    onChange={(): void => { onToggleExclusion(pr.number); }}
    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
    aria-label={isExcluded ? `Include PR #${String(pr.number)} in merge queue` : `Exclude PR #${String(pr.number)} from merge queue`}
  />
) : null}
```

- [ ] **Step 4: Apply excluded styling**

Update the row's `className` to use `isExcluded` instead of only `!pr.authorIsEligible`:

```typescript
className={`rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${ACCENT_SHADOW[status]} ${
  !pr.authorIsEligible || isExcluded ? 'opacity-50' : ''
} ${isExcluded ? 'border-dashed' : ''}`}
```

- [ ] **Step 5: Update column header**

In `PrList.tsx`, update the desktop header grid to include the checkbox column:

```
lg:grid-cols-[32px_60px_1fr_120px_100px_100px]
```

Add an empty header for the checkbox column:

```typescript
<span></span>
```

as the first column.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/merge-queue/PrRow.tsx
git commit -m "feat(web): add exclusion checkbox to merge queue PrRow component"
```

### Task 2.4: Add selection counter and bulk actions to PrList

**Files:**
- Modify: `apps/web/src/components/merge-queue/PrList.tsx`

- [ ] **Step 1: Update PrList props**

```typescript
interface PrListProps {
  prs: MergeQueuePr[];
  activeFilters: Set<PrFilterStatus>;
  isLoading: boolean;
  excludedPrNumbers: Set<number>;
  onToggleExclusion: (prNumber: number) => void;
  onSelectAll: () => void;
  onDeselectAll: (eligiblePrNumbers: number[]) => void;
}
```

- [ ] **Step 2: Compute selection stats**

Compute selection stats over the **full** `prs` array (not `filteredPrs`) so the counter stays stable as users toggle status filters. The counter reflects total eligible PRs regardless of which status filter is active:

```typescript
// Use full prs array (pre-filter) so counter is stable across filter changes
const allEligiblePrs = prs.filter((pr) => pr.authorIsEligible);
const selectedCount = allEligiblePrs.filter((pr) => !excludedPrNumbers.has(pr.number)).length;
const totalEligible = allEligiblePrs.length;
```

- [ ] **Step 3: Add selection summary and bulk actions**

Before the column header, add:

```typescript
{/* Selection summary */}
{totalEligible > 0 ? (
  <div className="mb-2 flex items-center justify-between">
    <span className="text-xs text-slate-600 dark:text-slate-400">
      {String(selectedCount)} of {String(totalEligible)} PRs selected for merge
    </span>
    {totalEligible >= 2 ? (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={selectedCount === totalEligible}
          className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={(): void => { onDeselectAll(allEligiblePrs.map((pr) => pr.number)); }}
          disabled={selectedCount === 0}
          className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
        >
          Deselect all
        </button>
      </div>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 4: Pass new props to PrRow**

Update the PrRow rendering:

```typescript
<PrRow
  key={pr.number}
  pr={pr}
  isNextToMerge={pr.number === nextToMergeNumber}
  isExcluded={excludedPrNumbers.has(pr.number)}
  onToggleExclusion={pr.authorIsEligible ? onToggleExclusion : null}
/>
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/merge-queue/PrList.tsx
git commit -m "feat(web): add selection counter and bulk actions to merge queue PrList"
```

### Task 2.5: Show exclusion count in WatchStatusCard

**Files:**
- Modify: `apps/web/src/components/merge-queue/WatchStatusCard.tsx`

- [ ] **Step 1: Add `excludedCount` prop**

```typescript
interface WatchStatusCardProps {
  watch: MergeQueueWatch | null;
  onToggle: () => void;
  isToggling: boolean;
  blocked: boolean;
  excludedCount: number;
}
```

- [ ] **Step 2: Show excluded count in active watch card**

In the active (no error) section, update the stats line:

```typescript
<p className="mt-1 text-xs text-blue-600 dark:text-blue-400/80">
  Merged: {String(watch.mergedPrs.length)} &middot; Skipped: {String(watch.skippedPrs.length)}
  {excludedCount > 0 ? ` \u00b7 Excluded: ${String(excludedCount)}` : ''}
  {watch.lastTickAt !== null ? ` \u00b7 Last tick: ${formatRelative(watch.lastTickAt)}` : ''}
</p>
```

Similarly update the active-with-error section.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/merge-queue/WatchStatusCard.tsx
git commit -m "feat(web): display excluded PR count in merge queue WatchStatusCard"
```

### Task 2.6: Wire everything together in MergeQueuePage

**Files:**
- Modify: `apps/web/src/pages/MergeQueuePage.tsx`

- [ ] **Step 1: Destructure new values from useMergeQueue**

```typescript
const {
  branches, selectedBranch, setSelectedBranch,
  prs, watches,
  loading, error, prsLoading, prsError,
  isToggling, toggleError,
  fetchInitialData, handleToggleWatch,
  excludedPrNumbers, exclusionError,
  handleToggleExclusion, handleSelectAll, handleDeselectAll,
} = useMergeQueue(DEFAULT_OWNER, DEFAULT_REPO);
```

- [ ] **Step 2: Pass new props to PrList**

```typescript
<PrList
  prs={prs}
  activeFilters={activeFilters}
  isLoading={prsLoading}
  excludedPrNumbers={excludedPrNumbers}
  onToggleExclusion={handleToggleExclusion}
  onSelectAll={handleSelectAll}
  onDeselectAll={handleDeselectAll}
/>
```

- [ ] **Step 3: Pass excludedCount to WatchStatusCard**

```typescript
<WatchStatusCard
  watch={currentWatch}
  onToggle={handleToggleWatch}
  isToggling={isToggling}
  blocked={isSelectedBranchBlocked}
  excludedCount={excludedPrNumbers.size}
/>
```

- [ ] **Step 4: Add exclusion error display**

Below the existing `toggleError` display, add:

```typescript
{exclusionError !== null ? (
  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{exclusionError}</p>
) : null}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/MergeQueuePage.tsx
git commit -m "feat(web): wire exclusion state through MergeQueuePage"
```

### Task 2.7: Verify frontend builds

- [ ] **Step 1: Build the web app**

Run: `cd /repo && pnpm build --filter=web`
Expected: PASS (no TypeScript errors)

- [ ] **Step 2: Run web app tests (if any)**

Run: `cd /repo && pnpm vitest run --filter=web` (or skip if no merge-queue tests exist in web)

- [ ] **Step 3: Commit any final fixes**

---

## Final Verification

- [ ] **Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS across all workspaces

---

## Summary of Changes

| Area                | What Changes                                                        |
| ------------------- | ------------------------------------------------------------------- |
| **Domain Model**    | `MergeQueueWatch.excludedPrNumbers: number[]` added                 |
| **Repository**      | `create()` accepts `excludedPrNumbers`, `update()` persists it      |
| **Serialization**   | `serializeWatch()` includes `excludedPrNumbers` in API response     |
| **New Route**       | `PUT /code/merge-queue/watch/:watchId/exclusions`                   |
| **Modified Route**  | `POST /code/merge-queue/watch` accepts optional `excludedPrNumbers` |
| **Tick Use Case**   | Filters `excludedPrNumbers` before processing eligible PRs          |
| **Frontend Types**  | `MergeQueueWatch.excludedPrNumbers` added                           |
| **Frontend API**    | `updateExclusions()` function added, `createWatch()` extended       |
| **Hook**            | `useMergeQueue` manages exclusion state with optimistic updates     |
| **PrRow**           | Checkbox for eligible PRs, visual dimming for excluded              |
| **PrList**          | Selection counter, "Select all" / "Deselect all" buttons            |
| **WatchStatusCard** | Shows excluded count                                                |
| **MergeQueuePage**  | Wires exclusion state through all components                        |
