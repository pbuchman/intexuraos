# Fix Ask-Agent Conversation Persistence (Cross-Device) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the active ask-agent conversation across devices by querying the backend instead of using localStorage, and replace the misleading empty-state spinner with a static message.

**Architecture:** Add a new `GET /code/ask-agent/active` endpoint to the code-agent backend that queries the `code_tasks` collection for the user's most recent non-archived ask-agent task. The frontend `useAskAgent` hook calls this endpoint on mount to restore the active session. The existing `POST /code/tasks/:taskId/archive` endpoint is reused for the `clear()` action. The `CodeTaskLogViewer` empty state is updated independently.

**Tech Stack:** Fastify (backend routes), Firestore (query), React hooks (frontend), vitest (testing)

---

## File Structure

| File                                                                      | Action   | Responsibility                                     |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`           | Modify   | Add `findLatestAskAgentTask` method to interface   |
| `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`   | Modify   | Implement `findLatestAskAgentTask` Firestore query |
| `apps/code-agent/src/domain/usecases/getActiveAskAgent.ts`                | Create   | Use case: find user's active/latest ask-agent task |
| `apps/code-agent/src/routes/codeRoutes.ts`                                | Modify   | Add `GET /code/ask-agent/active` route handler     |
| `apps/code-agent/src/__tests__/domain/usecases/getActiveAskAgent.test.ts` | Create   | Unit tests for the use case                        |
| `apps/code-agent/src/__tests__/routes/askAgentActive.test.ts`             | Create   | Route integration tests                            |
| `apps/web/src/services/codeAgentApi.ts`                                   | Modify   | Add `getActiveAskAgent` API function               |
| `apps/web/src/hooks/useAskAgent.ts`                                       | Modify   | Fetch active task on mount, archive on clear       |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`                | Modify   | Replace empty state spinner with static message    |

## Endpoint Changes

| Type        | Endpoint                           | Details                                                                              |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| **Created** | `GET /code/ask-agent/active`       | Returns the user's most recent non-archived ask-agent task, or `null` if none exists |
| Unchanged   | `POST /code/ask-agent/start`       | No changes                                                                           |
| Unchanged   | `POST /code/tasks/:taskId/archive` | Reused by frontend `clear()` — already exists                                        |
| Unchanged   | `GET /code/tasks`                  | Still filters out `ask_agent` tasks (line 2254)                                      |

---

## Task 1: Add `findLatestAskAgentTask` to Repository Interface and Implementation

**Files:**
- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`
- Test: `apps/code-agent/src/__tests__/domain/usecases/getActiveAskAgent.test.ts` (created in Task 2, but the repo method is exercised through the use case)

### Firestore Query Design

The query finds the most recent ask-agent task that is **not archived** for a given user:

```
code_tasks
  .where('userId', '==', userId)
  .where('agentType', '==', 'ask_agent')
  .where('status', 'in', NON_ARCHIVED_STATUSES)
  .orderBy('createdAt', 'desc')
  .limit(1)
```

`NON_ARCHIVED_STATUSES` is already imported in the repository file (line 22) from `../../domain/issueGrouping/constants.js`. This returns:
- Active tasks (queued/dispatched/running) — user's live conversation
- Terminal tasks (implemented/failed/cancelled/interrupted) — last completed conversation
- `null` if no ask-agent task exists or all are archived

This requires a Firestore **composite index**: `(userId ASC, agentType ASC, status ASC, createdAt DESC)` on the `code_tasks` collection.

- [ ] **Step 1: Add the method to the repository interface**

In `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`, add after the `findPreservedPullRequestTask` method (before `deleteTask`):

```typescript
  /**
   * Find the most recent non-archived ask-agent task for a user.
   * Returns null if none exists. Used by GET /code/ask-agent/active
   * to restore the user's conversation across devices.
   */
  findLatestAskAgentTask(
    userId: string
  ): Promise<Result<CodeTask | null, RepositoryError>>;
```

- [ ] **Step 2: Implement in Firestore repository**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, add the implementation inside the returned object (after the `findPreservedPullRequestTask` method):

```typescript
    findLatestAskAgentTask: async (userId: string): Promise<Result<CodeTask | null, RepositoryError>> => {
      try {
        const query = collection
          .where('userId', '==', userId)
          .where('agentType', '==', 'ask_agent')
          .where('status', 'in', NON_ARCHIVED_STATUSES)
          .orderBy('createdAt', 'desc')
          .limit(1);

        const snapshot = await query.get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0]!;
        return ok(toCodeTask(doc as unknown as { id: string; data(): Record<string, unknown> }));
      } catch (error) {
        logger.error({ error, userId }, 'Failed to find latest ask-agent task');
        return err({
          code: 'FIRESTORE_ERROR',
          message: `Firestore error: ${getErrorMessage(error)}`,
        });
      }
    },
```

- [ ] **Step 3: Add Firestore composite index migration**

Create a new migration file in `apps/code-agent/migrations/` (use the next sequential number). The migration should create a composite index:

```javascript
// Migration: Add composite index for ask-agent active query
// Index: code_tasks (userId ASC, agentType ASC, status ASC, createdAt DESC)
export async function up(firestore) {
  // Composite indexes are created via gcloud/Firebase console, not via code.
  // This migration documents the required index.
  // Run: gcloud firestore indexes composite create \
  //   --collection-group=code_tasks \
  //   --field-config field-path=userId,order=ascending \
  //   --field-config field-path=agentType,order=ascending \
  //   --field-config field-path=status,order=ascending \
  //   --field-config field-path=createdAt,order=descending \
  //   --project=intexuraos-dev-pbuchman
  console.log('Index documented. Create via gcloud CLI if not auto-created.');
}
```

**Note:** Check existing migrations to confirm the exact pattern used in this codebase. The Firestore emulator (FakeFirestore) ignores indexes, so this only matters in production.

- [ ] **Step 4: Verify build compiles**

Run: `cd /repo && pnpm build`
Expected: Successful build with no type errors

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/repositories/codeTaskRepository.ts \
  apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts
git commit -m "feat(code-agent): add findLatestAskAgentTask repository method

Adds a Firestore query to find the most recent non-archived ask-agent
task for a user. Used by the upcoming GET /code/ask-agent/active endpoint
for cross-device conversation persistence."
```

---

## Task 2: Create `getActiveAskAgent` Use Case with Tests

**Files:**
- Create: `apps/code-agent/src/domain/usecases/getActiveAskAgent.ts`
- Create: `apps/code-agent/src/__tests__/domain/usecases/getActiveAskAgent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/code-agent/src/__tests__/domain/usecases/getActiveAskAgent.test.ts`:

```typescript
/**
 * Tests for getActiveAskAgent use case.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from '@intexuraos/common-core';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { getActiveAskAgent } from '../../../domain/usecases/getActiveAskAgent.js';

// Required env vars
process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

describe('getActiveAskAgent', () => {
  let logger: Logger;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let codeTaskRepo: CodeTaskRepository;

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
  });

  afterEach(() => {
    resetFirestore();
  });

  it('returns null when no ask-agent tasks exist', async () => {
    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('returns the most recent non-archived ask-agent task', async () => {
    // Create an ask-agent task
    const createResult = await codeTaskRepo.create({
      id: 'task_ask_1',
      userId: 'test-user-id',
      prompt: 'What is this codebase?',
      sanitizedPrompt: 'What is this codebase?',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });
    expect(createResult.ok).toBe(true);

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).not.toBeNull();
    expect(result.value.task!.id).toBe('task_ask_1');
  });

  it('does not return archived ask-agent tasks', async () => {
    // Create and archive an ask-agent task
    await codeTaskRepo.create({
      id: 'task_ask_archived',
      userId: 'test-user-id',
      prompt: 'Old conversation',
      sanitizedPrompt: 'Old conversation',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });
    // Move to terminal then archive
    await codeTaskRepo.update('task_ask_archived', { status: 'implemented' });
    await codeTaskRepo.update('task_ask_archived', { status: 'archived' });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('does not return tasks belonging to other users', async () => {
    await codeTaskRepo.create({
      id: 'task_ask_other',
      userId: 'other-user-id',
      prompt: 'Other user conversation',
      sanitizedPrompt: 'Other user conversation',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });

  it('does not return non-ask-agent tasks', async () => {
    await codeTaskRepo.create({
      id: 'task_regular',
      userId: 'test-user-id',
      prompt: 'Regular code task',
      sanitizedPrompt: 'Regular code task',
      systemPromptHash: 'some-hash',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
    });

    const result = await getActiveAskAgent(
      { logger, codeTaskRepo },
      { userId: 'test-user-id' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.task).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter code-agent exec vitest run src/__tests__/domain/usecases/getActiveAskAgent.test.ts`
Expected: FAIL — module `getActiveAskAgent` does not exist

- [ ] **Step 3: Write the use case implementation**

Create `apps/code-agent/src/domain/usecases/getActiveAskAgent.ts`:

```typescript
/**
 * Use case: Get the user's active/latest ask-agent task.
 *
 * Returns the most recent non-archived ask-agent task for cross-device
 * conversation restoration. Returns null if no such task exists.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';

export interface GetActiveAskAgentRequest {
  userId: string;
}

export interface GetActiveAskAgentResult {
  task: CodeTask | null;
}

export interface GetActiveAskAgentError {
  code: 'internal_error';
  message: string;
}

export interface GetActiveAskAgentDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
}

export async function getActiveAskAgent(
  deps: GetActiveAskAgentDeps,
  request: GetActiveAskAgentRequest,
): Promise<Result<GetActiveAskAgentResult, GetActiveAskAgentError>> {
  const { logger, codeTaskRepo } = deps;
  const { userId } = request;

  const result = await codeTaskRepo.findLatestAskAgentTask(userId);

  if (!result.ok) {
    logger.error({ userId, error: result.error }, 'Failed to find active ask-agent task');
    return err({ code: 'internal_error', message: result.error.message });
  }

  return ok({ task: result.value });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter code-agent exec vitest run src/__tests__/domain/usecases/getActiveAskAgent.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/getActiveAskAgent.ts \
  apps/code-agent/src/__tests__/domain/usecases/getActiveAskAgent.test.ts
git commit -m "feat(code-agent): add getActiveAskAgent use case with tests

Queries the user's most recent non-archived ask-agent task for
cross-device conversation persistence. Returns null if none exists."
```

---

## Task 3: Add `GET /code/ask-agent/active` Route with Tests

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts`
- Create: `apps/code-agent/src/__tests__/routes/askAgentActive.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/code-agent/src/__tests__/routes/askAgentActive.test.ts`. Follow the exact same pattern as `askAgentStart.test.ts` for the test setup (imports, `setServices`, mock JWT, etc.). The key test cases:

```typescript
describe('GET /code/ask-agent/active', () => {
  // ... same setup as askAgentStart.test.ts ...

  it('returns null when no ask-agent task exists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/code/ask-agent/active',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.task).toBeNull();
  });

  it('returns the active ask-agent task', async () => {
    // Create an ask-agent task via the repository
    await codeTaskRepo.create({
      id: 'task_active_1',
      userId: 'test-user-id',
      prompt: 'Test conversation',
      sanitizedPrompt: 'Test conversation',
      systemPromptHash: 'ask-agent',
      workerType: 'opus',
      workerLocation: 'pending',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_test',
      agentType: 'ask_agent',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/code/ask-agent/active',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.task).not.toBeNull();
    expect(body.data.task.id).toBe('task_active_1');
  });

  it('returns 401 without auth token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/code/ask-agent/active',
    });

    expect(response.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm --filter code-agent exec vitest run src/__tests__/routes/askAgentActive.test.ts`
Expected: FAIL — route not found (404)

- [ ] **Step 3: Add the route handler**

In `apps/code-agent/src/routes/codeRoutes.ts`, add the new route **after** the `POST /code/ask-agent/start` handler (around line 2016) and **before** the `GET /code/queue` route:

```typescript
  // GET /code/ask-agent/active - Get user's active ask-agent task (public, Auth0 JWT)
  fastify.get(
    '/code/ask-agent/active',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'getActiveAskAgent',
        summary: 'Get the active ask-agent conversation',
        description: 'Returns the user\'s most recent non-archived ask-agent task for cross-device conversation restoration. Requires Auth0 JWT.',
        tags: ['public'],
        response: {
          200: {
            description: 'Active ask-agent task or null',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  task: {
                    oneOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          status: { type: 'string' },
                          agentType: { type: 'string' },
                          prompt: { type: 'string' },
                          createdAt: { type: 'string' },
                        },
                      },
                    ],
                  },
                },
                required: ['task'],
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/ask-agent/active',
      });

      const { codeTaskRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';

      const result = await getActiveAskAgent(
        { logger: request.log, codeTaskRepo },
        { userId },
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const task = result.value.task;
      return await reply.ok({
        task: task !== null ? taskToApiResponse(task) : null,
      });
    },
  );
```

Add the import at the top of `codeRoutes.ts`:

```typescript
import { getActiveAskAgent } from '../domain/usecases/getActiveAskAgent.js';
```

**Important:** The route uses the existing `taskToApiResponse` helper to serialize the task, ensuring consistent API response shape with other task endpoints.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter code-agent exec vitest run src/__tests__/routes/askAgentActive.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify full code-agent test suite**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`
Expected: All tests pass, coverage meets thresholds

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts \
  apps/code-agent/src/__tests__/routes/askAgentActive.test.ts
git commit -m "feat(code-agent): add GET /code/ask-agent/active endpoint

New public endpoint that returns the user's most recent non-archived
ask-agent task for cross-device conversation restoration."
```

---

## Task 4: Add Frontend API Function

**Files:**
- Modify: `apps/web/src/services/codeAgentApi.ts`
- Modify: `apps/web/src/types/index.ts` (if `ActiveAskAgentResponse` type needed)

- [ ] **Step 1: Add the API function**

In `apps/web/src/services/codeAgentApi.ts`, add after the `startAskAgent` function (line 284):

```typescript
/**
 * Get the user's active ask-agent conversation (for cross-device persistence)
 */
export async function getActiveAskAgent(
  accessToken: string,
): Promise<{ task: CodeTask | null }> {
  return await apiRequest<{ task: CodeTask | null }>(
    config.codeAgentUrl,
    '/code/ask-agent/active',
    accessToken,
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /repo && pnpm build`
Expected: Successful build

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/codeAgentApi.ts
git commit -m "feat(web): add getActiveAskAgent API client function

Frontend API client for the new GET /code/ask-agent/active endpoint."
```

---

## Task 5: Refactor `useAskAgent` Hook for Backend Persistence

**Files:**
- Modify: `apps/web/src/hooks/useAskAgent.ts`

This is the core change. The hook must:
1. On mount, call `GET /code/ask-agent/active` to restore the active conversation
2. On `start()`, the existing flow already creates the task server-side — no change needed
3. On `clear()`, archive the task via `POST /code/tasks/:taskId/archive` so it won't be returned by the active endpoint on the next load

- [ ] **Step 1: Update imports**

Add the new imports at the top of `useAskAgent.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context';
import { startAskAgent, getActiveAskAgent, archiveCodeTask } from '@/services/codeAgentApi';
import { useTaskView } from './useTaskView.js';
import type { CodeTask } from '@/types';
```

- [ ] **Step 2: Add restoration logic on mount**

Inside `useAskAgent()`, after the `useState` declarations, add a `useEffect` that fetches the active task:

```typescript
  // Restore active ask-agent session from backend (cross-device persistence)
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      try {
        const token = await getAccessToken();
        const response = await getActiveAskAgent(token);
        if (!cancelled && response.task !== null) {
          setTaskId(response.task.id);
        }
      } catch {
        // Silently ignore — user will see fresh start view
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);
```

- [ ] **Step 3: Update `clear()` to archive the task**

Replace the existing `clear` callback:

```typescript
  const clear = useCallback((): void => {
    if (taskId !== null) {
      // Archive the task so it won't be returned by GET /code/ask-agent/active
      void getAccessToken().then((token) => {
        void archiveCodeTask(token, taskId);
      });
    }
    setTaskId(null);
    setStartError(null);
  }, [taskId, getAccessToken]);
```

**Key design choice:** The archive call is fire-and-forget. The UI resets immediately for responsiveness. If the archive fails (network error), the task will still appear next time the user loads the page — a safe fallback that prevents data loss.

- [ ] **Step 4: Verify build**

Run: `cd /repo && pnpm build`
Expected: Successful build

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useAskAgent.ts
git commit -m "feat(web): refactor useAskAgent for cross-device persistence

Replace localStorage approach with backend API calls:
- On mount: fetch active task via GET /code/ask-agent/active
- On clear: archive task via POST /code/tasks/:taskId/archive
- Enables conversation restoration across different devices"
```

---

## Task 6: Replace Empty State Spinner in CodeTaskLogViewer

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`

- [ ] **Step 1: Replace the empty state block**

In `CodeTaskLogViewer.tsx`, replace lines 326-332:

**Old code (lines 326-332):**
```tsx
{logs.length === 0 ? (
  <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    <p className="text-sm text-slate-500 dark:text-slate-400">
      {isActive ? 'Waiting for logs...' : 'No logs available for this task.'}
    </p>
  </div>
) : (
```

**New code:**
```tsx
{logs.length === 0 ? (
  <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
    <p className="text-sm text-slate-500 dark:text-slate-400">
      {agentType === 'ask_agent'
        ? 'Your conversation will appear here when available'
        : 'Execution logs will appear here when available'}
    </p>
  </div>
) : (
```

- [ ] **Step 2: Remove the `Loader2` import**

The `Loader2` import (line 7) is only used in the empty state. Remove it from the lucide-react import:

**Before:**
```typescript
  Loader2,
```

**After:** Remove the `Loader2,` line from the import block.

- [ ] **Step 3: Verify build**

Run: `cd /repo && pnpm build`
Expected: Successful build with no unused import warnings

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx
git commit -m "fix(web): replace empty state spinner with static message

Remove misleading Loader2 spinner from CodeTaskLogViewer empty state.
Show context-aware message: ask-agent gets conversation message,
other agent types get execution logs message."
```

---

## Task 7: Full Verification

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`
Expected: Successful build

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All tests pass, coverage meets thresholds

- [ ] **Step 3: Manual test plan**

Verify in the dev environment:
1. Start ask-agent conversation → navigate away → return → conversation is restored
2. Open in a different browser/device → same conversation appears
3. Complete conversation → return → shows completed state with Clear option
4. Clear conversation → task is archived → fresh Start view
5. Clear → open in another device → fresh Start view (archived task not returned)
6. Empty state (no logs yet) shows static message without spinner — both on ask-agent and code task detail pages

---

## Key Design Decisions

1. **Backend query over localStorage:** User explicitly requires cross-device persistence. The `code_tasks` collection already has all the data needed — a simple query replaces any client-side storage.

2. **Reuse existing archive endpoint for `clear()`:** Instead of adding a new "dismiss" field or endpoint, we reuse `POST /code/tasks/:taskId/archive` which already exists and sets status to `archived`. The active query excludes archived tasks via `NON_ARCHIVED_STATUSES`.

3. **Fire-and-forget archive on clear:** The UI resets immediately while the archive request runs in the background. If it fails, the conversation reappears on next load — safe fallback.

4. **Single task returned (not a list):** The endpoint returns only the most recent non-archived ask-agent task. This enforces "at most one active conversation" without additional state management.

5. **No new Firestore collections or fields:** The solution uses only existing data and adds one query method. The only potential addition is a composite index for production performance.
