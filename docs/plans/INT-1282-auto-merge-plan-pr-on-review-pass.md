# Auto-Merge Plan PR When Plan Review Passes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-merge plan PRs into `development` when the plan review passes, so users no longer have to merge plan PRs manually before clicking "Code" (dispatch to execution).

**Architecture:** Add a best-effort plan PR merge call in the webhook review-completion handler (`webhookRoutes.ts`) when the origin task is a `planning` task and the review passes without needing remediation. The existing merge step in `submitToExecutionAgent` (step 8b) remains as an idempotent safety net. Single-service change in `code-agent`.

**Tech Stack:** TypeScript, Fastify, Vitest, Firestore

---

## Root Cause Analysis

### What happens today

When a plan review task completes successfully:

1. The webhook handler at `webhookRoutes.ts:1269` checks if the origin task is a `planning` task.
2. If yes, it logs `"Plan review passed -- skipping ready-to-implement label"` and **does nothing else**.
3. The plan PR remains open on GitHub.
4. The user sees the open PR and merges it manually.
5. The user then clicks "Code" in the UI.
6. `submitToExecutionAgent` runs step 8b -- finds the PR already merged -- proceeds.

### Evidence from production (2026-04-05)

| Time (UTC) | Event                                                                      | Actor             |
| ---------- | -------------------------------------------------------------------------- | ----------------- |
| 08:41:22   | INT-1279 plan review passed -- "skipping ready-to-implement label"         | System            |
| 08:42:22   | PR #1655 (INT-1279 plan PR) merged                                         | pbuchman (manual) |
| 08:42:34   | INT-1281 plan review passed -- "skipping ready-to-implement label"         | System            |
| 08:47:14   | PR #1654 (INT-1281 plan PR) merged                                         | pbuchman (manual) |
| 08:47:28   | INT-1281 dispatched to execution -- "Plan PR already merged -- proceeding" | System            |

Both plan PRs were merged manually by the user. The system never attempted to auto-merge them because the merge logic only lives in `submitToExecutionAgent` (triggered by the "Code" button), not in the review-completion handler.

### Fix

Add a best-effort plan PR merge call in the webhook review-completion handler when the origin task is a `planning` type. Plan PRs get merged as soon as the review passes, before the user ever sees the "Code" button. The existing merge in `submitToExecutionAgent` stays as an idempotent fallback.

---

## Endpoint Changes

- **Modified:** `POST /internal/webhooks/task-complete` -- review completion path gains plan PR auto-merge
- **Created:** none
- **Removed:** none
- **Unchanged:** `POST /code/tasks/:taskId/implement` -- still merges plan PR (idempotent, handles already-merged)

## File Map

| File                                                    | Action                    | Responsibility                                  |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| `apps/code-agent/src/routes/webhookRoutes.ts`           | Modify (lines ~1269-1273) | Add plan PR auto-merge after plan review passes |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts` | Modify (~line 4987)       | Add tests for auto-merge on plan review pass    |

No new files. The `mergePlanPr` utility (`apps/code-agent/src/domain/utils/mergePlanPr.ts`) and `fetchGitHubToken` resolver (`apps/code-agent/src/domain/utils/gitHubTokenResolver.ts`) already exist and are used by `submitToExecutionAgent`.

---

## Task 1: Add tests for plan PR auto-merge on review pass

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

The tests go inside the existing `describe('review task-complete -> review-outcome labels on Linear issue')` block (starts at ~line 4874). This block already has helper functions `createOriginTask`, `createReviewTaskForLabel`, `makeLabelPayload`, and `sendLabelPayload`. Read these helpers first before writing tests -- they define the mock patterns you must follow.

### Important context for the implementer

The `createOriginTask` helper creates a task with a specific `traceId` and `agentType`. It sets `prNumber: 1234` and `repository: 'pbuchman/intexuraos'` by default. The `createReviewTaskForLabel` helper creates a review task. The `makeLabelPayload` builds the webhook payload. The `sendLabelPayload` sends it via `app.inject`.

The services `gitHubPRClient`, `userServiceClient`, and `linearAgentClient` are accessed via `getServices()` -- read how existing tests mock them (they use `vi.mocked()`). The `codeTaskRepo` is a real FakeFirestore-backed repo.

- [ ] **Step 1: Write failing test -- plan review passes and triggers plan PR merge**

Add a new test right after the existing `it('does NOT set ready-to-implement label when origin task is a planning task')` test (~line 4987):

```typescript
it('auto-merges plan PR when origin task is a planning task with planning_pr_url', async () => {
  const planningTask = await createOriginTask({ traceId: 'trace_plan_merge', agentType: 'planning' });
  await codeTaskRepo.update(planningTask.id, {
    result: { planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/9999' },
  });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_plan_merge_review' });
  const payload = makeLabelPayload(reviewTask.id);

  const { gitHubPRClient: ghClient, userServiceClient: userClient } = getServices();
  const mergeSpy = vi.mocked(ghClient.mergePullRequest);
  const statusSpy = vi.mocked(ghClient.getPullRequestStatus);
  const tokenSpy = vi.mocked(userClient.getOAuthToken);

  tokenSpy.mockResolvedValueOnce({ ok: true, value: { accessToken: 'gh-token-123' } } as never);
  statusSpy.mockResolvedValueOnce({ ok: true, value: { state: 'open', mergedAt: null } } as never);
  mergeSpy.mockResolvedValueOnce({ ok: true, value: { sha: 'abc123', merged: true } } as never);

  const response = await sendLabelPayload(payload);

  expect(response.statusCode).toBe(200);
  // No label set (planning origin skips labeling)
  const { linearAgentClient: lac } = getServices();
  expect(vi.mocked(lac.updateIssueMetadata)).not.toHaveBeenCalled();
  // Plan PR merge IS attempted
  expect(statusSpy).toHaveBeenCalledWith('gh-token-123', 'pbuchman', 'intexuraos', 9999);
  expect(mergeSpy).toHaveBeenCalledWith(
    'gh-token-123', 'pbuchman', 'intexuraos', 9999, 'merge',
    expect.stringContaining('[plan]'),
  );
});
```

> **Adapt as needed:** If `getOAuthToken` mock shape doesn't match (e.g., uses `Result` types from `@intexuraos/common-core`), adjust to match the actual `UserServiceClient` interface. The key assertions are: (1) `updateIssueMetadata` NOT called, (2) `mergePullRequest` called with correct args.

- [ ] **Step 2: Write failing test -- skips merge when no planning_pr_url**

```typescript
it('skips plan PR merge when origin planning task has no planning_pr_url', async () => {
  await createOriginTask({ traceId: 'trace_plan_no_url', agentType: 'planning' });
  // No result.planning_pr_url set on origin task
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_plan_no_url_review' });
  const payload = makeLabelPayload(reviewTask.id);

  const { gitHubPRClient: ghClient } = getServices();
  const mergeSpy = vi.mocked(ghClient.mergePullRequest);
  const statusSpy = vi.mocked(ghClient.getPullRequestStatus);

  const response = await sendLabelPayload(payload);

  expect(response.statusCode).toBe(200);
  expect(statusSpy).not.toHaveBeenCalled();
  expect(mergeSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write failing test -- merge failure is best-effort**

```typescript
it('returns 200 even when plan PR auto-merge fails (best-effort)', async () => {
  const planningTask = await createOriginTask({ traceId: 'trace_plan_merge_fail', agentType: 'planning' });
  await codeTaskRepo.update(planningTask.id, {
    result: { planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/8888' },
  });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_plan_merge_fail_review' });
  const payload = makeLabelPayload(reviewTask.id);

  const { gitHubPRClient: ghClient, userServiceClient: userClient } = getServices();
  vi.mocked(userClient.getOAuthToken).mockResolvedValueOnce(
    { ok: true, value: { accessToken: 'gh-token-fail' } } as never,
  );
  vi.mocked(ghClient.getPullRequestStatus).mockResolvedValueOnce(
    { ok: false, error: { code: 'NOT_FOUND', message: 'PR not found' } } as never,
  );

  const response = await sendLabelPayload(payload);
  expect(response.statusCode).toBe(200);
});
```

- [ ] **Step 4: Write failing test -- skips merge when GitHub token unavailable**

```typescript
it('skips plan PR merge when GitHub token is unavailable', async () => {
  const planningTask = await createOriginTask({ traceId: 'trace_plan_no_token', agentType: 'planning' });
  await codeTaskRepo.update(planningTask.id, {
    result: { planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/7777' },
  });
  const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_plan_no_token_review' });
  const payload = makeLabelPayload(reviewTask.id);

  const { gitHubPRClient: ghClient, userServiceClient: userClient } = getServices();
  vi.mocked(userClient.getOAuthToken).mockResolvedValueOnce(
    { ok: false, error: { code: 'NOT_FOUND', message: 'No token' } } as never,
  );

  const response = await sendLabelPayload(payload);

  expect(response.statusCode).toBe(200);
  expect(vi.mocked(ghClient.mergePullRequest)).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts --reporter=verbose 2>&1 | tail -40`

Expected: New tests FAIL because the auto-merge implementation doesn't exist yet.

---

## Task 2: Implement plan PR auto-merge in webhook handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts:1269-1273`

- [ ] **Step 1: Add imports for `mergePlanPr` and `fetchGitHubToken`**

At the top of `apps/code-agent/src/routes/webhookRoutes.ts`, add:

```typescript
import { mergePlanPr } from '../domain/utils/mergePlanPr.js';
import { fetchGitHubToken } from '../domain/utils/gitHubTokenResolver.js';
```

Check if either is already imported (search the file first). `mergePlanPr` is NOT imported in webhookRoutes.ts (it's in submitToExecutionAgent.ts). `fetchGitHubToken` is also NOT imported in webhookRoutes.ts.

- [ ] **Step 2: Modify the planning branch in the review completion handler**

Find the block at approximately lines 1269-1273:

```typescript
                  if (originResult.value.agentType === 'planning') {
                    // Plan-phase reviews do not auto-advance to execution.
                    // The user must explicitly trigger execution from the UI.
                    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
                      'Plan review passed — skipping ready-to-implement label (user must explicitly trigger execution)');
                  } else {
```

Replace with:

```typescript
                  if (originResult.value.agentType === 'planning') {
                    // Plan-phase reviews do not auto-advance to execution.
                    // The user must explicitly trigger execution from the UI.
                    // But we DO auto-merge the plan PR so plan docs land on development immediately.
                    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
                      'Plan review passed — auto-merging plan PR (user must explicitly trigger execution)');

                    // Best-effort: merge the plan PR into development now so the user
                    // doesn't have to merge it manually before clicking "Code".
                    // submitToExecutionAgent step 8b is the idempotent safety net.
                    const planPrUrl: unknown = originResult.value.result?.planning_pr_url ?? originResult.value.result?.prUrl;
                    if (typeof planPrUrl === 'string' && planPrUrl !== '') {
                      try {
                        const ghToken = await fetchGitHubToken(userServiceClient, originResult.value.userId, request.log);
                        if (ghToken !== null) {
                          const mergeResult = await mergePlanPr(
                            { logger: request.log, gitHubPRClient },
                            { planningPrUrl: planPrUrl, repository: originResult.value.repository, token: ghToken },
                          );
                          if (mergeResult.ok) {
                            request.log.info({ prNumber, planPrUrl, linearIssueId: originResult.value.linearIssueId },
                              'Plan PR auto-merged on review pass');
                          } else {
                            request.log.warn({ prNumber, planPrUrl, error: mergeResult.error, linearIssueId: originResult.value.linearIssueId },
                              'Plan PR auto-merge failed on review pass (best-effort)');
                          }
                        } else {
                          request.log.warn({ prNumber, linearIssueId: originResult.value.linearIssueId },
                            'Skipping plan PR auto-merge — no GitHub token available');
                        }
                      } catch (mergeError: unknown) {
                        request.log.warn({ prNumber, planPrUrl, error: mergeError, linearIssueId: originResult.value.linearIssueId },
                          'Plan PR auto-merge threw unexpectedly (best-effort)');
                      }
                    }
                  } else {
```

**Key design decisions:**
- `planPrUrl` typed as `unknown` first, then narrowed with `typeof === 'string'` -- avoids TypeScript strict-mode issues with dynamic `result` properties.
- Uses `originResult.value.userId` (planning task's user) to fetch the GitHub token -- same user owns both tasks.
- Uses `originResult.value.repository` for the repo identifier.
- The `try/catch` wraps the entire merge block -- any unexpected error is logged and swallowed.
- The `submitToExecutionAgent` merge (step 8b) is NOT removed -- it serves as an idempotent safety net.
- Log messages use distinct text ("auto-merged on review pass") vs. the `submitToExecutionAgent` logs ("merged into development -- proceeding") so production debugging can trace which path performed the merge.

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/routes/webhooks.test.ts --reporter=verbose 2>&1 | tail -40`

Expected: All 4 new tests pass. All existing tests still pass.

- [ ] **Step 4: Run full CI**

Run: `cd /repo && pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int1282.txt | tail -20`

Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): auto-merge plan PR when plan review passes

When a plan-phase review completes successfully, the plan PR is now
auto-merged into development (best-effort). This ensures plan docs are
immediately available without requiring the user to manually merge the
plan PR before clicking Code to dispatch execution.

The merge in submitToExecutionAgent step 8b remains as an idempotent
safety net for cases where the auto-merge failed or was skipped.

Fixes INT-1282"
```

---

## Risks and Mitigations

| Risk                                          | Mitigation                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Plan PR has merge conflicts                   | Best-effort: logged as warning. User can merge manually. `submitToExecutionAgent` will also retry on dispatch. |
| GitHub token unavailable                      | Logged as warning, merge skipped. Same token resolution as `submitToExecutionAgent`.                           |
| Race condition: user merges PR simultaneously | `mergePlanPr` is idempotent -- "already merged" is treated as success (line 70-72 of `mergePlanPr.ts`).        |
| Review webhook fires before PR is ready       | `getPullRequestStatus` handles all states (open, closed, merged) gracefully.                                   |
| Plan review fails remediation check           | Auto-merge only runs when `needs_remediation === '0'` -- the code path is only reached for passing reviews.    |
