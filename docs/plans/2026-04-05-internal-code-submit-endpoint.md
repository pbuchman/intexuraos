# Internal Code Submit Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /internal/code/submit` endpoint that lets internal services create code tasks on behalf of a user, mirroring `POST /code/submit` but using internal auth and accepting `userId` in the body.

**Architecture:** The new endpoint reuses the existing `processCodeAction` use case which already handles sanitization, deduplication, Linear issue management, worker settings validation, and task enqueue. The endpoint uses `validateInternalAuth` (X-Internal-Auth header) instead of JWT auth, and requires `userId` in the request body. Synthetic `actionId`/`approvalEventId` values are generated to satisfy `processCodeAction`'s interface, prefixed with `internal-submit-` to distinguish them from real action approvals.

**Tech Stack:** Fastify, TypeScript, Vitest, `@intexuraos/common-http` (internal auth), `processCodeAction` use case

---

## Endpoint Changes

- **Created:** `POST /internal/code/submit` — internal endpoint for creating code tasks on behalf of a user
- **Modified:** None
- **Removed:** None
- **Unchanged:** `POST /code/submit` (public, JWT), `POST /internal/code/process` (actions-agent)

## File Structure

| File                                                              | Action   | Responsibility                             |
| ----------------------------------------------------------------- | -------- | ------------------------------------------ |
| `apps/code-agent/src/routes/codeRoutes.ts`                        | Modify   | Add new `POST /internal/code/submit` route |
| `apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts` | Create   | Tests for the new endpoint                 |

---

### Task 1: Write failing tests for the new internal submit endpoint

**Files:**
- Create: `apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts`

This test file follows the exact same setup pattern as `codeProcess.test.ts`. Copy its `beforeEach`/`afterEach` structure verbatim — do NOT invent a new pattern.

- [ ] **Step 1: Create the test file with setup and first test (auth rejection)**

Create `apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts`. The file setup is identical to `apps/code-agent/src/__tests__/routes/codeProcess.test.ts` — copy its imports, `beforeEach`, `afterEach`, and service wiring exactly. Then add the first test case.

```typescript
/**
 * Tests for POST /internal/code/submit endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
```

**IMPORTANT:** The `beforeEach`/`afterEach` and service wiring must be copied EXACTLY from `codeProcess.test.ts`. Read that file completely (all the way to the end of its `beforeEach`) and replicate the pattern. Do not abbreviate or simplify it.

The test cases to write (each as a separate `it()` block inside the `describe`):

**Test 1: rejects requests without internal auth header**

```typescript
it('rejects requests without internal auth header', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
      prompt: 'Fix the login bug',
    },
    // No x-internal-auth header
  });

  expect(response.statusCode).toBe(401);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('UNAUTHORIZED');
});
```

**Test 2: rejects requests with invalid internal auth token**

```typescript
it('rejects requests with invalid internal auth token', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
      prompt: 'Fix the login bug',
    },
    headers: {
      'x-internal-auth': 'wrong-token',
    },
  });

  expect(response.statusCode).toBe(401);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(false);
});
```

**Test 3: rejects requests missing required userId field**

```typescript
it('rejects requests missing userId', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      prompt: 'Fix the login bug',
    },
    headers: {
      'x-internal-auth': 'test-internal-token',
    },
  });

  expect(response.statusCode).toBe(400);
});
```

**Test 4: rejects requests missing required prompt field**

```typescript
it('rejects requests missing prompt', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
    },
    headers: {
      'x-internal-auth': 'test-internal-token',
    },
  });

  expect(response.statusCode).toBe(400);
});
```

**Test 5: successfully creates a code task on behalf of a user**

This test requires seeding a worker settings document in Firestore so `workerSettingsRepo.getSettings()` returns enabled workers. Look at how `codeProcess.test.ts` or `codeSubmit.test.ts` seeds worker settings and replicate that pattern.

```typescript
it('successfully creates a code task with valid internal auth', async () => {
  // Seed worker settings for the user (copy pattern from codeProcess.test.ts)
  const workerSettingsCollection = fakeFirestore.collection('worker_settings');
  await workerSettingsCollection.doc('test-user-id').set({
    userId: 'test-user-id',
    workers: [
      {
        name: 'test-worker',
        type: 'claude-code',
        enabled: true,
        credentials: { apiKey: 'test-key' },
      },
    ],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
      prompt: 'Fix the login bug',
    },
    headers: {
      'x-internal-auth': 'test-internal-token',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data.status).toBe('submitted');
  expect(body.data.codeTaskId).toMatch(/^task_/);
});
```

**Test 6: passes optional workerType and linearIssueId to the use case**

```typescript
it('passes optional workerType and linearIssueId', async () => {
  const workerSettingsCollection = fakeFirestore.collection('worker_settings');
  await workerSettingsCollection.doc('test-user-id').set({
    userId: 'test-user-id',
    workers: [
      {
        name: 'test-worker',
        type: 'claude-code',
        enabled: true,
        credentials: { apiKey: 'test-key' },
      },
    ],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
      prompt: 'Fix the login bug',
      workerType: 'claude-code',
      linearIssueId: 'INT-999',
    },
    headers: {
      'x-internal-auth': 'test-internal-token',
    },
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(true);
  expect(body.data.codeTaskId).toMatch(/^task_/);
});
```

**Test 7: returns 503 when user has no workers configured**

```typescript
it('returns error when user has no workers configured', async () => {
  // Seed worker settings with no enabled workers
  const workerSettingsCollection = fakeFirestore.collection('worker_settings');
  await workerSettingsCollection.doc('test-user-id').set({
    userId: 'test-user-id',
    workers: [],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/internal/code/submit',
    payload: {
      userId: 'test-user-id',
      prompt: 'Fix the login bug',
    },
    headers: {
      'x-internal-auth': 'test-internal-token',
    },
  });

  expect(response.statusCode).not.toBe(200);
  const body = JSON.parse(response.payload);
  expect(body.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: All new tests FAIL because `POST /internal/code/submit` route does not exist yet (404 responses).

- [ ] **Step 3: Commit failing tests**

```bash
git add apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts
git commit -m "test: add failing tests for POST /internal/code/submit endpoint (INT-1287)"
```

---

### Task 2: Implement the POST /internal/code/submit endpoint

**Files:**
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (add new route after the existing `POST /internal/code/process` route, around line 746)

The new endpoint mirrors the parameter interface of `POST /code/submit` but:
1. Uses `validateInternalAuth` instead of JWT
2. Accepts `userId` in the request body instead of extracting from JWT
3. Delegates to `processCodeAction` use case (same as `/internal/code/process`)
4. Generates synthetic `actionId`/`approvalEventId` with `internal-submit-` prefix

- [ ] **Step 1: Add the new route to codeRoutes.ts**

Insert the following route definition after the `POST /internal/code/process` route handler (after approximately line 746, before the `POST /internal/code/group-summary/recompute` route). Find the exact location by searching for the comment `// POST /internal/code/group-summary/recompute`.

```typescript
  // POST /internal/code/submit - Internal endpoint to create tasks on behalf of a user (INT-1287)
  fastify.post<{
    Body: {
      userId: string;
      prompt: string;
      workerType?: WorkerType;
      linearIssueId?: string;
    };
  }>(
    '/internal/code/submit',
    {
      schema: {
        operationId: 'internalSubmitCodeTask',
        summary: 'Create a code task on behalf of a user',
        description:
          'Internal endpoint for creating code tasks on behalf of a user. ' +
          'Mirrors POST /code/submit but uses internal auth and accepts userId in the body.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            userId: { type: 'string', minLength: 1 },
            prompt: { type: 'string', minLength: 1, maxLength: 100000 },
            workerType: workerTypeSchema,
            linearIssueId: { type: 'string' },
          },
          required: ['userId', 'prompt'],
        },
        response: {
          200: {
            description: 'Task submitted successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['submitted'] },
                  codeTaskId: { type: 'string' },
                  resourceUrl: { type: 'string' },
                },
                required: ['status', 'codeTaskId', 'resourceUrl'],
              },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          409: {
            description: 'Duplicate task',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['CONFLICT'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          503: {
            description: 'Worker unavailable',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['MISCONFIGURED', 'WORKER_NOT_CONFIGURED'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          500: {
            description: 'Server error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INTERNAL_ERROR'] },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: {
          userId: string;
          prompt: string;
          workerType?: WorkerType;
          linearIssueId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/submit',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for internal code submit');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const body = request.body;

      // Extract or generate traceId from headers
      const traceId = extractOrGenerateTraceId(request.headers);

      request.log.info(
        {
          userId: body.userId,
          workerType: body.workerType,
          promptLength: body.prompt.length,
          traceId,
        },
        'Internal code task submission on behalf of user'
      );

      // Generate synthetic actionId/approvalEventId for processCodeAction.
      // These are prefixed with 'internal-submit-' so they are distinguishable
      // from real action approvals and won't collide with Layer 0/1 dedup.
      const syntheticId = `internal-submit-${randomUUID()}`;

      const processRequest: {
        actionId: string;
        approvalEventId: string;
        userId: string;
        prompt: string;
        workerType: WorkerType;
        linearIssueId?: string;
        traceId?: string;
        source?: 'whatsapp' | 'web';
      } = {
        actionId: syntheticId,
        approvalEventId: syntheticId,
        userId: body.userId,
        prompt: body.prompt,
        workerType: body.workerType ?? 'auto',
        traceId,
        source: 'web',
      };

      if (body.linearIssueId !== undefined) {
        processRequest.linearIssueId = body.linearIssueId;
      }

      const result = await processCodeAction(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskEnqueueService: services.taskEnqueueService,
          linearIssueService: services.linearIssueService,
          linearAgentClient: services.linearAgentClient,
          whatsappNotifier: services.whatsappNotifier,
          metricsClient: services.metricsClient,
          workerSettingsRepo: services.workerSettingsRepo,
          orchestratorSecret: loadConfig().orchestratorSecret,
        },
        processRequest
      );

      if (!result.ok) {
        const error = result.error;
        request.log.warn(
          {
            errorCode: error.code,
            errorMessage: error.message,
            existingTaskId: error.existingTaskId,
          },
          'Failed to create internal code task'
        );

        if (error.code === 'duplicate_prompt') {
          return await reply.fail('CONFLICT', `Similar task submitted in last 5 minutes: ${error.existingTaskId ?? ''}`);
        }

        if (error.code === 'active_task_exists') {
          return await reply.fail('CONFLICT', `Active task already exists for this Linear issue: ${error.existingTaskId ?? ''}`);
        }

        if (error.code === 'worker_not_configured') {
          return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
        }

        if (error.code === 'validation_error') {
          return await reply.fail('INVALID_REQUEST', error.message);
        }

        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      request.log.info({ codeTaskId: result.value.codeTaskId }, 'Internal code task created successfully');

      return await reply.ok({
        status: 'submitted',
        codeTaskId: result.value.codeTaskId,
        resourceUrl: result.value.resourceUrl,
      });
    }
  );
```

**IMPORTANT:** The `randomUUID` import already exists at line 28 of `codeRoutes.ts`. The `processCodeAction` import already exists at line 15. The `loadConfig` import already exists at line 31. Do NOT add duplicate imports.

- [ ] **Step 2: Run tests to confirm they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: All tests in `codeInternalSubmit.test.ts` pass. All existing tests still pass.

- [ ] **Step 3: Commit implementation**

```bash
git add apps/code-agent/src/routes/codeRoutes.ts
git commit -m "feat: add POST /internal/code/submit endpoint for internal task creation (INT-1287)"
```

---

### Task 3: Verify CI and adjust coverage

**Files:**
- Possibly modify: `apps/code-agent/src/__tests__/routes/codeInternalSubmit.test.ts` (if additional edge case coverage needed)

- [ ] **Step 1: Run full CI check**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All checks pass including coverage thresholds.

- [ ] **Step 2: If coverage gaps exist, add targeted tests**

Check the coverage output. If any branches in the new route handler are uncovered, add tests for those specific branches. Common gaps:
- The `validation_error` path (prompt injection detected)
- The `duplicate_prompt` / `active_task_exists` paths

For any paths that are genuinely untestable (e.g., type narrowing guards), use v8 ignore with the correct category and a reason naming the testing blocker:
```typescript
/* v8 ignore start -- ts-type: <reason naming the testing blocker> @preserve */
```

- [ ] **Step 3: Commit any coverage fixes**

```bash
git add -A
git commit -m "test: add coverage for internal submit edge cases (INT-1287)"
```

---

## Design Decisions

| Decision                               | Rationale                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse `processCodeAction`              | Avoids duplicating sanitization, deduplication, Linear issue management, enqueue, and worker settings logic. Single source of truth.                                                |
| Synthetic `actionId`/`approvalEventId` | `processCodeAction` requires these for Layer 0/1 dedup. Using `internal-submit-` prefix + UUID ensures uniqueness and distinguishability from real action approvals.                |
| No rate limiting                       | Internal services are trusted callers — rate limiting is a user-facing concern. `processCodeAction` doesn't enforce rate limits (that's done in the `/code/submit` route directly). |
| No `repository`/`baseBranch` params    | These default to `pbuchman/intexuraos` and `development` inside `processCodeAction`. If needed later, they can be added as optional fields without breaking changes.                |
| Response includes `resourceUrl`        | Matches `/internal/code/process` response shape. Callers can use this to link to the task in the UI.                                                                                |
| `source` field set to `'web'`          | Metrics source defaults to web since there is no separate source category for internal submissions. Can be changed later if needed.                                                 |
