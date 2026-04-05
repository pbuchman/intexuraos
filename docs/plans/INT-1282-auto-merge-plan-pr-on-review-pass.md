# Auto-Merge Plan PR When Plan Review Passes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-merge plan PRs into `development` when the plan review passes, so plan docs are available immediately and the user doesn't have to manually merge before clicking "Implement."

**Architecture:** When the review webhook handler detects a passing plan-phase review (origin task `agentType === 'planning'`), it resolves the origin planning task's `result.planning_pr_url`, fetches the user's GitHub OAuth token, and calls the existing `mergePlanPr` utility. Failures are best-effort (logged, never blocking).

**Tech Stack:** TypeScript, Fastify webhook handler, existing `mergePlanPr` utility, existing `fetchGitHubToken` utility.

---

## Investigation Summary

PR #1654 (INT-1281's plan PR) was not merged when the plan review passed at `08:42:34Z`. The webhook handler explicitly skipped any action:

```
Plan review passed — skipping ready-to-implement label (user must explicitly trigger execution)
```

The plan PR was only merged later when the user manually merged it via GitHub UI at `08:47:14Z`, then clicked "Implement" at `08:47:27Z`. The `submitToExecutionAgent` found the PR "already merged" and proceeded.

**Root cause:** The review completion path for plan-phase PRs does nothing — no label, no merge. The only plan PR merge logic lives in `submitToExecutionAgent`, which runs when the user clicks "Implement." This creates a gap where plan PRs sit open after review passes.

**Fix:** Add best-effort plan PR auto-merge in the review completion webhook handler, using the same `mergePlanPr` utility already used by `submitToExecutionAgent`.

## Endpoint Changes

- **Modified:** `POST /internal/webhooks/task-complete` — review completion path gains plan PR auto-merge
- **Created:** none
- **Removed:** none
- **Unchanged:** `POST /code/tasks/:taskId/implement` — still merges plan PR (idempotent, handles already-merged)

## File Structure

| File                                                    | Action                    | Responsibility                                  |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| `apps/code-agent/src/routes/webhookRoutes.ts`           | Modify (lines ~1269-1273) | Add plan PR auto-merge after plan review passes |
| `apps/code-agent/src/__tests__/routes/webhooks.test.ts` | Modify                    | Add tests for auto-merge on plan review pass    |

## Task 1: Add tests for plan PR auto-merge on review pass

**Files:**
- Modify: `apps/code-agent/src/__tests__/routes/webhooks.test.ts`

The tests should be added near the existing review completion tests that exercise `findOriginTaskByPR`. Find the test that handles the `originResult.value.agentType === 'planning'` path (look for "skipping ready-to-implement" or the planning agent type check in review completion).

- [ ] **Step 1: Write failing test — plan review pass auto-merges plan PR**

Add a test in the review completion describe block. The test should:
1. Create a planning task with `result.planning_pr_url` set
2. Create a review task for the same PR
3. Mock `findOriginTaskByPR` to return the planning task
4. Mock `gitHubPRClient.getPullRequestStatus` to return `{ state: 'open', mergedAt: null, headRef: 'plan/test' }`
5. Mock `gitHubPRClient.mergePullRequest` to return `ok({ sha: 'abc', merged: true })`
6. Mock `userServiceClient.getOAuthToken` to return a valid token
7. Send the review completion webhook
8. Assert `gitHubPRClient.mergePullRequest` was called with the correct PR number

```typescript
it('auto-merges plan PR when plan review passes', async () => {
  // Create planning task with planning_pr_url
  const planningTask = await createTask({
    agentType: 'planning',
    status: 'planned',
    repository: 'pbuchman/intexuraos',
    result: {
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1654',
    },
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  // Create review task for the same PR
  const reviewTask = await createTask({
    agentType: 'review',
    status: 'running',
    repository: 'pbuchman/intexuraos',
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
    ok(planningTask)
  );

  vi.spyOn(gitHubPRClient, 'getPullRequestStatus').mockResolvedValueOnce(
    ok({ state: 'open' as const, mergedAt: null, headRef: 'plan/test' })
  );
  vi.spyOn(gitHubPRClient, 'mergePullRequest').mockResolvedValueOnce(
    ok({ sha: 'abc123', merged: true })
  );
  vi.spyOn(userServiceClient, 'getOAuthToken').mockResolvedValueOnce(
    ok({ accessToken: 'ghp_test', provider: 'github' })
  );

  const payload = buildReviewCompletedPayload(reviewTask.id, {
    review_comments_posted: '0',
    review_types: 'plan-review',
    needs_remediation: '0',
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    payload,
    headers: webhookHeaders(reviewTask),
  });

  expect(response.statusCode).toBe(200);
  expect(gitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
    'ghp_test',
    'pbuchman',
    'intexuraos',
    1654,
    'merge',
    expect.stringContaining('[plan]'),
  );
});
```

**Note:** Adapt the test helpers (`createTask`, `buildReviewCompletedPayload`, `webhookHeaders`) to match the patterns already used in `webhooks.test.ts`. The exact helper names and signatures may differ — read the test file's existing patterns first. The `userServiceClient` mock may need to be accessed through `getServices()` or the test's service setup — follow whatever pattern the existing review completion tests use.

- [ ] **Step 2: Write failing test — plan PR auto-merge is best-effort (doesn't fail webhook)**

```typescript
it('succeeds even when plan PR auto-merge fails', async () => {
  // Same setup as above but mergePullRequest returns error
  const planningTask = await createTask({
    agentType: 'planning',
    status: 'planned',
    repository: 'pbuchman/intexuraos',
    result: {
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1654',
    },
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  const reviewTask = await createTask({
    agentType: 'review',
    status: 'running',
    repository: 'pbuchman/intexuraos',
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
    ok(planningTask)
  );
  vi.spyOn(gitHubPRClient, 'getPullRequestStatus').mockResolvedValueOnce(
    ok({ state: 'open' as const, mergedAt: null, headRef: 'plan/test' })
  );
  vi.spyOn(gitHubPRClient, 'mergePullRequest').mockResolvedValueOnce(
    err({ code: 'API_ERROR' as const, message: 'Merge conflict' })
  );
  vi.spyOn(userServiceClient, 'getOAuthToken').mockResolvedValueOnce(
    ok({ accessToken: 'ghp_test', provider: 'github' })
  );

  const payload = buildReviewCompletedPayload(reviewTask.id, {
    review_comments_posted: '0',
    review_types: 'plan-review',
    needs_remediation: '0',
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    payload,
    headers: webhookHeaders(reviewTask),
  });

  // Webhook still succeeds — merge failure is best-effort
  expect(response.statusCode).toBe(200);
});
```

- [ ] **Step 3: Write failing test — skips merge when no GitHub token available**

```typescript
it('skips plan PR merge when GitHub token is unavailable', async () => {
  const planningTask = await createTask({
    agentType: 'planning',
    status: 'planned',
    repository: 'pbuchman/intexuraos',
    result: {
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1654',
    },
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  const reviewTask = await createTask({
    agentType: 'review',
    status: 'running',
    repository: 'pbuchman/intexuraos',
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
    ok(planningTask)
  );
  vi.spyOn(userServiceClient, 'getOAuthToken').mockResolvedValueOnce(
    err({ code: 'NOT_FOUND' as const, message: 'No token' })
  );

  const payload = buildReviewCompletedPayload(reviewTask.id, {
    review_comments_posted: '0',
    review_types: 'plan-review',
    needs_remediation: '0',
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    payload,
    headers: webhookHeaders(reviewTask),
  });

  expect(response.statusCode).toBe(200);
  expect(gitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Write failing test — skips merge when planning task has no planning_pr_url**

```typescript
it('skips plan PR merge when planning task has no planning_pr_url', async () => {
  const planningTask = await createTask({
    agentType: 'planning',
    status: 'planned',
    repository: 'pbuchman/intexuraos',
    result: {},
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  const reviewTask = await createTask({
    agentType: 'review',
    status: 'running',
    repository: 'pbuchman/intexuraos',
    prNumber: 1654,
    prBranch: 'plan/test',
  });

  vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
    ok(planningTask)
  );

  const payload = buildReviewCompletedPayload(reviewTask.id, {
    review_comments_posted: '0',
    review_types: 'plan-review',
    needs_remediation: '0',
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/1654',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/webhooks/task-complete',
    payload,
    headers: webhookHeaders(reviewTask),
  });

  expect(response.statusCode).toBe(200);
  expect(gitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: New tests FAIL because the auto-merge logic doesn't exist yet.

## Task 2: Implement plan PR auto-merge in webhook handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhookRoutes.ts` (lines ~1269-1273)

- [ ] **Step 1: Add import for `mergePlanPr` and `fetchGitHubToken`**

At the top of `webhookRoutes.ts`, add imports (check if they're already imported — `mergePlanPr` is used in `submitToExecutionAgent.ts` but may not be imported in `webhookRoutes.ts`):

```typescript
import { mergePlanPr } from '../domain/utils/mergePlanPr.js';
import { fetchGitHubToken } from '../domain/utils/gitHubTokenResolver.js';
```

- [ ] **Step 2: Replace the planning branch in the review completion handler**

Find the code block at approximately lines 1269-1273:

```typescript
if (originResult.value.agentType === 'planning') {
    // Plan-phase reviews do not auto-advance to execution.
    // The user must explicitly trigger execution from the UI.
    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
      'Plan review passed — skipping ready-to-implement label (user must explicitly trigger execution)');
}
```

Replace it with:

```typescript
if (originResult.value.agentType === 'planning') {
    // Plan-phase reviews do not auto-advance to execution.
    // The user must explicitly trigger execution from the UI.
    // But we DO auto-merge the plan PR so the plan docs land on development immediately.
    request.log.info({ taskId, prNumber, linearIssueId: originResult.value.linearIssueId },
      'Plan review passed — auto-merging plan PR (user must explicitly trigger execution)');

    const planningPrUrl = originResult.value.result?.planning_pr_url;
    if (planningPrUrl !== undefined && planningPrUrl !== '') {
      try {
        const gitHubToken = await fetchGitHubToken(userServiceClient, task.userId, request.log);
        if (gitHubToken !== null) {
          const mergeResult = await mergePlanPr(
            { logger: request.log, gitHubPRClient },
            { planningPrUrl, repository: task.repository, token: gitHubToken },
          );
          if (mergeResult.ok) {
            request.log.info({ prNumber, planningPrUrl }, 'Plan PR auto-merged on review pass');
          } else {
            request.log.warn({ prNumber, planningPrUrl, error: mergeResult.error }, 'Plan PR auto-merge failed (best-effort)');
          }
        } else {
          request.log.warn({ prNumber }, 'Skipping plan PR auto-merge — no GitHub token available');
        }
      } catch (mergeError: unknown) {
        request.log.warn({ prNumber, planningPrUrl, error: mergeError }, 'Plan PR auto-merge threw (best-effort)');
      }
    } else {
      request.log.debug({ prNumber, taskId: originResult.value.id }, 'No planning_pr_url on origin task — skipping plan PR auto-merge');
    }
}
```

**Key design decisions:**
- Best-effort: failures are logged as warnings, never block the webhook response
- Uses `task.userId` (review task's user) to fetch the GitHub token — same user owns the planning task
- Uses `task.repository` for the merge input — same repo for the plan PR
- The `try/catch` around the entire block prevents any unexpected error from breaking the webhook
- `submitToExecutionAgent` still has its own merge call — it's idempotent (handles "already merged")

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All new tests PASS. All existing tests still PASS.

- [ ] **Step 4: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/webhookRoutes.ts apps/code-agent/src/__tests__/routes/webhooks.test.ts
git commit -m "fix(code-agent): auto-merge plan PR when plan review passes

When a plan-phase review completes successfully, the plan PR is now
auto-merged into development (best-effort). This ensures plan docs are
immediately available without requiring the user to manually merge
before clicking Implement.

The merge is idempotent — submitToExecutionAgent still has its own
merge call which handles already-merged PRs gracefully.

Fixes INT-1282"
```
