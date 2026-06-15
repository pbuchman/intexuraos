# PR Merge Conflict Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route automatically queued PR merge-conflict resolution tasks through the user's pull-request worker model instead of hardcoding `workerType: 'auto'`.

**Architecture:** The bug is in the code-agent merge-conflict workflow, not in the orchestrator prompt routing. Merge-conflict tasks already persist `agentType: 'pull_request'` and `systemPromptHash: 'pr-merge-conflict-auto'`; the missing piece is resolving the task's `workerType` from `WorkerSettings.defaultPullRequestWorkerType`, matching normal PR-comment task creation.

**Tech Stack:** TypeScript, Vitest, code-agent domain use cases, `@intexuraos/code-task-domain` worker types.

---

## Current Finding

`createTaskForPR()` already resolves PR tasks with this precedence:

1. request worker type
2. `workerSettings.defaultPullRequestWorkerType`
3. `'auto'`

Merge-conflict task creation does not use that path. `apps/code-agent/src/domain/usecases/mergeConflicts/resolveConflicts.ts` builds merge-conflict tasks with `agentType: 'pull_request'`, `followUpReason: 'merge_conflict'`, and a hardcoded `workerType: 'auto'`. That matches the reported failure: the task is a pull-request task, but it is queued to the generic auto worker instead of the configured pull-request model.

## File Structure

| Change | File | Responsibility |
| --- | --- | --- |
| Modify | `apps/code-agent/src/domain/usecases/mergeConflicts/resolveConflicts.ts` | Resolve merge-conflict task worker type from user pull-request defaults and pass it into task creation. |
| Modify | `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts` | Add regression coverage proving merge-conflict tasks use `defaultPullRequestWorkerType`, and preserve fallback behavior when unset. |

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged: all existing code-agent HTTP routes and webhook schemas. This is a domain workflow fix for internally queued merge-conflict tasks.

## Key Decisions

- Keep the existing merge-conflict branch and keep `agentType: 'pull_request'`; do not move these tasks through execution/remediation routing.
- Replace only the hardcoded worker type with explicit pull-request worker-type resolution.
- Preserve the no-enabled-worker guard before creating any task.
- Fall back to `'auto'` only when the user has enabled workers but has not configured `defaultPullRequestWorkerType`.

## Task 1: Add the Failing Routing Regression

**Files:**
- Modify: `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts`

- [ ] **Step 1: Add a merge-conflict default worker-type test**

Add this test inside `describe('executeConflictWorkflow — auto-resolvable and manual-intervention paths', () => { ... })` after the existing "creates a task when a conflict workflow is required and worker is enabled" test:

```typescript
  it('routes merge-conflict tasks through the default pull-request worker type', async () => {
    const deps = createResolveDeps();
    deps.workerSettingsRepo.getSettings = vi.fn().mockResolvedValue(ok({
      userId: 'user-1',
      workers: [{
        name: 'home-mac',
        url: 'https://w',
        cfAccessClientId: 'c',
        cfAccessClientSecret: 's',
        dispatchSigningSecret: 'd',
        enabled: true,
      }],
      defaultPullRequestWorkerType: 'codex-xhigh',
      createdAt: '2026-03-11T09:00:00Z',
      updatedAt: '2026-03-11T09:00:00Z',
    }));
    const params = createParams({ deps });

    await executeConflictWorkflow(params);

    expect(deps.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'pull_request',
      followUpReason: 'merge_conflict',
      systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH,
      workerType: 'codex-xhigh',
    }));
  });
```

- [ ] **Step 2: Add a fallback behavior test**

Add this test in the same `describe` block:

```typescript
  it('falls back to auto for merge-conflict tasks when no pull-request default is configured', async () => {
    const params = createParams();

    await executeConflictWorkflow(params);

    expect(params.deps.codeTaskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'pull_request',
      followUpReason: 'merge_conflict',
      workerType: 'auto',
    }));
  });
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts
```

Expected before implementation: the new `codex-xhigh` test fails because `workerType` is still `'auto'`.

## Task 2: Resolve Merge-Conflict Worker Type from Pull-Request Defaults

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/mergeConflicts/resolveConflicts.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts`

- [ ] **Step 1: Import the worker type**

Change the existing import at the top of `resolveConflicts.ts` from:

```typescript
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask } from '../../models/codeTask.js';
```

to:

```typescript
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH, type CodeTask, type WorkerType } from '../../models/codeTask.js';
```

- [ ] **Step 2: Replace the enabled-worker helper with worker-type resolution**

Replace `resolveEnabledWorker()` with:

```typescript
async function resolveMergeConflictWorkerType(
  workerSettingsRepo: WorkerSettingsRepository,
  userId: string,
  logger: Logger
): Promise<Result<WorkerType, { code: 'NO_ENABLED_WORKER' | 'INTERNAL_ERROR'; message: string }>> {
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.warn({ error: settingsResult.error, userId }, 'Failed to load worker settings for conflict detection');
    return err({ code: 'INTERNAL_ERROR', message: settingsResult.error.message });
  }

  const hasEnabledWorker = settingsResult.value?.workers.some((candidate) => candidate.enabled) === true;
  if (!hasEnabledWorker) {
    return err({ code: 'NO_ENABLED_WORKER', message: `No enabled worker for user ${userId}` });
  }

  return ok(settingsResult.value?.defaultPullRequestWorkerType ?? 'auto');
}
```

Also remove the now-unused `WorkerConfig` import from `resolveConflicts.ts`:

```typescript
import type { WorkerConfig } from '../../models/workerSettings.js';
```

- [ ] **Step 3: Thread the resolved worker type into merge-conflict task creation**

Add `workerType` to `CreateTaskParams`:

```typescript
interface CreateTaskParams {
  logger: Logger;
  repository: string;
  eventId: string;
  details: GitHubPullRequestDetails;
  commentId: number;
  existingTask: CodeTask | null;
  ownerUserId: string;
  workerType: WorkerType;
}
```

Add `workerType` to `buildCreateTaskInput()` params:

```typescript
function buildCreateTaskInput(params: {
  taskId: string;
  repository: string;
  prNumber: number;
  baseBranch: string;
  prompt: string;
  eventId: string;
  userId: string;
  webhookSecret: string;
  workerType: WorkerType;
  linearIssueId?: string | undefined;
  parentTaskId?: string | undefined;
}): CreateTaskInput {
```

Change the task input from:

```typescript
    workerType: 'auto',
```

to:

```typescript
    workerType: params.workerType,
```

Pass the parameter when calling `buildCreateTaskInput()`:

```typescript
    workerType: params.workerType,
```

- [ ] **Step 4: Use the new helper in the workflow**

In `createConflictTaskWorkflow()`, replace:

```typescript
  const workerResult = await resolveEnabledWorker(
    params.deps.workerSettingsRepo,
    params.accessContext.userId,
    params.logger
  );

  if (!workerResult.ok) {
    const phase = workerResult.error.code === 'NO_ENABLED_WORKER' ? 'no-worker' : 'failed';
```

with:

```typescript
  const workerTypeResult = await resolveMergeConflictWorkerType(
    params.deps.workerSettingsRepo,
    params.accessContext.userId,
    params.logger
  );

  if (!workerTypeResult.ok) {
    const phase = workerTypeResult.error.code === 'NO_ENABLED_WORKER' ? 'no-worker' : 'failed';
```

When calling `createMergeConflictTask()`, add:

```typescript
      workerType: workerTypeResult.value,
```

so the call becomes:

```typescript
      ownerUserId: params.accessContext.userId,
      workerType: workerTypeResult.value,
```

- [ ] **Step 5: Update direct `createMergeConflictTask()` tests**

Every direct call to `createMergeConflictTask()` in `resolveConflicts.test.ts` must pass:

```typescript
        workerType: 'auto',
```

Add it alongside `ownerUserId: 'user-1'` in the existing direct-call test objects.

- [ ] **Step 6: Run the focused test**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts
```

Expected after implementation: PASS.

## Task 3: Verify Broader Code-Agent Routing Contracts

**Files:**
- Modify: no additional files expected

- [ ] **Step 1: Run related routing tests**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/domain/usecases/mergeConflicts/resolveConflicts.test.ts src/__tests__/domain/utils/prTaskLock.test.ts src/__tests__/domain/usecases/drainTaskQueue.test.ts
```

Expected: PASS. This verifies merge-conflict identification, pull-request agent routing during queue drain, and the new worker type selection.

- [ ] **Step 2: Run the tracked workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS.

- [ ] **Step 3: Run full tracked CI before commit**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

## Self-Review Checklist

- [ ] Merge-conflict tasks still set `agentType: 'pull_request'`.
- [ ] Merge-conflict tasks still set `followUpReason: 'merge_conflict'`.
- [ ] Merge-conflict tasks still set `systemPromptHash: MERGE_CONFLICT_SYSTEM_PROMPT_HASH`.
- [ ] Only `workerType` changes from hardcoded `'auto'` to resolved `defaultPullRequestWorkerType ?? 'auto'`.
- [ ] The no-enabled-worker path still updates the managed PR comment and does not create a task.
- [ ] No route schema, migration, Firestore collection ownership, or web changes are required.
