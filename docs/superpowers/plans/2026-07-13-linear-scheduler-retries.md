# Linear Scheduler Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/internal/linear/sync-all` return a scheduler-retryable error whenever any connected user was not synced, while still attempting every user.

**Architecture:** The domain fan-out collects failures rather than swallowing them. After all users are attempted it returns `UPSTREAM_UNAVAILABLE` when any transient upstream failure occurred, otherwise the first domain failure; the existing HTTP error mapper turns the transient code into `503`.

**Tech Stack:** TypeScript, Result types from `@intexuraos/common-core`, Fastify, Vitest.

## Global Constraints

- Keep processing connected users after an individual failure.
- Return success only if every connected user sync succeeds.
- Preserve an observed `UPSTREAM_UNAVAILABLE` error so Cloud Scheduler receives HTTP `503`.
- Do not add or remove an endpoint; only modify `POST /internal/linear/sync-all` behavior and schema.
- Preserve successful response fields `userCount` and `totalIssues`.
- Keep 100% branch coverage and run `pnpm run ci:tracked` before commit.

---

### Task 1: Propagate Partial Fan-Out Failures

**Files:**
- Modify: `apps/linear-agent/src/__tests__/domain/useCases/fullSyncUseCase.test.ts`
- Modify: `apps/linear-agent/src/domain/useCases/fullSyncUseCase.ts`

**Interfaces:**
- Consumes: `fullSync(userId, deps): Promise<Result<SyncStats, LinearError>>`.
- Produces: unchanged `fullSyncAllUsers` signature with failure returned after the complete fan-out.

- [ ] **Step 1: Replace the swallowed-failure expectation with a failing propagation test**

Change the existing `continues on individual user sync failure` test so it verifies that both users are attempted and the aggregate fails:

```ts
it('returns an error after attempting every user when one sync fails', async () => {
  const originalGetFullConnection = connectionRepo.getFullConnection.bind(connectionRepo);
  const getFullConnectionSpy = vi
    .spyOn(connectionRepo, 'getFullConnection')
    .mockImplementation(async (userId) => {
      if (userId === 'user-1') {
        return err({ code: 'NOT_CONNECTED', message: 'User not connected' });
      }
      return await originalGetFullConnection(userId);
    });

  const result = await fullSyncAllUsers(deps);

  expect(result).toEqual({
    ok: false,
    error: { code: 'NOT_CONNECTED', message: 'User not connected' },
  });
  expect(getFullConnectionSpy).toHaveBeenCalledWith('user-1');
  expect(getFullConnectionSpy).toHaveBeenCalledWith('user-2');
});
```

- [ ] **Step 2: Add a failing transient-priority test**

```ts
it('prioritizes a transient failure after attempting every user', async () => {
  deps.getAllConnectedUserIds = vi
    .fn()
    .mockResolvedValue({ ok: true, value: ['user-1', 'user-2', 'user-3'] });
  const originalGetFullConnection = connectionRepo.getFullConnection.bind(connectionRepo);
  const getFullConnectionSpy = vi
    .spyOn(connectionRepo, 'getFullConnection')
    .mockImplementation(async (userId) => {
      if (userId === 'user-1') {
        return err({ code: 'NOT_CONNECTED', message: 'User not connected' });
      }
      if (userId === 'user-2') {
        return err({ code: 'UPSTREAM_UNAVAILABLE', message: 'Linear API temporarily unavailable' });
      }
      return await originalGetFullConnection(userId);
    });

  const result = await fullSyncAllUsers(deps);

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Linear API temporarily unavailable',
    },
  });
  expect(getFullConnectionSpy).toHaveBeenCalledTimes(3);
});
```

Seed `user-3` with the same valid connection shape as the existing two users before invoking the use case.

- [ ] **Step 3: Run the domain tests and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run apps/linear-agent/src/__tests__/domain/useCases/fullSyncUseCase.test.ts`

Expected: both new expectations fail because the current aggregate returns `ok`.

- [ ] **Step 4: Implement minimal failure collection**

In `fullSyncAllUsers`, retain the loop and add exact failure selection:

```ts
let totalIssues = 0;
let firstFailure: LinearError | null = null;
let transientFailure: LinearError | null = null;

for (const userId of userIds) {
  const result = await fullSync(userId, deps);
  if (result.ok) {
    totalIssues += result.value.total;
    continue;
  }

  logger.error({ userId, error: result.error }, 'Failed to sync user');
  firstFailure ??= result.error;
  if (result.error.code === 'UPSTREAM_UNAVAILABLE') {
    transientFailure ??= result.error;
  }
}

if (transientFailure !== null) {
  return err(transientFailure);
}
if (firstFailure !== null) {
  return err(firstFailure);
}

return ok({ userCount: userIds.length, totalIssues });
```

- [ ] **Step 5: Run domain tests and verify GREEN**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run apps/linear-agent/src/__tests__/domain/useCases/fullSyncUseCase.test.ts`

Expected: PASS with complete branch coverage for failure selection.

### Task 2: Expose Scheduler-Retryable HTTP Behavior

**Files:**
- Modify: `apps/linear-agent/src/__tests__/routes/internalRoutes.test.ts`
- Modify: `apps/linear-agent/src/routes/internalRoutes.ts`

**Interfaces:**
- Consumes: `fullSyncAllUsers` domain result and existing `handleLinearError` mapping.
- Produces: documented `503` response for `UPSTREAM_UNAVAILABLE`; unchanged `200` response for complete success.

- [ ] **Step 1: Add a failing partial-transient route test**

Seed two connected users, then use a per-user repository spy:

```ts
it('returns 503 after attempting all users when one sync is transiently unavailable', async () => {
  const connectionOne: LinearConnection = {
    userId: 'user-1', apiKey: 'key-1', teamId: 'team-1', teamName: 'Team 1',
    webhookSecret: null, connected: true,
    createdAt: '2025-01-15T00:00:00Z', updatedAt: '2025-01-15T00:00:00Z',
  };
  const connectionTwo: LinearConnection = {
    userId: 'user-2', apiKey: 'key-2', teamId: 'team-2', teamName: 'Team 2',
    webhookSecret: null, connected: true,
    createdAt: '2025-01-15T00:00:00Z', updatedAt: '2025-01-15T00:00:00Z',
  };
  fakeConnectionRepo.seedConnection(connectionOne);
  fakeConnectionRepo.seedConnection(connectionTwo);
  const originalGetFullConnection = fakeConnectionRepo.getFullConnection.bind(fakeConnectionRepo);
  const getFullConnectionSpy = vi
    .spyOn(fakeConnectionRepo, 'getFullConnection')
    .mockImplementation(async (userId) => userId === 'user-1'
      ? err({ code: 'UPSTREAM_UNAVAILABLE', message: 'Linear API temporarily unavailable' })
      : await originalGetFullConnection(userId));

  const response = await app.inject({
    method: 'POST',
    url: '/internal/linear/sync-all',
    headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
  });

  expect(response.statusCode).toBe(503);
  expect(response.json().success).toBe(false);
  expect(getFullConnectionSpy).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run apps/linear-agent/src/__tests__/routes/internalRoutes.test.ts`

Expected: FAIL until the domain change is present; if schema serialization rejects `503`, the response schema change remains necessary.

- [ ] **Step 3: Add the explicit 503 response schema**

Add a `503` schema next to `500`, using the same standard failure envelope:

```ts
503: {
  description: 'Linear upstream temporarily unavailable',
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { $ref: 'ErrorBody#' },
    diagnostics: { $ref: 'Diagnostics#' },
  },
},
```

Do not change the route handler: it already delegates failed results to `handleLinearError`, which maps `UPSTREAM_UNAVAILABLE` to `SERVICE_UNAVAILABLE`.

- [ ] **Step 4: Verify targeted workspace quality**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm exec vitest run apps/linear-agent/src/__tests__/domain/useCases/fullSyncUseCase.test.ts apps/linear-agent/src/__tests__/routes/internalRoutes.test.ts
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm run verify:workspace:tracked -- linear-agent
```

Expected: tests, types, lint, and 100% branch coverage pass.

- [ ] **Step 5: Run full CI and commit**

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm run ci:tracked
git add apps/linear-agent/src/domain/useCases/fullSyncUseCase.ts apps/linear-agent/src/routes/internalRoutes.ts apps/linear-agent/src/__tests__/domain/useCases/fullSyncUseCase.test.ts apps/linear-agent/src/__tests__/routes/internalRoutes.test.ts
git commit -m "fix: retry incomplete Linear scheduled syncs"
```

Expected: CI passes and the commit contains only the Linear behavior, schema, and tests.
