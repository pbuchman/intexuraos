# Merge Plan PR Before Coding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the orchestrator's in-worktree plan branch merge with an upfront GitHub API merge of the plan PR into `development`, enforced before any execution task is dispatched.

**Architecture:** When a user clicks "Implement", the code-agent merges the plan PR into `development` via the GitHub API before creating the execution task. If the merge fails (conflict, PR closed, etc.), the task is rejected with a clear error. The orchestrator's redundant plan-branch merge and plan-PR closure logic is removed. Execution tasks always start clean from `development` which already contains the plan.

**Tech Stack:** TypeScript, Fastify, GitHub REST API (via existing `GitHubPRClient` port), Zod, Vitest

---

## File Structure

### Code-Agent (Subtask 1)

| Action   | File                                                                           | Responsibility                                                               |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Modify   | `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`                | Add plan PR merge step before execution task creation                        |
| Modify   | `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`                | Remove `planningPrBranch`/`planningPrUrl` from execution task creation input |
| Modify   | `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`                     | Stop sending `planningPrBranch`/`planningPrUrl` in dispatch payload          |
| Modify   | `apps/code-agent/src/domain/services/taskDispatcher.ts`                        | Remove `planningPrBranch`/`planningPrUrl` from `DispatchRequest` interface   |
| Modify   | `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`                        | Stop sending `planningPrBranch`/`planningPrUrl` in drain dispatch            |
| Modify   | `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`                       | Stop sending `planningPrBranch`/`planningPrUrl` in retry dispatch            |
| Create   | `apps/code-agent/src/domain/utils/mergePlanPr.ts`                              | Utility to merge a plan PR via GitHub API with error handling                |
| Create   | `apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts`               | Tests for plan PR merge utility                                              |
| Modify   | `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts` | Add tests for plan PR merge step                                             |
| Modify   | `apps/code-agent/src/__tests__/infra/services/taskDispatcher.test.ts`          | Remove planningPr-related dispatch assertions                                |
| Modify   | `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`         | Remove planningPr-related dispatch assertions                                |

### Orchestrator (Subtask 2)

| Action   | File                                                          | Responsibility                                                                           |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Modify   | `workers/orchestrator/src/services/task-dispatcher.ts`        | Remove `mergePlanningBranch` call in `executeTaskSetup`, remove `closePlanningPr` method |
| Modify   | `workers/orchestrator/src/services/worktree-manager.ts`       | Remove `mergePlanningBranch` method                                                      |
| Modify   | `workers/orchestrator/src/types/schemas.ts`                   | Remove `planningPrBranch`/`planningPrUrl` from Zod schema                                |
| Modify   | `workers/orchestrator/src/types/api.ts`                       | Remove `planningPrBranch`/`planningPrUrl` from `CreateTaskRequest` interface             |
| Modify   | `workers/orchestrator/src/types/task.ts`                      | Remove `planningPrBranch`/`planningPrUrl` from `Task` interface                          |
| Modify   | `workers/orchestrator/src/routes.ts`                          | Remove `planningPrBranch`/`planningPrUrl` mapping in POST /tasks handler                 |
| Modify   | `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`  | Remove planning branch merge tests, remove closePlanningPr tests                         |
| Modify   | `workers/orchestrator/src/__tests__/worktree-manager.test.ts` | Remove `mergePlanningBranch` tests                                                       |

---

## Shared Contract Between Subtasks

Both subtasks can be developed and tested independently. The contract is:

1. **Code-agent stops sending** `planningPrBranch` and `planningPrUrl` in dispatch payloads to the orchestrator.
2. **Orchestrator stops accepting** `planningPrBranch` and `planningPrUrl` in `POST /tasks` — Zod schema strips unknown fields by default, so removing these fields is backward-compatible with any in-flight old-format requests.
3. **No new fields** are added to the dispatch API.
4. **Error code contract**: Code-agent adds `plan_pr_merge_failed` to `SubmitToExecutionAgentErrorCode`. The web app already handles errors generically via `getErrorMessage()` so no web app changes are needed.

### Deployment Order

Code-agent should be deployed **before** the orchestrator for safety:
- If code-agent deploys first: New tasks don't send `planningPrBranch`/`planningPrUrl`. Old orchestrator has the merge logic but it won't trigger (fields absent). Safe.
- If orchestrator deploys first: Removes merge logic. Old code-agent still sends `planningPrBranch`/`planningPrUrl` but they're stripped by Zod. Plan won't be merged in worktree AND won't be merged via GitHub API (old code-agent doesn't do that). This is a regression — execution tasks start without plan content.

This deployment order is for production safety only — development and testing can proceed in parallel.

---

## Edge Cases

| Edge Case                                               | Handling                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan PR already merged (manually or by another process) | `GitHubPRClient.mergePullRequest()` returns 405 for already-merged PRs — treat as success, proceed normally                                                                                         |
| Plan PR has merge conflicts with development            | Return `plan_pr_merge_failed` error with message: "Plan PR has merge conflicts with the development branch. Resolve conflicts manually, then retry."                                                |
| Plan PR was closed (not merged)                         | `getPullRequestStatus()` returns `state: 'closed'` — return `plan_pr_merge_failed` with message: "Plan PR was closed without merging. Reopen and merge the plan PR, or create a new planning task." |
| Plan PR was deleted                                     | GitHub API returns 404 — return `plan_pr_merge_failed` with message: "Plan PR not found. It may have been deleted."                                                                                 |
| GitHub API unavailable                                  | Return `plan_pr_merge_failed` with the underlying network error message                                                                                                                             |
| No plan PR (task has no planning step)                  | Skip merge step, proceed normally (e.g., direct `code-task` label without planning)                                                                                                                 |
| Complex task with children (fan-out)                    | Plan PR is merged in `submitToExecutionAgent()` BEFORE `fanOutChildTasks()` is called. All children start from development which has the plan.                                                      |
| Retry of execution task                                 | Execution tasks don't have `planningPrUrl` set (removed from creation). Plan is already on development. No merge needed.                                                                            |
| Planning task result has no `planning_pr_url`           | Planning completed without a PR (e.g., simple plan). Skip merge step, proceed normally.                                                                                                             |
| Multiple execution tasks for same plan                  | First one merges the PR. Subsequent ones see it as already merged (405) — treated as success.                                                                                                       |

---

## Subtask 1: Code-Agent — Merge Plan PR Before Execution Dispatch

### Task 1.1: Create `mergePlanPr` Utility

**Files:**
- Create: `apps/code-agent/src/domain/utils/mergePlanPr.ts`
- Create: `apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts`

This utility extracts a PR number from a plan PR URL, checks the PR status, and merges it via the GitHub API.

- [ ] **Step 1: Write the failing test for successful merge**

```typescript
// apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergePlanPr, type MergePlanPrDeps } from '../../domain/utils/mergePlanPr.js';
import { ok, err } from '@intexuraos/common-core';

function createFakeDeps(overrides?: Partial<MergePlanPrDeps>): MergePlanPrDeps {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as MergePlanPrDeps['logger'],
    gitHubPRClient: {
      mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/test' })),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
    ...overrides,
  };
}

describe('mergePlanPr', () => {
  it('merges an open plan PR and returns success', async () => {
    const deps = createFakeDeps();

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(true);
    expect(deps.gitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
      'ghp_test',
      'pbuchman',
      'intexuraos',
      1509,
      'merge',
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// apps/code-agent/src/domain/utils/mergePlanPr.ts
import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';

export interface MergePlanPrDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
}

export interface MergePlanPrInput {
  planningPrUrl: string;
  repository: string;
  token: string;
}

export interface MergePlanPrError {
  code: 'plan_pr_merge_failed';
  message: string;
}

/**
 * Parse PR number from a GitHub PR URL.
 * Accepts: https://github.com/{owner}/{repo}/pull/{number}
 */
function parsePrNumber(url: string): number | undefined {
  const match = /\/pull\/(\d+)/.exec(url);
  if (match?.[1] === undefined) return undefined;
  return Number(match[1]);
}

/**
 * Merge a plan PR into its base branch (development) via the GitHub API.
 *
 * Handles:
 * - Open PR → merge it (squash not used because merge preserves branch history)
 * - Already merged → treat as success (idempotent)
 * - Closed without merge → return error
 * - PR not found / API error → return error
 */
export async function mergePlanPr(
  deps: MergePlanPrDeps,
  input: MergePlanPrInput,
): Promise<Result<void, MergePlanPrError>> {
  const { logger, gitHubPRClient } = deps;
  const { planningPrUrl, repository, token } = input;

  const prNumber = parsePrNumber(planningPrUrl);
  if (prNumber === undefined) {
    return err({
      code: 'plan_pr_merge_failed',
      message: `Could not parse PR number from plan PR URL: ${planningPrUrl}`,
    });
  }

  const [owner, repo] = repository.split('/');
  if (owner === undefined || repo === undefined) {
    return err({
      code: 'plan_pr_merge_failed',
      message: `Invalid repository format: ${repository}`,
    });
  }

  // Step 1: Check current PR state
  const statusResult = await gitHubPRClient.getPullRequestStatus(
    token, owner, repo, prNumber,
  );

  if (!statusResult.ok) {
    const msg = statusResult.error.code === 'NOT_FOUND'
      ? `Plan PR #${String(prNumber)} not found. It may have been deleted.`
      : `Failed to check plan PR #${String(prNumber)} status: ${statusResult.error.message}`;
    logger.warn({ prNumber, error: statusResult.error }, msg);
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  const status = statusResult.value;

  // Already merged — idempotent success
  if (status.mergedAt !== null) {
    logger.info({ prNumber, mergedAt: status.mergedAt }, 'Plan PR already merged — proceeding');
    return ok(undefined);
  }

  // Closed without merge — cannot proceed
  if (status.state === 'closed') {
    const msg = `Plan PR #${String(prNumber)} was closed without merging. Reopen and merge the plan PR, or create a new planning task.`;
    logger.warn({ prNumber }, msg);
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  // Step 2: Merge the PR
  const commitTitle = `[plan] Merge plan PR #${String(prNumber)}`;
  const mergeResult = await gitHubPRClient.mergePullRequest(
    token, owner, repo, prNumber, 'merge', commitTitle,
  );

  if (!mergeResult.ok) {
    const msg = `Failed to merge plan PR #${String(prNumber)}: ${mergeResult.error.message}. The plan PR may have merge conflicts with the development branch. Resolve conflicts manually, then retry.`;
    logger.warn({ prNumber, error: mergeResult.error }, 'Plan PR merge failed');
    return err({ code: 'plan_pr_merge_failed', message: msg });
  }

  logger.info(
    { prNumber, sha: mergeResult.value.sha, merged: mergeResult.value.merged },
    'Plan PR merged into development successfully',
  );

  return ok(undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts`
Expected: PASS

- [ ] **Step 5: Write additional test cases**

Add to the same test file:

```typescript
it('returns success when plan PR is already merged', async () => {
  const deps = createFakeDeps({
    gitHubPRClient: {
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({
        state: 'closed', mergedAt: new Date(), headRef: 'plan/test',
      })),
      mergePullRequest: vi.fn(),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
  });

  const result = await mergePlanPr(deps, {
    planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
    repository: 'pbuchman/intexuraos',
    token: 'ghp_test',
  });

  expect(result.ok).toBe(true);
  expect(deps.gitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
});

it('returns error when plan PR is closed without merge', async () => {
  const deps = createFakeDeps({
    gitHubPRClient: {
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({
        state: 'closed', mergedAt: null, headRef: 'plan/test',
      })),
      mergePullRequest: vi.fn(),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
  });

  const result = await mergePlanPr(deps, {
    planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
    repository: 'pbuchman/intexuraos',
    token: 'ghp_test',
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('plan_pr_merge_failed');
    expect(result.error.message).toContain('closed without merging');
  }
});

it('returns error when plan PR has merge conflicts', async () => {
  const deps = createFakeDeps({
    gitHubPRClient: {
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({
        state: 'open', mergedAt: null, headRef: 'plan/test',
      })),
      mergePullRequest: vi.fn().mockResolvedValue(err({
        code: 'API_ERROR',
        message: 'Merge conflict',
      })),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
  });

  const result = await mergePlanPr(deps, {
    planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
    repository: 'pbuchman/intexuraos',
    token: 'ghp_test',
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('plan_pr_merge_failed');
    expect(result.error.message).toContain('Merge conflict');
  }
});

it('returns error when plan PR is not found', async () => {
  const deps = createFakeDeps({
    gitHubPRClient: {
      getPullRequestStatus: vi.fn().mockResolvedValue(err({
        code: 'NOT_FOUND',
        message: 'Not Found',
      })),
      mergePullRequest: vi.fn(),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
  });

  const result = await mergePlanPr(deps, {
    planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/9999',
    repository: 'pbuchman/intexuraos',
    token: 'ghp_test',
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('plan_pr_merge_failed');
    expect(result.error.message).toContain('not found');
  }
});

it('returns error for unparseable PR URL', async () => {
  const deps = createFakeDeps();

  const result = await mergePlanPr(deps, {
    planningPrUrl: 'https://example.com/not-a-pr',
    repository: 'pbuchman/intexuraos',
    token: 'ghp_test',
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('plan_pr_merge_failed');
    expect(result.error.message).toContain('Could not parse PR number');
  }
});
```

- [ ] **Step 6: Run all tests and verify**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/utils/mergePlanPr.ts apps/code-agent/src/__tests__/domain/utils/mergePlanPr.test.ts
git commit -m "feat(code-agent): add mergePlanPr utility for GitHub API plan PR merge"
```

---

### Task 1.2: Integrate Plan PR Merge into `submitToExecutionAgent`

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts` (lines 74-82, 102-404)
- Modify: `apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`

Add a new dependency (`gitHubPRClient` + `userServiceClient`) to `SubmitToExecutionAgentDeps`, add a plan PR merge step between validation (Step 8) and optimistic lock (Step 9), and remove `planningPrBranch`/`planningPrUrl` from the execution task creation input.

- [ ] **Step 1: Write the failing test for plan PR merge in submit flow**

Add a new test in the existing `submitToExecutionAgent.test.ts`:

```typescript
it('merges plan PR before creating execution task when planning_pr_url exists', async () => {
  // Setup: planning task with a plan PR result
  const planningTask = createPlannedTask({
    result: {
      branch: 'plan/int-1134-test',
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1509',
      summary: 'Plan created',
    },
  });
  fakeCodeTaskRepo.setTask(planningTask);

  // Mock GitHub token resolution
  fakeUserServiceClient.setGitHubToken('ghp_test_token');
  // Mock merge success
  fakeGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'abc', merged: true }));
  fakeGitHubPRClient.getPullRequestStatus.mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/int-1134-test' }));

  const result = await submitToExecutionAgent(deps, {
    originalTaskId: planningTask.id,
    userId: planningTask.userId,
  });

  expect(result.ok).toBe(true);
  expect(fakeGitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
    'ghp_test_token', 'pbuchman', 'intexuraos', 1509, 'merge', expect.any(String),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts -t "merges plan PR"`
Expected: FAIL — deps missing gitHubPRClient

- [ ] **Step 3: Add dependencies to `SubmitToExecutionAgentDeps`**

In `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`, add to the deps interface:

```typescript
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { mergePlanPr } from '../utils/mergePlanPr.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';

export interface SubmitToExecutionAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskEnqueueService: TaskEnqueueService;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  gitHubPRClient: GitHubPRClient;      // NEW
  userServiceClient: UserServiceClient; // NEW
}
```

Add `'plan_pr_merge_failed'` to `SubmitToExecutionAgentErrorCode`:

```typescript
export type SubmitToExecutionAgentErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'no_linear_issue'
  | 'already_implemented'
  | 'active_task_exists'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'queue_full'
  | 'plan_pr_merge_failed'   // NEW
  | 'internal_error';
```

- [ ] **Step 4: Add plan PR merge step between Steps 8 and 9**

Insert after the label validation (Step 8, around line 234) and before the optimistic lock (Step 9):

```typescript
  // Step 8b: Merge plan PR if planning task produced one
  const planningPrUrl = originalTask.result?.planning_pr_url;
  if (planningPrUrl !== undefined) {
    // Resolve GitHub token for the user
    const gitHubToken = await fetchGitHubToken(userServiceClient, userId, logger);
    if (gitHubToken === null) {
      logger.warn({ userId }, 'Cannot merge plan PR: GitHub OAuth token unavailable');
      return err({
        code: 'plan_pr_merge_failed',
        message: 'GitHub OAuth token is required to merge the plan PR. Please reconnect your GitHub account.',
      });
    }

    const mergeResult = await mergePlanPr(
      { logger, gitHubPRClient },
      { planningPrUrl, repository: originalTask.repository, token: gitHubToken },
    );

    if (!mergeResult.ok) {
      logger.warn(
        { planningPrUrl, error: mergeResult.error },
        'Plan PR merge failed — cannot proceed with implementation',
      );
      return err({
        code: 'plan_pr_merge_failed',
        message: mergeResult.error.message,
      });
    }

    logger.info({ planningPrUrl }, 'Plan PR merged into development — proceeding with execution task creation');
  }
```

- [ ] **Step 5: Remove `planningPrBranch`/`planningPrUrl` from execution task creation**

In the `createInput` object (around line 262-280), remove these two lines:

```typescript
// REMOVE these lines:
// ...(originalTask.result?.branch !== undefined && { planningPrBranch: originalTask.result.branch }),
// ...(originalTask.result?.planning_pr_url !== undefined && { planningPrUrl: originalTask.result.planning_pr_url }),
```

The execution task no longer needs these fields because the plan is already on `development`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`
Expected: PASS

- [ ] **Step 7: Write test for merge failure blocking execution**

```typescript
it('returns plan_pr_merge_failed error when plan PR merge fails', async () => {
  const planningTask = createPlannedTask({
    result: {
      branch: 'plan/int-1134-test',
      planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1509',
      summary: 'Plan created',
    },
  });
  fakeCodeTaskRepo.setTask(planningTask);
  fakeUserServiceClient.setGitHubToken('ghp_test_token');
  fakeGitHubPRClient.getPullRequestStatus.mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/test' }));
  fakeGitHubPRClient.mergePullRequest.mockResolvedValue(err({
    code: 'API_ERROR' as const,
    message: '405 Method Not Allowed - merge conflict',
  }));

  const result = await submitToExecutionAgent(deps, {
    originalTaskId: planningTask.id,
    userId: planningTask.userId,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('plan_pr_merge_failed');
  }
  // Verify no execution task was created
  expect(fakeCodeTaskRepo.getCreatedTasks()).toHaveLength(0);
});
```

- [ ] **Step 8: Write test for no plan PR (proceeds normally)**

```typescript
it('skips plan PR merge when planning task has no planning_pr_url', async () => {
  const planningTask = createPlannedTask({
    result: {
      summary: 'Simple plan — no PR',
    },
  });
  fakeCodeTaskRepo.setTask(planningTask);

  const result = await submitToExecutionAgent(deps, {
    originalTaskId: planningTask.id,
    userId: planningTask.userId,
  });

  expect(result.ok).toBe(true);
  expect(fakeGitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run all tests**

Run: `cd /repo && pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts`
Expected: All PASS

- [ ] **Step 10: Update all call sites of `submitToExecutionAgent`**

Search all callers of `submitToExecutionAgent()` in the codebase and ensure they pass the new `gitHubPRClient` and `userServiceClient` deps. The callers include:
- `apps/code-agent/src/routes/codeRoutes.ts` (the `/code/tasks/:taskId/implement` route handler)
- `apps/code-agent/src/routes/codeRoutes.ts` (the `/internal/code/submit-phase2` internal route)

Update both to include the new deps from `getServices()`.

- [ ] **Step 11: Update the route handler to map the new error code**

In `apps/code-agent/src/routes/codeRoutes.ts`, in the implement route error handling, add a case for `plan_pr_merge_failed`:

```typescript
case 'plan_pr_merge_failed':
  return await reply.fail('PLAN_PR_MERGE_FAILED', error.message);
```

- [ ] **Step 12: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts \
       apps/code-agent/src/__tests__/domain/usecases/submitToExecutionAgent.test.ts \
       apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat(code-agent): merge plan PR before execution task dispatch"
```

---

### Task 1.3: Remove `planningPrBranch`/`planningPrUrl` from Dispatch Pipeline

**Files:**
- Modify: `apps/code-agent/src/domain/services/taskDispatcher.ts`
- Modify: `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- Modify: `apps/code-agent/src/domain/usecases/drainTaskQueue.ts` (lines 347-348)
- Modify: `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`
- Modify: `apps/code-agent/src/__tests__/infra/services/taskDispatcher.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts`

These fields are no longer needed in the dispatch payload because the plan is already merged into `development` before the execution task is created.

- [ ] **Step 1: Remove `planningPrBranch`/`planningPrUrl` from `DispatchRequest` interface**

In `apps/code-agent/src/domain/services/taskDispatcher.ts`, remove `planningPrBranch` and `planningPrUrl` from the `DispatchRequest` interface.

- [ ] **Step 2: Remove from `taskDispatcherImpl.ts`**

In `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`, remove the conditional spreading of `planningPrBranch` and `planningPrUrl` in the request body builder (around lines 146-150).

- [ ] **Step 3: Remove from `drainTaskQueue.ts`**

In `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`, remove lines 347-348:
```typescript
// REMOVE:
// ...(task.planningPrBranch !== undefined && { planningPrBranch: task.planningPrBranch }),
// ...(task.planningPrUrl !== undefined && { planningPrUrl: task.planningPrUrl }),
```

- [ ] **Step 4: Remove from `drainRetryQueue.ts`**

Check `apps/code-agent/src/domain/usecases/drainRetryQueue.ts` for the same fields and remove them.

- [ ] **Step 5: Update tests**

Remove any test assertions that verify `planningPrBranch`/`planningPrUrl` are included in dispatch payloads.

- [ ] **Step 6: Run verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/domain/services/taskDispatcher.ts \
       apps/code-agent/src/infra/services/taskDispatcherImpl.ts \
       apps/code-agent/src/domain/usecases/drainTaskQueue.ts \
       apps/code-agent/src/domain/usecases/drainRetryQueue.ts \
       apps/code-agent/src/__tests__/infra/services/taskDispatcher.test.ts \
       apps/code-agent/src/__tests__/domain/usecases/drainTaskQueue.test.ts
git commit -m "refactor(code-agent): remove planningPrBranch/Url from dispatch pipeline"
```

---

### Task 1.4: Full CI Verification

- [ ] **Step 1: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS with 100% coverage

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS

- [ ] **Step 3: Commit any remaining fixes**

---

## Subtask 2: Orchestrator — Remove Plan Merge and Plan PR Closure Logic

### Task 2.1: Remove `mergePlanningBranch` from WorktreeManager

**Files:**
- Modify: `workers/orchestrator/src/services/worktree-manager.ts` (lines 210-228)
- Modify: `workers/orchestrator/src/__tests__/worktree-manager.test.ts`

- [ ] **Step 1: Remove `mergePlanningBranch` method**

In `workers/orchestrator/src/services/worktree-manager.ts`, delete the `mergePlanningBranch` method (lines 210-228):

```typescript
// DELETE this entire method:
// async mergePlanningBranch(
//   worktreePath: string,
//   planningBranch: string
// ): Promise<Result<void, string>> { ... }
```

- [ ] **Step 2: Remove tests for `mergePlanningBranch`**

In the worktree-manager test file, remove all tests related to `mergePlanningBranch`.

- [ ] **Step 3: Run tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/worktree-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add workers/orchestrator/src/services/worktree-manager.ts \
       workers/orchestrator/src/__tests__/worktree-manager.test.ts
git commit -m "refactor(orchestrator): remove mergePlanningBranch from worktree manager"
```

---

### Task 2.2: Remove Planning Branch Merge and Plan PR Closure from TaskDispatcher

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (lines 326-342, 1411-1452)
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

- [ ] **Step 1: Remove planning branch merge call in `executeTaskSetup`**

In `workers/orchestrator/src/services/task-dispatcher.ts`, remove lines 326-342:

```typescript
// DELETE this block:
// if (request.agentType === 'execution' && request.planningPrBranch !== undefined) {
//   const mergeResult = await this.worktreeManager.mergePlanningBranch(
//     worktreePath,
//     request.planningPrBranch
//   );
//   if (!mergeResult.ok) {
//     this.logger.warn(
//       { taskId, branch: request.planningPrBranch, error: mergeResult.error },
//       'Failed to merge planning branch — proceeding without plan files'
//     );
//   }
// } else if (request.agentType === 'execution') {
//   this.logger.info(
//     { taskId },
//     'No planning branch to merge — dispatched without planningPrBranch'
//   );
// }
```

- [ ] **Step 2: Remove `closePlanningPr` method and its call**

Remove the call at line 1411-1413:
```typescript
// DELETE:
// if (agentType === 'execution' && task.planningPrUrl !== undefined) {
//   await this.closePlanningPr(task.planningPrUrl, task.taskId);
// }
```

Remove the entire `closePlanningPr` method (lines 1416-1452).

- [ ] **Step 3: Remove `planningPrBranch`/`planningPrUrl` from Task object creation**

In `executeTaskSetup`, the Task object creation (around line 344-388) spreads these fields from the request. Remove:

```typescript
// DELETE from Task object creation:
// ...(request.planningPrBranch !== undefined && { planningPrBranch: request.planningPrBranch }),
// ...(request.planningPrUrl !== undefined && { planningPrUrl: request.planningPrUrl }),
```

- [ ] **Step 4: Remove related tests**

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`:
- Remove tests for planning branch merge success/failure/skip
- Remove tests for `closePlanningPr`
- Remove any test fixtures that set `planningPrBranch`/`planningPrUrl`

- [ ] **Step 5: Run tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts \
       workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "refactor(orchestrator): remove plan branch merge and plan PR closure"
```

---

### Task 2.3: Remove `planningPrBranch`/`planningPrUrl` from Types and Schema

**Files:**
- Modify: `workers/orchestrator/src/types/schemas.ts` (lines 46-47)
- Modify: `workers/orchestrator/src/types/api.ts` (lines 36-38)
- Modify: `workers/orchestrator/src/types/task.ts` (lines 62-64)
- Modify: `workers/orchestrator/src/routes.ts` (lines 166-167)

- [ ] **Step 1: Remove from Zod schema**

In `workers/orchestrator/src/types/schemas.ts`, remove lines 46-47:

```typescript
// DELETE:
// planningPrBranch: z.string().optional(),
// planningPrUrl: z.string().url().optional(),
```

Note: Zod's `z.object()` uses `.strip()` mode by default, which silently strips unknown properties. This means old code-agents still sending these fields will have them stripped without error — backward compatible.

- [ ] **Step 2: Remove from `CreateTaskRequest` interface**

In `workers/orchestrator/src/types/api.ts`, remove lines 36-38:

```typescript
// DELETE:
// /** Branch name of planning PR to merge into execution worktree. */
// planningPrBranch?: string;
// /** PR URL to close after successful execution. */
// planningPrUrl?: string;
```

- [ ] **Step 3: Remove from `Task` interface**

In `workers/orchestrator/src/types/task.ts`, remove lines 62-64:

```typescript
// DELETE:
// /** Branch name of planning PR to merge into execution worktree. */
// planningPrBranch?: string;
// /** PR URL to close after successful execution. */
// planningPrUrl?: string;
```

- [ ] **Step 4: Remove from route handler**

In `workers/orchestrator/src/routes.ts`, remove lines 166-167:

```typescript
// DELETE:
// ...(parsed.planningPrBranch !== undefined && { planningPrBranch: parsed.planningPrBranch }),
// ...(parsed.planningPrUrl !== undefined && { planningPrUrl: parsed.planningPrUrl }),
```

- [ ] **Step 5: Fix any TypeScript compilation errors**

Run: `cd /repo && pnpm -F orchestrator build`
Fix any references to removed fields.

- [ ] **Step 6: Run tests**

Run: `cd /repo && pnpm vitest run workers/orchestrator/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add workers/orchestrator/src/types/schemas.ts \
       workers/orchestrator/src/types/api.ts \
       workers/orchestrator/src/types/task.ts \
       workers/orchestrator/src/routes.ts
git commit -m "refactor(orchestrator): remove planningPrBranch/Url from types and schema"
```

---

### Task 2.4: Full CI Verification

- [ ] **Step 1: Run workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`
Expected: PASS with coverage met

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: PASS

- [ ] **Step 3: Commit any remaining fixes**

---

## Endpoint Changes

**Modified:** `POST /code/tasks/:taskId/implement` (code-agent) — Now merges plan PR via GitHub API before creating execution task. New error code `plan_pr_merge_failed` returned when merge fails.

**Modified:** `POST /tasks` (orchestrator) — No longer accepts `planningPrBranch`/`planningPrUrl` fields (stripped by Zod).

**Removed behavior:** Orchestrator no longer merges planning branch into worktree during task setup. Orchestrator no longer closes planning PR after execution completes.

**Unchanged:** `POST /code/tasks/:taskId/implement` HTTP contract (same request/response shape). All other orchestrator endpoints unchanged.

---

## Summary of What Gets Removed

| What                                           | Where                                        | Why                                           |
| ---------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `mergePlanningBranch()` method                 | `worktree-manager.ts`                        | Plan is merged via GitHub API before dispatch |
| `closePlanningPr()` method                     | `task-dispatcher.ts`                         | Plan PR is already merged, not closed         |
| Plan branch merge call                         | `task-dispatcher.ts:326-342`                 | Plan is on development already                |
| Plan PR closure call                           | `task-dispatcher.ts:1411-1413`               | Plan PR is already merged                     |
| `planningPrBranch`/`planningPrUrl` in types    | `api.ts`, `task.ts`, `schemas.ts`            | No longer needed in dispatch pipeline         |
| `planningPrBranch`/`planningPrUrl` in dispatch | `taskDispatcherImpl.ts`, `drainTaskQueue.ts` | No longer sent to orchestrator                |

## Summary of What Gets Added

| What                                        | Where                        | Why                                               |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| `mergePlanPr()` utility                     | `mergePlanPr.ts` (new file)  | Merges plan PR via GitHub API with error handling |
| Plan PR merge step                          | `submitToExecutionAgent.ts`  | Enforces merge before execution task creation     |
| `plan_pr_merge_failed` error code           | `submitToExecutionAgent.ts`  | Clear error when merge fails                      |
| `gitHubPRClient` + `userServiceClient` deps | `SubmitToExecutionAgentDeps` | Required for GitHub API access                    |
