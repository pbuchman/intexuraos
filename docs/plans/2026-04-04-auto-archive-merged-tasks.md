# Auto-Archive Merged Code Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-archive code tasks whose PRs were merged >7 days ago via a scheduled background job.

**Architecture:** Add a `prMergedAt` timestamp to the `CodeTask` model, populated when the PR-close webhook fires with `isMerged: true`. A new scheduled use case queries tasks by `prMergedAt < cutoff`, groups by `linearIssueId`, and archives entire groups (skipping active ones).

**Tech Stack:** TypeScript, Fastify, Firestore, Terraform (Cloud Scheduler)

---

## File Structure

### code-agent (new/modified files)

| File                                                                                 | Action   | Responsibility                                                                          |
| ------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------- |
| `apps/code-agent/src/domain/models/codeTask.ts`                                      | Modify   | Add `prMergedAt?: Timestamp` field to `CodeTask` interface                              |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`                      | Modify   | Add `findAllNonArchived()` method to interface                                          |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`              | Modify   | Implement `findAllNonArchived()` + handle `prMergedAt` in update                        |
| `apps/code-agent/src/domain/usecases/autoArchiveMergedTasks.ts`                      | Create   | New use case: query merged tasks > N days, group by issue, archive                      |
| `apps/code-agent/src/domain/usecases/handlePrClose.ts`                               | Modify   | Set `prMergedAt` on tasks when `isMerged: true`                                         |
| `apps/code-agent/src/routes/internalRoutes.ts`                                       | Modify   | Add `POST /internal/auto-archive-merged-tasks` endpoint                                 |
| `apps/code-agent/src/services.ts`                                                    | Modify   | Add `autoArchiveMergedTasks` to `ServiceContainer`                                      |
| `apps/code-agent/src/infra/migrations/prMergedAtStatusIndex.ts` (optional)           | Create   | Firestore composite index on `(prMergedAt, status)` — if using composite query approach |
| `terraform/environments/dev/main.tf`                                                 | Modify   | New Cloud Scheduler job for auto-archive                                                |
| `apps/code-agent/src/__tests__/usecases/autoArchiveMergedTasks.test.ts`              | Create   | Unit tests for use case                                                                 |
| `apps/code-agent/src/__tests__/routes/internalRoutes.autoArchiveMergedTasks.test.ts` | Create   | Route tests                                                                             |
| `apps/code-agent/src/__tests__/usecases/handlePrClose.test.ts`                       | Modify   | Add tests for `prMergedAt` population                                                   |

---

## code-agent — Auto-Archive Background Job

### Task 1: Add `prMergedAt` field to CodeTask model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts:162-248`
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts:54-83`

- [ ] **Step 1: Add `prMergedAt` to CodeTask interface**

In `apps/code-agent/src/domain/models/codeTask.ts`, add the field after `prBranch` (line ~193):

```typescript
  // PR Correlation (for linking tasks to PRs - INT-465)
  prNumber?: number;           // GitHub PR number (populated on completion)
  prBranch?: string;           // Branch name (queryable, redundant with result.branch)
  prMergedAt?: Timestamp;      // When the PR was merged (set by handlePrClose webhook, INT-1174)
```

- [ ] **Step 2: Add `prMergedAt` to UpdateTaskInput**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add to `UpdateTaskInput`:

```typescript
  // PR correlation (INT-465): populated on task completion from result.prUrl
  prNumber?: number;
  prBranch?: string;
  prMergedAt?: Date;  // When PR was merged (INT-1174)
```

- [ ] **Step 3: Handle `prMergedAt` in Firestore repository update**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, in the `update` method, add handling for the new field alongside existing `prNumber`/`prBranch` handling:

```typescript
if (input.prMergedAt !== undefined) {
  updateData['prMergedAt'] = Timestamp.fromDate(input.prMergedAt);
}
```

- [ ] **Step 4: Handle `prMergedAt` in `toCodeTask` mapper**

In the same repository file, in the `toCodeTask` function that maps Firestore documents to domain objects, add:

```typescript
prMergedAt: data['prMergedAt'] instanceof Timestamp
  ? data['prMergedAt']
  : undefined,
```

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add prMergedAt field to CodeTask model (INT-1174)"
```

### Task 2: Set `prMergedAt` in handlePrClose webhook handler

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/handlePrClose.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/handlePrClose.test.ts`

- [ ] **Step 1: Write failing test for prMergedAt population**

Add a test in `apps/code-agent/src/__tests__/domain/useCases/handlePrClose.test.ts`:

```typescript
it('sets prMergedAt on tasks found via findByPR when PR is merged', async () => {
  const task = createFakeTask({ id: 'task-1', linearIssueId: 'INT-100', prNumber: 42 });
  fakeRepo.findByPR.resolves(ok(task));
  fakeRepo.findLatestExecutionTaskByPR.resolves(ok(null));
  fakeRepo.update.resolves(ok(task));

  await handlePrClose(deps, {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    prBody: 'Fixes INT-100',
    prTitle: '[INT-100] Add feature',
    prAuthorLogin: 'piotr',
    senderLogin: 'piotr',
    isMerged: true,
    sourceTimestamp: '2026-04-01T12:00:00.000Z',
  });

  expect(fakeRepo.update.calledWith('task-1', sinon.match({
    prMergedAt: new Date('2026-04-01T12:00:00.000Z'),
  }))).to.be.true;
});

it('does NOT set prMergedAt when PR is closed without merge', async () => {
  const task = createFakeTask({ id: 'task-2', linearIssueId: 'INT-200', prNumber: 43 });
  fakeRepo.findByPR.resolves(ok(task));
  fakeRepo.findLatestExecutionTaskByPR.resolves(ok(null));

  await handlePrClose(deps, {
    repository: 'pbuchman/intexuraos',
    prNumber: 43,
    prBody: 'Fixes INT-200',
    prTitle: '[INT-200] Add feature',
    prAuthorLogin: 'piotr',
    senderLogin: 'piotr',
    isMerged: false,
    sourceTimestamp: '2026-04-01T12:00:00.000Z',
  });

  expect(fakeRepo.update.called).to.be.false;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm test -- --grep "prMergedAt"`
Expected: FAIL — `prMergedAt` update not called yet

- [ ] **Step 3: Implement prMergedAt population in handlePrClose**

In `apps/code-agent/src/domain/usecases/handlePrClose.ts`, after the discovery methods (line ~87), add a block that sets `prMergedAt` on discovered tasks when `isMerged`:

```typescript
  // --- Set prMergedAt on discovered tasks (INT-1174) ---
  if (isMerged) {
    const mergedAt = new Date(sourceTimestamp);
    const taskIdsToMark = new Set<string>();

    if (findByPRResult.ok && findByPRResult.value !== null) {
      taskIdsToMark.add(findByPRResult.value.id);
    }
    if (findLatestResult.ok && findLatestResult.value !== null) {
      taskIdsToMark.add(findLatestResult.value.id);
    }

    for (const taskId of taskIdsToMark) {
      void codeTaskRepo.update(taskId, { prMergedAt: mergedAt }).catch((updateErr: unknown) => {
        logger.warn({ taskId, prNumber, error: updateErr },
          'handlePrClose: failed to set prMergedAt (best-effort)');
      });
    }
  }
```

Place this BEFORE the `--- Transition / Label Cleanup ---` section (line 129).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm test -- --grep "prMergedAt"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/handlePrClose.ts apps/code-agent/src/__tests__/domain/useCases/handlePrClose.test.ts
git commit -m "feat(code-agent): set prMergedAt on tasks when PR is merged (INT-1174)"
```

### Task 3: Add `findAllNonArchived` repository method

> **Architecture note:** This method returns ALL non-archived tasks (including active ones with no `prMergedAt`). The `prMergedAt < cutoffDate` filtering happens in-memory in the use case. This ensures the `hasActive` safety check correctly sees all sibling tasks for a given `linearIssueId`, matching the `archiveStaleGroups` pattern.

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`

- [ ] **Step 1: Add method to repository interface**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add after `listAllNonArchivedGlobal()`:

```typescript
  /**
   * Find all non-archived tasks.
   * Returns ALL non-archived tasks (including active ones with no prMergedAt)
   * so that the caller can properly check for active siblings before archiving.
   * The prMergedAt < cutoffDate filtering happens in-memory in the use case.
   * Used by auto-archive-merged-tasks scheduler (INT-1174).
   */
  findAllNonArchived(): Promise<Result<CodeTask[], RepositoryError>>;
```

- [ ] **Step 2: Implement in Firestore repository**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, add near `listAllNonArchivedGlobal`:

```typescript
findAllNonArchived: async (): Promise<Result<CodeTask[], RepositoryError>> => {
  try {
    // Return ALL non-archived tasks (including active ones with no prMergedAt).
    // The hasActive safety check requires seeing all tasks for a given issue,
    // so this method intentionally does NOT filter by prMergedAt.
    // The prMergedAt < cutoffDate filtering happens in-memory in the use case.
    const snapshot = await collection
      .where('status', '!=', 'archived')
      .get();

    const tasks = snapshot.docs.map((doc: QueryDocumentSnapshot) =>
      toCodeTask(doc as { id: string; data(): Record<string, unknown> })
    );

    return ok(tasks);
  } catch (error) {
    logger.error({ error }, 'Failed to find all non-archived tasks');
    return err({
      code: 'FIRESTORE_ERROR',
      message: `Firestore error: ${getErrorMessage(error)}`,
    });
  }
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add findAllNonArchived repository method (INT-1174)"
```

### Task 4: Create `autoArchiveMergedTasks` use case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/autoArchiveMergedTasks.ts`
- Create: `apps/code-agent/src/__tests__/usecases/autoArchiveMergedTasks.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/code-agent/src/__tests__/usecases/autoArchiveMergedTasks.test.ts`. Follow the pattern from `archiveStaleGroups.test.ts`. Key test cases:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createAutoArchiveMergedTasksUseCase } from '../../domain/usecases/autoArchiveMergedTasks.js';
import { Timestamp } from '@google-cloud/firestore';
import pino from 'pino';

// Fixed "now" for deterministic tests
const NOW = new Date('2026-04-04T12:00:00.000Z');

function makeTask(overrides: Partial<{ id: string; status: string; linearIssueId: string | undefined; prMergedAt: Timestamp }>) {
  return {
    id: overrides.id ?? 'task-1',
    status: overrides.status ?? 'implemented',
    linearIssueId: overrides.linearIssueId,
    updatedAt: Timestamp.fromDate(new Date('2026-03-20T12:00:00.000Z')),
    prMergedAt: overrides.prMergedAt,
  };
}

describe('autoArchiveMergedTasks', () => {
  // Test: archives tasks with merged PR older than 7 days
  // Test: does NOT archive tasks with merged PR within 7 days (should not appear in query results)
  // Test: groups by linearIssueId and archives entire group
  // Test: skips groups with active tasks (running/dispatched/queued)
  // Test: handles repository errors gracefully
  // Test: returns correct statistics
  // Test: respects custom mergeDays parameter
  // Test: handles empty result set
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && pnpm test -- --grep "autoArchiveMergedTasks"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the use case**

Create `apps/code-agent/src/domain/usecases/autoArchiveMergedTasks.ts`:

```typescript
import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';
import { ACTIVE_STATUSES } from '../issueGrouping/constants.js';

const DEFAULT_MERGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AutoArchiveMergedTasksDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface AutoArchiveMergedTasksInput {
  mergeDays?: number;
}

export interface AutoArchiveMergedTasksResult {
  totalTasksFetched: number;
  totalGroupsEvaluated: number;
  groupsArchived: number;
  groupsSkippedActive: number;
  tasksArchived: number;
  tasksFailed: number;
  durationMs: number;
}

export type AutoArchiveMergedTasksUseCase = (
  input?: AutoArchiveMergedTasksInput
) => Promise<Result<AutoArchiveMergedTasksResult>>;

export function createAutoArchiveMergedTasksUseCase(
  deps: AutoArchiveMergedTasksDeps
): AutoArchiveMergedTasksUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (input?: AutoArchiveMergedTasksInput): Promise<Result<AutoArchiveMergedTasksResult>> => {
    const startTime = Date.now();
    const mergeDays = input?.mergeDays ?? DEFAULT_MERGE_DAYS;
    const cutoffDate = new Date(Date.now() - mergeDays * MS_PER_DAY);

    logger.info({ mergeDays, cutoffDate }, 'Starting auto-archive of merged tasks');

    // Fetch ALL non-archived tasks (including active ones with no prMergedAt).
    // This ensures the hasActive safety check correctly sees all sibling tasks.
    const findResult = await codeTaskRepository.findAllNonArchived();
    if (!findResult.ok) {
      logger.error({ error: findResult.error.message }, 'Failed to find non-archived tasks');
      return err(new Error(findResult.error.message));
    }

    const allTasks = findResult.value;
    const totalTasksFetched = allTasks.length;

    if (totalTasksFetched === 0) {
      const durationMs = Date.now() - startTime;
      logger.info({ durationMs }, 'No non-archived tasks found');
      return ok({
        totalTasksFetched: 0,
        totalGroupsEvaluated: 0,
        groupsArchived: 0,
        groupsSkippedActive: 0,
        tasksArchived: 0,
        tasksFailed: 0,
        durationMs,
      });
    }

    // Group all tasks by linearIssueId first (including active ones)
    const groups = new Map<string, typeof allTasks>();
    for (const task of allTasks) {
      const groupKey = task.linearIssueId ?? task.id;
      const existing = groups.get(groupKey) ?? [];
      existing.push(task);
      groups.set(groupKey, existing);
    }

    const totalGroupsEvaluated = groups.size;
    let groupsArchived = 0;
    let groupsSkippedActive = 0;
    let tasksArchived = 0;
    let tasksFailed = 0;

    for (const [groupKey, groupTasks] of groups) {
      // Safety: skip groups that have active tasks (running/dispatched/queued).
      // This check must see ALL tasks in the group, including those without prMergedAt.
      const hasActive = groupTasks.some((t) => ACTIVE_STATUSES.has(t.status));
      if (hasActive) {
        logger.info(
          { groupKey, taskCount: groupTasks.length, reason: 'has_active_task' },
          'Skipping group with active task'
        );
        groupsSkippedActive++;
        continue;
      }

      // Filter to only tasks with prMergedAt < cutoffDate (archived candidates)
      const expiredTasks = groupTasks.filter(
        (t) => t.prMergedAt && t.prMergedAt.toDate() < cutoffDate
      );

      // If no expired tasks in this group, skip
      if (expiredTasks.length === 0) {
        continue;
      }

      logger.info(
        { groupKey, taskCount: expiredTasks.length },
        'Archiving group with expired merged PR'
      );

      for (const task of expiredTasks) {
        try {
          const updateResult = await codeTaskRepository.update(task.id, { status: 'archived' });
          if (!updateResult.ok) {
            logger.error(
              { taskId: task.id, groupKey, error: updateResult.error.message },
              'Failed to archive task'
            );
            tasksFailed++;
          } else {
            logger.info(
              { taskId: task.id, groupKey, previousStatus: task.status },
              'Archived task with merged PR'
            );
            tasksArchived++;
          }
        } catch (error) {
          const message = getErrorMessage(error);
          logger.error({ taskId: task.id, groupKey, error: message }, 'Failed to archive task');
          tasksFailed++;
        }
      }

      groupsArchived++;
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      {
        totalTasksFetched,
        totalGroupsEvaluated,
        groupsArchived,
        groupsSkippedActive,
        tasksArchived,
        tasksFailed,
        durationMs,
      },
      'Auto-archive of merged tasks completed'
    );

    return ok({
      totalTasksFetched,
      totalGroupsEvaluated,
      groupsArchived,
      groupsSkippedActive,
      tasksArchived,
      tasksFailed,
      durationMs,
    });
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && pnpm test -- --grep "autoArchiveMergedTasks"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/autoArchiveMergedTasks.ts apps/code-agent/src/__tests__/usecases/autoArchiveMergedTasks.test.ts
git commit -m "feat(code-agent): add autoArchiveMergedTasks use case (INT-1174)"
```

### Task 5: Register use case in ServiceContainer

**Files:**
- Modify: `apps/code-agent/src/services.ts`

- [ ] **Step 1: Add to ServiceContainer interface**

In `apps/code-agent/src/services.ts`, add to the `ServiceContainer` interface:

```typescript
autoArchiveMergedTasks: AutoArchiveMergedTasksUseCase;
```

Import the type:
```typescript
import type { AutoArchiveMergedTasksUseCase } from './domain/usecases/autoArchiveMergedTasks.js';
```

- [ ] **Step 2: Wire up in service initialization**

In the service initialization code (where `archiveStaleGroups` is created), add:

```typescript
const autoArchiveMergedTasks = createAutoArchiveMergedTasksUseCase({
  codeTaskRepository: codeTaskRepo,
  logger,
});
```

Import:
```typescript
import { createAutoArchiveMergedTasksUseCase } from './domain/usecases/autoArchiveMergedTasks.js';
```

- [ ] **Step 3: Update test helpers that mock ServiceContainer**

Search for `setServices(` usage in tests and add `autoArchiveMergedTasks` mock where `archiveStaleGroups` is mocked. Check `apps/code-agent/src/__tests__/helpers/mockServices.ts` and all test files that call `setServices`.

- [ ] **Step 4: Run full test suite**

Run: `cd apps/code-agent && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/services.ts apps/code-agent/src/__tests__/helpers/mockServices.ts
git commit -m "feat(code-agent): register autoArchiveMergedTasks in ServiceContainer (INT-1174)"
```

### Task 6: Add internal endpoint and route tests

**Files:**
- Modify: `apps/code-agent/src/routes/internalRoutes.ts`
- Create: `apps/code-agent/src/__tests__/routes/internalRoutes.autoArchiveMergedTasks.test.ts`

- [ ] **Step 1: Write failing route test**

Create `apps/code-agent/src/__tests__/routes/internalRoutes.autoArchiveMergedTasks.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Follow the pattern from existing internal route tests

describe('POST /internal/auto-archive-merged-tasks', () => {
  // Test: returns 401 without auth
  // Test: returns 200 with valid OIDC auth
  // Test: returns 200 with valid X-Internal-Auth
  // Test: passes mergeDays from body to use case
  // Test: returns use case result stats
  // Test: returns 500 on use case error
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/code-agent && pnpm test -- --grep "auto-archive-merged-tasks"`
Expected: FAIL — route not registered

- [ ] **Step 3: Add the internal endpoint**

In `apps/code-agent/src/routes/internalRoutes.ts`, add after the `archive-stale-groups` endpoint (line ~520):

```typescript
  // POST /internal/auto-archive-merged-tasks - triggered by Cloud Scheduler daily (INT-1174)
  fastify.post(
    '/internal/auto-archive-merged-tasks',
    {
      schema: {
        operationId: 'autoArchiveMergedTasks',
        summary: 'Archive tasks whose PRs were merged 7+ days ago',
        description: 'Called by Cloud Scheduler daily. Archives code tasks where the associated PR was merged more than the threshold days ago.',
        tags: ['internal'],
        body: {
          type: 'object',
          nullable: true,
          properties: {
            mergeDays: { type: 'number', description: 'Days after PR merge before archiving (default: 7)' },
          },
        },
        response: {
          200: {
            description: 'Archive completed',
            type: 'object',
            additionalProperties: false,
            properties: {
              totalTasksFetched: { type: 'number' },
              totalGroupsEvaluated: { type: 'number' },
              groupsArchived: { type: 'number' },
              groupsSkippedActive: { type: 'number' },
              tasksArchived: { type: 'number' },
              tasksFailed: { type: 'number' },
              durationMs: { type: 'number' },
            },
            required: ['totalTasksFetched', 'totalGroupsEvaluated', 'groupsArchived', 'groupsSkippedActive', 'tasksArchived', 'tasksFailed', 'durationMs'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/auto-archive-merged-tasks',
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn('Internal auth failed for auto-archive-merged-tasks');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }
      request.log.info({ strategy: authResult.strategy }, 'Authenticated for auto-archive-merged-tasks');

      const { autoArchiveMergedTasks, logger } = getServices();

      const body = request.body as { mergeDays?: number } | null;
      const mergeDays = body?.mergeDays;
      const input = mergeDays !== undefined ? { mergeDays } : undefined;

      const result = await autoArchiveMergedTasks(input);
      if (!result.ok) {
        logger.error({ error: result.error.message }, 'Auto-archive merged tasks failed');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      logger.info(result.value, 'Auto-archive merged tasks completed via route');

      // @allow-raw-send: cron endpoint returns archive stats directly
      return await reply.send(result.value);
    }
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/code-agent && pnpm test -- --grep "auto-archive-merged-tasks"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/internalRoutes.ts apps/code-agent/src/__tests__/routes/internalRoutes.autoArchiveMergedTasks.test.ts
git commit -m "feat(code-agent): add POST /internal/auto-archive-merged-tasks endpoint (INT-1174)"
```

### Task 7: Add Cloud Scheduler Terraform configuration

**Files:**
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Add Cloud Scheduler resource**

In `terraform/environments/dev/main.tf`, add after the `archive_stale_groups` scheduler block (line ~2061):

```terraform
# -----------------------------------------------------------------------------
# Cloud Scheduler - Auto-Archive Merged Tasks Daily (INT-1174)
# -----------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "auto_archive_merged_tasks" {
  name        = "intexuraos-auto-archive-merged-tasks-${var.environment}"
  description = "Archive code tasks whose PRs were merged 7+ days ago"
  schedule    = "0 4 * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${module.code_agent.service_url}/internal/auto-archive-merged-tasks"

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = module.code_agent.service_url
    }
  }

  retry_config {
    retry_count          = 1
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_service_iam_member.scheduler_invokes_code_agent,
    module.code_agent,
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "infra: add Cloud Scheduler for auto-archive merged tasks (INT-1174)"
```

### Task 8: Run full verification

- [ ] **Step 1: Build packages**

Run: `pnpm build`

- [ ] **Step 2: Run workspace verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`

- [ ] **Step 3: Run full CI**

Run: `pnpm run ci:tracked`

- [ ] **Step 4: Fix any issues, commit**

---

## Endpoint Changes

### Modified
- None

### Created
- `POST /internal/auto-archive-merged-tasks` — Internal endpoint triggered by Cloud Scheduler daily at 4 AM UTC. Accepts optional `{ mergeDays: number }` body. Returns archive statistics. Authenticated via OIDC (Cloud Scheduler) or `X-Internal-Auth` token.

### Removed
- None

### Unchanged
- `GET /code/issue-groups?groupStatus=archived` — Existing endpoint (no changes needed)
- `POST /code/tasks/:taskId/archive` — Existing manual archive endpoint (no changes)
- `POST /internal/archive-stale-groups` — Existing staleness-based archiver (complementary, not replaced)

---

## Design Decisions

1. **`prMergedAt` on CodeTask vs. cross-collection query**: Storing `prMergedAt` directly on the task enables efficient single-collection Firestore queries with a composite index. Cross-collection joins between `code_tasks` and `github_pr_events` would be inefficient and complex.

2. **Separate use case vs. extending `archiveStaleGroups`**: The new `autoArchiveMergedTasks` use case is kept separate because it targets a different signal (PR merge time vs. inactivity time). The existing `archiveStaleGroups` catches generic staleness; the new one specifically targets merged PRs. They're complementary — both run on schedules.

3. **Best-effort `prMergedAt` population**: Setting `prMergedAt` in `handlePrClose` is fire-and-forget (matching existing patterns in that handler). Existing tasks without `prMergedAt` will be caught by the existing `archiveStaleGroups` staleness archiver instead. No backfill migration is needed.

4. **Daily schedule (4 AM UTC)**: The `archiveStaleGroups` runs hourly. The new merged-PR archiver runs daily since PR merge timing is less time-sensitive. 4 AM UTC avoids overlap with the hourly staleness check and the 3 AM log-cleanup job.
