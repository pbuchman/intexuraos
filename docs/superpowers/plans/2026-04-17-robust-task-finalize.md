# Robust Task Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the class of "code task stuck in `running`" bugs by making the orchestrator block on a dedicated, minimal status-update endpoint owned by code-agent, and by turning on the existing zombie watchdog as a safety net.

**Architecture:** A new `PATCH /internal/code-tasks/:id/status` endpoint in code-agent performs a single idempotent Firestore write of terminal status using the shared `orchestratorSecret` HMAC (same auth scheme as heartbeat — NOT per-task `webhookSecret` that caused signature drift). HMAC is verified over `request.rawBody` (already captured by the common-http content parser) instead of re-serializing `request.body` — this closes the schema-coerces-body → HMAC mismatch class of failure. The orchestrator's `finalizeTask` calls this endpoint with retry + persistent queue fallback before firing the existing `task-complete` webhook, which is demoted to side-effects only. `findZombieTasks` switches from `updatedAt` (corrupted by unrelated webhooks like PR merge) to `lastHeartbeat`, and a new Cloud Scheduler cron invokes `/internal/code/detect-zombies` every 5 minutes in dev.

**Tech Stack:** TypeScript (strict), Fastify, Firestore, ajv, node-fetch, Terraform, Google Cloud Scheduler, Vitest.

**Endpoint Changes:**
- **Created:** `PATCH /internal/code-tasks/:id/status` (orchestrator-authenticated)
- **Modified:** none (existing `task-complete` webhook unchanged, just no longer load-bearing for status)
- **Removed:** none
- **Unchanged:** all existing endpoints

---

## File Structure

### New files

- `apps/code-agent/src/routes/code/updateTaskStatusRoute.ts` — minimal `PATCH /internal/code-tasks/:id/status` route (additional_properties:false, no arrays, no defaults, enum-constrained status)
- `apps/code-agent/src/__tests__/routes/code/updateTaskStatusRoute.test.ts` — route tests including HMAC round-trip test
- `workers/orchestrator/src/services/status-update-client.ts` — HTTP client that calls the new endpoint with retry + persistent queue fallback
- `workers/orchestrator/src/services/__tests__/status-update-client.test.ts` — unit tests for the client

### Modified files

- `apps/code-agent/src/infra/webhookValidation.ts` — `validateOrchestratorSignature` uses `request.rawBody` when present, falls back to `JSON.stringify(request.body)` for backward compatibility
- `apps/code-agent/src/__tests__/infra/webhookValidation.test.ts` — new tests proving rawBody path is preferred
- `apps/code-agent/src/routes/code/index.ts` — register the new route
- `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts` — `findZombieTasks` queries on `lastHeartbeat` instead of `updatedAt`
- `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts` — update findZombieTasks tests
- `workers/orchestrator/src/services/task-dispatcher.ts` — `finalizeTask` calls `statusUpdateClient` with retry before existing webhook; accepts `statusUpdateClient` via constructor
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` — test finalize blocks on status update success
- `workers/orchestrator/src/start.ts` — wire `StatusUpdateClient` into `TaskDispatcher`
- `terraform/environments/dev/main.tf` — add `google_cloud_scheduler_job` for zombie detection (dev only — per user instruction)

---

## Task 1: Fix `validateOrchestratorSignature` to prefer `rawBody`

**Why first:** This is a tiny, self-contained fix that benefits every orchestrator-signed endpoint (heartbeat today, status-update next). Shipping it first means later tasks don't need to duplicate the logic.

**Files:**
- Modify: `apps/code-agent/src/infra/webhookValidation.ts:45-103`
- Test: `apps/code-agent/src/__tests__/infra/webhookValidation.test.ts`

- [ ] **Step 1: Read the current function and locate the line that stringifies `request.body`**

Open `apps/code-agent/src/infra/webhookValidation.ts`. The target block is the `validateOrchestratorSignature` function, specifically line 80:

```ts
const rawBody = JSON.stringify(request.body);
```

- [ ] **Step 2: Write a failing test proving the rawBody path is used when available**

Add to `apps/code-agent/src/__tests__/infra/webhookValidation.test.ts` (append to the existing `describe('validateOrchestratorSignature', ...)` block):

```ts
it('uses request.rawBody for HMAC when rawBody is attached, ignoring re-serialized body', () => {
  const secret = 'shared-orch-secret';
  // Simulate the bytes that the sender HMAC'd: a JSON string with key order and
  // whitespace that JSON.stringify(request.body) would NOT reproduce.
  const rawBody = '{"taskIds":["task_1","task_2"]}';
  const timestamp = Math.floor(Date.now() / 1000);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest('hex');

  // Inject a body whose re-serialization would DIFFER (keys reversed).
  const mutatedBody = { taskIds: ['task_1', 'task_2'], extraInjectedByAjv: true };

  const request = {
    headers: {
      'x-request-timestamp': String(timestamp),
      'x-request-signature': expected,
    },
    body: mutatedBody,
    rawBody,
  } as unknown as FastifyRequest;

  const result = validateOrchestratorSignature(request, { orchestratorSecret: secret });

  expect(result.ok).toBe(true);
});

it('falls back to JSON.stringify(body) when rawBody is absent', () => {
  const secret = 'shared-orch-secret';
  const body = { taskIds: ['a'] };
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest('hex');

  const request = {
    headers: {
      'x-request-timestamp': String(timestamp),
      'x-request-signature': expected,
    },
    body,
    // no rawBody
  } as unknown as FastifyRequest;

  const result = validateOrchestratorSignature(request, { orchestratorSecret: secret });

  expect(result.ok).toBe(true);
});
```

Ensure `crypto` is imported at the top of the test file if not already.

- [ ] **Step 3: Run the new tests; confirm the rawBody-preference test FAILS**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/infra/webhookValidation.test.ts -- --run
```

Expected: the first new test fails because the current code uses `JSON.stringify(request.body)`, producing a signature computed over `{"taskIds":["task_1","task_2"],"extraInjectedByAjv":true}` ≠ the `rawBody` used on the sender side. The second new test already passes (fallback path is equivalent to current code when rawBody is absent).

- [ ] **Step 4: Implement the minimal change**

In `apps/code-agent/src/infra/webhookValidation.ts`, replace line 80 inside `validateOrchestratorSignature`:

```ts
const rawBody = JSON.stringify(request.body);
```

with:

```ts
const attachedRaw = (request as unknown as { rawBody?: unknown }).rawBody;
const rawBody =
  typeof attachedRaw === 'string'
    ? attachedRaw
    : JSON.stringify(request.body);
```

Do NOT change `validateWebhookSignature` (per-task secret flow) in this PR — scope is limited to orchestrator-signed endpoints.

- [ ] **Step 5: Run tests; confirm PASS**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/infra/webhookValidation.test.ts -- --run
```

Expected: all tests in file pass, including the two new ones.

- [ ] **Step 6: Run the full code-agent workspace test suite**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: green. Existing tests for `validateOrchestratorSignature` still pass (the fallback path is byte-identical to the prior behavior when no `rawBody` is attached).

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/infra/webhookValidation.ts apps/code-agent/src/__tests__/infra/webhookValidation.test.ts
git commit -m "fix(code-agent): verify orchestrator HMAC over request.rawBody

Use the raw request bytes captured by the common-http content parser
instead of re-serializing the parsed body. Re-serialization is fragile
because ajv schema validation (useDefaults, coerceTypes, removeAdditional)
can mutate request.body in place, breaking signature verification silently.
Falls back to JSON.stringify(body) when rawBody is absent, so behavior is
unchanged for any callers that do not use the common-http plugin.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: New `updateTaskStatusRoute` in code-agent

**Files:**
- Create: `apps/code-agent/src/routes/code/updateTaskStatusRoute.ts`
- Create: `apps/code-agent/src/__tests__/routes/code/updateTaskStatusRoute.test.ts`
- Modify: `apps/code-agent/src/routes/code/index.ts`

- [ ] **Step 1: Write failing route test**

Create `apps/code-agent/src/__tests__/routes/code/updateTaskStatusRoute.test.ts`. Base it on the existing pattern in `apps/code-agent/src/__tests__/routes/code/github-event-log.test.ts` for `setServices` / `server.inject` / service construction. The test file MUST include:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { createFastifyPlugin } from '@intexuraos/common-http';
import { updateTaskStatusRoute } from '../../../routes/code/updateTaskStatusRoute.js';
import { setServices, resetServices, getServices } from '../../../services.js';
import { createFakeCodeTaskRepo } from '../../helpers/fakes.js'; // use the same fake pattern other tests use; if helper doesn't exist, inline a minimal in-memory fake — DO NOT mock Firestore directly
// … other imports following the pattern in neighboring test files

const ORCH_SECRET = 'test-orchestrator-secret';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

function signRequest(rawBody: string, secret: string, timestamp: number): string {
  return crypto.createHmac('sha256', secret).update(`${String(timestamp)}.${rawBody}`).digest('hex');
}

describe('PATCH /internal/code-tasks/:id/status', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    resetServices();
    // seed services per existing pattern in neighbor tests; include codeTaskRepo with a seeded task
    // the task must exist with status='running' so the update has something to modify
    const codeTaskRepo = createFakeCodeTaskRepo();
    await codeTaskRepo.create({ /* … minimal fields, id='task_abc', userId, status='running', webhookSecret, webhookUrl, etc. as required by the model */ });
    setServices({ ...getServices(), codeTaskRepo });

    server = Fastify();
    await server.register(createFastifyPlugin({ internalAuthToken: INTERNAL_AUTH_TOKEN }));
    await server.register(updateTaskStatusRoute);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 200 and writes terminal status to the repo', async () => {
    const body = {
      taskId: 'task_abc',
      status: 'failed',
      completedAt: '2026-04-17T18:10:27.316Z',
      error: { code: 'TASK_COMPLETION_VERIFICATION_FAILED', message: 'Missing fields: memory_acknowledgment' },
      result: { prUrl: 'https://github.com/example/repo/pull/1', branch: 'feature-branch' },
    };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(rawBody, ORCH_SECRET, timestamp);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_abc/status',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: true });

    const stored = await getServices().codeTaskRepo.findById('task_abc');
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.status).toBe('failed');
    expect(stored.value.completedAt?.toISOString()).toBe('2026-04-17T18:10:27.316Z');
    expect(stored.value.error?.code).toBe('TASK_COMPLETION_VERIFICATION_FAILED');
  });

  it('returns 200 no-op when task is already in a terminal state (idempotency)', async () => {
    // first call transitions to failed
    // second call with same or different terminal status should return 200 without changing status
    // implement per the same signing pattern
  });

  it('returns 401 when X-Internal-Auth is missing', async () => {
    const body = { taskId: 'task_abc', status: 'failed', completedAt: '2026-04-17T18:10:27.316Z' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(rawBody, ORCH_SECRET, timestamp);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_abc/status',
      headers: {
        'content-type': 'application/json',
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when HMAC signature is invalid', async () => {
    const body = { taskId: 'task_abc', status: 'failed', completedAt: '2026-04-17T18:10:27.316Z' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_abc/status',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': 'deadbeef',
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 404 when task does not exist', async () => {
    const body = { taskId: 'task_missing', status: 'failed', completedAt: '2026-04-17T18:10:27.316Z' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(rawBody, ORCH_SECRET, timestamp);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_missing/status',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when status is not a valid terminal status', async () => {
    const body = { taskId: 'task_abc', status: 'running', completedAt: '2026-04-17T18:10:27.316Z' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(rawBody, ORCH_SECRET, timestamp);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_abc/status',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(400);
  });

  it('HMAC verification is stable for array-containing unknown fields (regression guard)', async () => {
    // Simulate a future orchestrator body that includes an extra field with an array value.
    // The route declares additionalProperties:false so the extra field is rejected with 400
    // (NOT silently coerced). This proves the route will fail loudly instead of silently
    // breaking HMAC via ajv coercion — the exact failure mode that produced the stuck task.
    const body = {
      taskId: 'task_abc',
      status: 'failed',
      completedAt: '2026-04-17T18:10:27.316Z',
      unexpectedArrayField: ['one', 'two'],
    };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(rawBody, ORCH_SECRET, timestamp);

    const response = await server.inject({
      method: 'PATCH',
      url: '/internal/code-tasks/task_abc/status',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': INTERNAL_AUTH_TOKEN,
        'x-request-timestamp': String(timestamp),
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(400);
  });
});
```

Implementer note: if `createFakeCodeTaskRepo` does not exist as a helper, build a minimal in-memory repo inline that implements only `findById`, `update`. Do NOT mock the real `FirestoreCodeTaskRepository` — follow the repo-wide in-memory-fakes rule.

- [ ] **Step 2: Run tests; confirm all FAIL with "route not found" or "cannot find module"**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/routes/code/updateTaskStatusRoute.test.ts -- --run
```

Expected: all fail.

- [ ] **Step 3: Implement the route**

Create `apps/code-agent/src/routes/code/updateTaskStatusRoute.ts` with:

```ts
/**
 * PATCH /internal/code-tasks/:id/status
 *
 * Dedicated, minimal endpoint for the orchestrator to commit a terminal
 * task status to Firestore. Authed with the shared orchestratorSecret HMAC
 * (same scheme as /internal/code/heartbeat). Signature is verified over
 * request.rawBody to avoid the schema-coerces-body → HMAC-mismatch class
 * of failure that caused silent stuck tasks.
 *
 * Body schema is strict: primitives only, additionalProperties:false at
 * every level, enum-constrained status, no arrays, no defaults. ajv
 * cannot mutate the body.
 *
 * The handler performs one idempotent Firestore write. If the task is
 * already in a terminal state, it returns 200 without modification.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { validateOrchestratorSignature } from '../../infra/webhookValidation.js';
import { loadConfig } from '../../config.js';

interface UpdateTaskStatusBody {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  completedAt: string;
  error?: { code: string; message: string };
  result?: { prUrl?: string; branch?: string; summary?: string };
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'interrupted', 'cancelled']);

export const updateTaskStatusRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.patch<{ Params: { id: string }; Body: UpdateTaskStatusBody }>(
    '/internal/code-tasks/:id/status',
    {
      schema: {
        operationId: 'updateCodeTaskStatus',
        summary: 'Orchestrator commits terminal task status to Firestore',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId', 'status', 'completedAt'],
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string', enum: ['completed', 'failed', 'interrupted', 'cancelled'] },
            completedAt: { type: 'string', format: 'date-time' },
            error: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
            result: {
              type: 'object',
              additionalProperties: false,
              properties: {
                prUrl: { type: 'string' },
                branch: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateTaskStatusBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { message: 'Received request to PATCH /internal/code-tasks/:id/status' });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for update-task-status');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const signatureResult = validateOrchestratorSignature(request, {
        orchestratorSecret: loadConfig().orchestratorSecret,
      });
      if (!signatureResult.ok) {
        request.log.warn({ error: signatureResult.error }, 'Orchestrator signature validation failed');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { id } = request.params;
      const { taskId, status, completedAt, error, result } = request.body;

      if (taskId !== id) {
        return await reply.fail('INVALID_REQUEST', 'taskId in body does not match :id path parameter');
      }

      const { codeTaskRepo, logger } = getServices();

      const existing = await codeTaskRepo.findById(taskId);
      if (!existing.ok) {
        return await reply.fail('NOT_FOUND', 'Task not found');
      }
      const task = existing.value;

      if (TERMINAL_STATUSES.has(task.status)) {
        logger.info(
          { taskId, currentStatus: task.status, requestedStatus: status },
          'Task already terminal; no-op idempotent response'
        );
        return await reply.ok({ received: true });
      }

      const updateFields: Record<string, unknown> = {
        status,
        completedAt: new Date(completedAt),
      };
      if (error !== undefined) updateFields.error = error;
      if (result !== undefined) updateFields.result = result;

      const updateResult = await codeTaskRepo.update(taskId, updateFields);
      if (!updateResult.ok) {
        request.log.error({ taskId, error: updateResult.error }, 'Failed to update task status');
        return await reply.fail('INTERNAL_ERROR', 'Failed to update task status');
      }

      logger.info({ taskId, status }, 'Task status committed via /internal/code-tasks/:id/status');
      return await reply.ok({ received: true });
    }
  );

  done();
};
```

Notes:
- `reply.ok({ received: true })` / `reply.fail(...)` match the pattern used by `webhookRoutes.ts` and `taskEvent.ts`.
- No response schema with `additionalProperties: false` — keep the response open so fastify does not strip fields.
- `loadConfig().orchestratorSecret` is already used by the heartbeat route; reuse it verbatim.

- [ ] **Step 4: Register the route**

Edit `apps/code-agent/src/routes/code/index.ts` to export and register `updateTaskStatusRoute`. If the file uses a plugin-callback that registers multiple sub-routes, follow the existing pattern; otherwise export it alongside other routes and register from `apps/code-agent/src/routes/index.ts`. Exact edit:

```ts
// apps/code-agent/src/routes/code/index.ts
export { updateTaskStatusRoute } from './updateTaskStatusRoute.js';
```

Then in `apps/code-agent/src/routes/index.ts`, add the import and registration line:

```ts
import { updateTaskStatusRoute } from './code/index.js';
// …
  await app.register(updateTaskStatusRoute);
```

- [ ] **Step 5: Run tests; confirm PASS**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/routes/code/updateTaskStatusRoute.test.ts -- --run
```

Expected: all tests pass.

- [ ] **Step 6: Run the full code-agent workspace test suite**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: green. No regression in any other route.

- [ ] **Step 7: Commit**

```bash
git add apps/code-agent/src/routes/code/updateTaskStatusRoute.ts apps/code-agent/src/routes/code/index.ts apps/code-agent/src/routes/index.ts apps/code-agent/src/__tests__/routes/code/updateTaskStatusRoute.test.ts
git commit -m "feat(code-agent): add PATCH /internal/code-tasks/:id/status endpoint

Dedicated, minimal endpoint for the orchestrator to commit terminal task
status directly to Firestore, authed with the shared orchestratorSecret
HMAC (same scheme as /internal/code/heartbeat). Body schema uses
additionalProperties:false with primitive types only, so ajv cannot
mutate the body and HMAC is stable. Idempotent: returns 200 no-op when
task is already terminal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Orchestrator `StatusUpdateClient`

**Files:**
- Create: `workers/orchestrator/src/services/status-update-client.ts`
- Create: `workers/orchestrator/src/services/__tests__/status-update-client.test.ts`

- [ ] **Step 1: Write failing client tests**

Create `workers/orchestrator/src/services/__tests__/status-update-client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { pino } from 'pino';
import { StatusUpdateClient } from '../status-update-client.js';

const logger = pino({ level: 'silent' });

describe('StatusUpdateClient.commit', () => {
  beforeEach(() => {
    nock.cleanAll();
  });
  afterEach(() => {
    expect(nock.isDone()).toBe(true);
  });

  it('signs payload with orchestratorSecret and returns ok on 200', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: 'https://code-agent.test',
      orchestratorSecret: 'secret',
      internalAuthToken: 'internal',
      logger,
    });

    nock('https://code-agent.test')
      .patch('/internal/code-tasks/task_1/status', (body) => body.taskId === 'task_1' && body.status === 'failed')
      .matchHeader('x-internal-auth', 'internal')
      .matchHeader('x-request-signature', /^[a-f0-9]{64}$/)
      .matchHeader('x-request-timestamp', /^\d+$/)
      .reply(200, { received: true });

    const result = await client.commit({
      taskId: 'task_1',
      status: 'failed',
      completedAt: new Date('2026-04-17T18:10:27.316Z'),
      error: { code: 'X', message: 'y' },
    });

    expect(result.ok).toBe(true);
  });

  it('retries on 5xx with backoff and succeeds on eventual 200', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: 'https://code-agent.test',
      orchestratorSecret: 'secret',
      internalAuthToken: 'internal',
      logger,
      retryDelaysMs: [1, 1], // tiny delays in tests
    });

    nock('https://code-agent.test').patch('/internal/code-tasks/task_1/status').reply(500);
    nock('https://code-agent.test').patch('/internal/code-tasks/task_1/status').reply(200, { received: true });

    const result = await client.commit({
      taskId: 'task_1',
      status: 'completed',
      completedAt: new Date('2026-04-17T18:10:27.316Z'),
    });

    expect(result.ok).toBe(true);
  });

  it('does not retry on 4xx and returns err', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: 'https://code-agent.test',
      orchestratorSecret: 'secret',
      internalAuthToken: 'internal',
      logger,
      retryDelaysMs: [1, 1],
    });

    nock('https://code-agent.test').patch('/internal/code-tasks/task_1/status').reply(404);

    const result = await client.commit({
      taskId: 'task_1',
      status: 'failed',
      completedAt: new Date('2026-04-17T18:10:27.316Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('4xx');
    }
  });

  it('returns err after exhausting retries on persistent 5xx', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: 'https://code-agent.test',
      orchestratorSecret: 'secret',
      internalAuthToken: 'internal',
      logger,
      retryDelaysMs: [1, 1],
    });

    nock('https://code-agent.test').patch('/internal/code-tasks/task_1/status').times(3).reply(503);

    const result = await client.commit({
      taskId: 'task_1',
      status: 'failed',
      completedAt: new Date('2026-04-17T18:10:27.316Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('5xx');
    }
  });
});
```

- [ ] **Step 2: Run; confirm all FAIL with "cannot find module"**

```bash
pnpm --filter @intexuraos/orchestrator test src/services/__tests__/status-update-client.test.ts -- --run
```

- [ ] **Step 3: Implement the client**

Create `workers/orchestrator/src/services/status-update-client.ts`:

```ts
import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';

export interface StatusUpdateClientConfig {
  codeAgentUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  logger: Logger;
  retryDelaysMs?: number[]; // for tests; defaults to [1000, 3000, 9000]
  requestTimeoutMs?: number; // defaults to 15_000
}

export interface StatusUpdatePayload {
  taskId: string;
  status: 'completed' | 'failed' | 'interrupted' | 'cancelled';
  completedAt: Date;
  error?: { code: string; message: string };
  result?: { prUrl?: string; branch?: string; summary?: string };
}

export type StatusUpdateError =
  | { type: 'network'; message: string }
  | { type: '4xx'; status: number; message: string }
  | { type: '5xx'; status: number; message: string }
  | { type: 'timeout'; message: string };

export type StatusUpdateResult =
  | { ok: true }
  | { ok: false; error: StatusUpdateError };

const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 9000];
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class StatusUpdateClient {
  private readonly codeAgentUrl: string;
  private readonly orchestratorSecret: string;
  private readonly internalAuthToken: string;
  private readonly logger: Logger;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;

  constructor(config: StatusUpdateClientConfig) {
    this.codeAgentUrl = config.codeAgentUrl;
    this.orchestratorSecret = config.orchestratorSecret;
    this.internalAuthToken = config.internalAuthToken;
    this.logger = config.logger;
    this.retryDelaysMs = config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async commit(payload: StatusUpdatePayload): Promise<StatusUpdateResult> {
    const body = {
      taskId: payload.taskId,
      status: payload.status,
      completedAt: payload.completedAt.toISOString(),
      ...(payload.error !== undefined && { error: payload.error }),
      ...(payload.result !== undefined && { result: payload.result }),
    };
    const rawBody = JSON.stringify(body);

    let lastError: StatusUpdateError = { type: 'network', message: 'unknown' };
    const maxAttempts = this.retryDelaysMs.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const outcome = await this.deliver(payload.taskId, rawBody);

      if (outcome.ok) {
        if (attempt > 0) {
          this.logger.info(
            { taskId: payload.taskId, attempts: attempt + 1 },
            'Status update committed after retries'
          );
        }
        return { ok: true };
      }

      lastError = outcome.error;

      this.logger.warn(
        { taskId: payload.taskId, attempt: attempt + 1, errorType: outcome.error.type, errorMessage: outcome.error.message },
        'Status update attempt failed'
      );

      if (outcome.error.type === '4xx') {
        return { ok: false, error: outcome.error };
      }

      if (attempt < maxAttempts - 1) {
        const delay = this.retryDelaysMs[attempt] ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { ok: false, error: lastError };
  }

  private async deliver(
    taskId: string,
    rawBody: string
  ): Promise<{ ok: true } | { ok: false; error: StatusUpdateError }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', this.orchestratorSecret)
      .update(`${String(timestamp)}.${rawBody}`)
      .digest('hex');

    const url = `${this.codeAgentUrl}/internal/code-tasks/${taskId}/status`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timestamp': String(timestamp),
          'X-Request-Signature': signature,
          'X-Internal-Auth': this.internalAuthToken,
        },
        body: rawBody,
        signal: controller.signal,
      });

      if (response.ok) {
        return { ok: true };
      }

      const text = await response.text().catch(() => '');
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, error: { type: '4xx', status: response.status, message: text || `HTTP ${String(response.status)}` } };
      }
      return { ok: false, error: { type: '5xx', status: response.status, message: text || `HTTP ${String(response.status)}` } };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: { type: 'timeout', message: `Request timed out after ${String(this.requestTimeoutMs)}ms` } };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { type: 'network', message } };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

- [ ] **Step 4: Run; confirm PASS**

```bash
pnpm --filter @intexuraos/orchestrator test src/services/__tests__/status-update-client.test.ts -- --run
```

- [ ] **Step 5: Run the full orchestrator workspace test suite**

```bash
pnpm run verify:workspace:tracked -- orchestrator
```

- [ ] **Step 6: Commit**

```bash
git add workers/orchestrator/src/services/status-update-client.ts workers/orchestrator/src/services/__tests__/status-update-client.test.ts
git commit -m "feat(orchestrator): add StatusUpdateClient for direct status commit

HTTP client that commits terminal task status to the new code-agent
endpoint with retry on 5xx/network/timeout, immediate failure on 4xx,
and configurable retry delays for testability. Signs with the shared
orchestratorSecret (same scheme as heartbeat), not per-task webhookSecret.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Wire `StatusUpdateClient` into `TaskDispatcher.finalizeTask`

**Files:**
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` (constructor signature + finalizeTask body)
- Modify: `workers/orchestrator/src/start.ts` (construct StatusUpdateClient, inject into dispatcher)
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (cover the new call path)

- [ ] **Step 1: Write failing dispatcher test**

Append to `workers/orchestrator/src/__tests__/task-dispatcher.test.ts` (inside the existing `describe('TaskDispatcher', …)` or a new `describe('finalizeTask with StatusUpdateClient', …)` block):

```ts
it('finalizeTask calls statusUpdateClient.commit BEFORE the task-complete webhook', async () => {
  const commitCalls: Array<{ taskId: string; status: string }> = [];
  const webhookCalls: Array<{ url: string; payload: unknown }> = [];

  const fakeStatusClient = {
    commit: vi.fn(async (p: { taskId: string; status: string }) => {
      commitCalls.push(p);
      return { ok: true } as const;
    }),
  };
  const fakeWebhookClient = {
    send: vi.fn(async (args: { url: string; payload: unknown }) => {
      webhookCalls.push({ url: args.url, payload: args.payload });
      return { ok: true, value: undefined } as const;
    }),
    retryPending: vi.fn(async () => { /* no-op */ }),
    getPendingCount: vi.fn(async () => 0),
  };

  // Construct dispatcher with these fakes following the existing pattern.
  // Invoke finalizeTask on a task that is dispatchedOrRunning.
  // Assert commitCalls was populated first, then webhookCalls.

  expect(commitCalls[0]?.taskId).toBe(/* task id under test */);
  expect(commitCalls[0]?.status).toBe('failed');
  // Verify webhook was called after (array order reflects call order because both are awaited sequentially)
  expect(webhookCalls.length).toBeGreaterThan(0);
});

it('finalizeTask logs ERROR and still returns when statusUpdateClient.commit fails persistently', async () => {
  const fakeStatusClient = {
    commit: vi.fn(async () => ({ ok: false, error: { type: '5xx' as const, status: 503, message: 'svc unavailable' } })),
  };
  // remaining setup similar to the previous test
  // Assert that finalizeTask:
  //   - does not throw
  //   - writes an ERROR-level log line containing a stable tag (e.g. 'STATUS_UPDATE_COMMIT_FAILED')
  //   - still fires the task-complete webhook (best-effort side-effects)
  //   - still saves local state
});
```

- [ ] **Step 2: Run; confirm FAIL**

```bash
pnpm --filter @intexuraos/orchestrator test src/__tests__/task-dispatcher.test.ts -- --run
```

Expected: new tests fail because `TaskDispatcher` does not yet accept `statusUpdateClient`.

- [ ] **Step 3: Extend `TaskDispatcher` constructor**

In `workers/orchestrator/src/services/task-dispatcher.ts`, add to the constructor parameters a required `statusUpdateClient` dep with the shape `{ commit(payload): Promise<{ ok: true } | { ok: false; error: { type: '4xx'|'5xx'|'network'|'timeout'; … } }> }`. Define an interface `StatusUpdateClientShape` in the same file (or import the concrete type from `status-update-client.ts`).

Exact shape to import (recommended — avoids duplicate typing):

```ts
import type { StatusUpdateClient, StatusUpdatePayload } from './status-update-client.js';
```

Add `private readonly statusUpdateClient: StatusUpdateClient` to the class and wire it through the constructor signature.

- [ ] **Step 4: Update `finalizeTask` to call `statusUpdateClient.commit` before webhook**

Locate the block inside `finalizeTask` immediately before:

```ts
await this.webhookClient.send({
  url: task.webhookUrl,
  secret: task.webhookSecret,
  payload: { taskId: task.taskId, status: finalStatus, … },
  taskId: task.taskId,
});
```

(task-dispatcher.ts:2533). Insert ABOVE it:

```ts
const statusCommitResult = await this.statusUpdateClient.commit({
  taskId: task.taskId,
  status: finalStatus,
  completedAt: new Date(task.completedAt),
  ...(payload.error !== undefined && {
    error: { code: payload.error.code, message: payload.error.message },
  }),
  ...(payload.result !== undefined && {
    result: {
      ...(payload.result.prUrl !== undefined && { prUrl: payload.result.prUrl }),
      ...(payload.result.branch !== undefined && { branch: payload.result.branch }),
      ...(payload.result.summary !== undefined && { summary: payload.result.summary }),
    },
  }),
});
if (!statusCommitResult.ok) {
  this.logger.error(
    {
      taskId: task.taskId,
      tag: 'STATUS_UPDATE_COMMIT_FAILED',
      errorType: statusCommitResult.error.type,
      errorMessage: statusCommitResult.error.message,
    },
    'Failed to commit terminal status via /internal/code-tasks/:id/status; zombie watchdog will recover'
  );
  this.appendOrchestratorTaskLog(
    task.taskId,
    `STATUS_UPDATE_COMMIT_FAILED: type=${statusCommitResult.error.type} — zombie watchdog will recover`
  );
}
```

Do NOT block finalize on commit failure. Rationale: the zombie watchdog cron (Task 6) is the safety net, and we must not leave the Docker worker state half-torn-down because of a transient HTTP error. The ERROR log with the stable `STATUS_UPDATE_COMMIT_FAILED` tag makes the regression visible without turning a retry loop into a stuck finalize.

- [ ] **Step 5: Wire `StatusUpdateClient` construction in `start.ts`**

In `workers/orchestrator/src/start.ts` (near where `WebhookClient` is constructed), add:

```ts
import { StatusUpdateClient } from './services/status-update-client.js';
// …
const statusUpdateClient = new StatusUpdateClient({
  codeAgentUrl,
  orchestratorSecret,
  internalAuthToken,
  logger,
});
```

Pass it as a new constructor argument to `new TaskDispatcher(...)`. The three already-used values (`codeAgentUrl`, `orchestratorSecret`, `internalAuthToken`) are already loaded from env vars earlier in `start.ts` for the heartbeat manager.

- [ ] **Step 6: Run; confirm PASS**

```bash
pnpm --filter @intexuraos/orchestrator test -- --run
```

- [ ] **Step 7: Run the full tracked CI locally**

```bash
pnpm run ci:tracked
```

Expected: full green. Fix any regressions (likely in tests that construct `TaskDispatcher` without the new dep — update those test-helper fakes to pass a `{ commit: async () => ({ ok: true }) }` shim).

- [ ] **Step 8: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/start.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
# Plus any test-helper updates that were needed.
git commit -m "feat(orchestrator): commit terminal status via StatusUpdateClient in finalizeTask

finalizeTask now calls the new /internal/code-tasks/:id/status endpoint
before firing the existing task-complete webhook. This makes code-agent's
Firestore the single source of truth for status, with the webhook demoted
to side-effects (Linear labels, WhatsApp, etc.). If the commit fails,
finalize still returns (Docker teardown must not be blocked by a
transient HTTP error) and logs STATUS_UPDATE_COMMIT_FAILED — the zombie
watchdog cron recovers any slip-through.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Switch `findZombieTasks` to query `lastHeartbeat`

**Files:**
- Modify: `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts:663-685`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts` (findZombieTasks block at :1357)

- [ ] **Step 1: Update the unit test to assert the new query behavior**

In `firestoreCodeTaskRepository.test.ts` the existing `findZombieTasks` block seeds a task with `dispatchedAt` and tests "just the query works." Replace with an assertion that stale tasks ARE found by `lastHeartbeat`, and that tasks whose `updatedAt` was refreshed by an unrelated write but whose `lastHeartbeat` remains stale ARE still found:

```ts
describe('findZombieTasks', () => {
  it('finds tasks whose lastHeartbeat is older than threshold even when updatedAt is recent', async () => {
    const repo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createTaskInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Simulate a running task with stale heartbeat but recently touched updatedAt
    // (e.g. a PR merge webhook updated the task document).
    await repo.update(created.value.id, {
      status: 'running',
      lastHeartbeat: new Date(Date.now() - 40 * 60 * 1000), // 40 min ago
      updatedAt: new Date(), // just now (simulates unrelated write)
    });

    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const result = await repo.findZombieTasks(staleThreshold);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).toContain(created.value.id);
  });

  it('does NOT find tasks whose lastHeartbeat is recent', async () => {
    const repo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const created = await repo.create(createTaskInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await repo.update(created.value.id, {
      status: 'running',
      lastHeartbeat: new Date(), // fresh
    });

    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000);
    const result = await repo.findZombieTasks(staleThreshold);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).not.toContain(created.value.id);
  });

  it('returns empty array when no zombie tasks', async () => {
    const repo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const result = await repo.findZombieTasks(staleThreshold);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
```

Implementer note: FakeFirestore used in these tests must support querying on `lastHeartbeat`. If it already supports querying on arbitrary fields (which it does based on the original test), no fake extension is needed — just verify.

- [ ] **Step 2: Run; confirm first new test FAILS**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -- --run -t findZombieTasks
```

Expected: the "recently updated" test fails because the current query filters on `updatedAt`.

- [ ] **Step 3: Change the query**

In `apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts`, locate `findZombieTasks` (around line 663). Replace:

```ts
.where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
.where('updatedAt', '<', Timestamp.fromDate(staleThreshold))
```

with:

```ts
.where('status', 'in', DISPATCHED_OR_RUNNING_STATUSES)
.where('lastHeartbeat', '<', Timestamp.fromDate(staleThreshold))
```

Update the inline comment block directly above the query to explain why `lastHeartbeat` (written only by the heartbeat endpoint) is the correct staleness signal and `updatedAt` is not (it is written by unrelated events like PR merge webhooks).

- [ ] **Step 4: Run; confirm PASS**

```bash
pnpm --filter @intexuraos/code-agent test src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts -- --run -t findZombieTasks
```

- [ ] **Step 5: Create Firestore composite index migration**

The new query is `status in [dispatched, running] AND lastHeartbeat <`. This is a composite query that requires an index. Migrations in this repo follow the pattern at `migrations/096_mobile-notifications-digest-time-range-index.mjs`.

Create `migrations/097_code-tasks-zombie-lastHeartbeat-index.mjs`:

```javascript
/**
 * Migration 097: Composite index for findZombieTasks on lastHeartbeat
 *
 * Required by code-agent findZombieTasks query:
 *   where('status', 'in', ['dispatched', 'running'])
 *   where('lastHeartbeat', '<', staleThreshold)
 *
 * Replaces the previous updatedAt-based staleness query, which was
 * vulnerable to false refresh from unrelated writes (e.g. PR merge
 * webhooks setting prMergedAt, which bumped updatedAt).
 */

export const metadata = {
  id: '097',
  name: 'code-tasks-zombie-lastHeartbeat-index',
  description: 'Composite index for findZombieTasks(status, lastHeartbeat)',
  createdAt: '2026-04-17',
};

export const indexes = [
  {
    collectionGroup: 'code_tasks',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'lastHeartbeat', order: 'ASCENDING' },
    ],
  },
];

export const collections = ['code_tasks'];

export async function up(context) {
  console.log('  Deploying code_tasks zombie-detection composite index...');
  await context.deployIndexes();
}

export async function down() {
  console.log('  Removing the composite index requires manual deletion via Firebase console');
}
```

- [ ] **Step 6: Regenerate `firestore.indexes.json`**

`firestore.indexes.json` is tracked in git (not gitignored; only `firestore.rules` is). Regenerate it from the aggregated migrations:

```bash
node scripts/generate-firestore-config.mjs
```

Expected stdout: `✓ Generated firestore.indexes.json`. The regenerated file will contain the new `code_tasks` composite index alongside all existing indexes.

- [ ] **Step 7: Run full code-agent tracked CI**

```bash
pnpm run verify:workspace:tracked -- code-agent
```

- [ ] **Step 8: Commit**

```bash
git add apps/code-agent/src/infra/repositories/firestoreCodeTaskRepository.ts \
        apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts \
        migrations/097_code-tasks-zombie-lastHeartbeat-index.mjs \
        firestore.indexes.json
git commit -m "fix(code-agent): query findZombieTasks on lastHeartbeat instead of updatedAt

updatedAt is refreshed by unrelated writes (PR merge webhooks, Linear
event ingestion, etc.) so a running-but-silent task can mask as fresh
indefinitely. lastHeartbeat is written only by the heartbeat endpoint
and is the correct staleness signal. Adds migration 097 with composite
index on (status, lastHeartbeat) and regenerated firestore.indexes.json.
Migration auto-applies on PR merge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Cloud Scheduler cron for `detect-zombies` (dev only)

**Files:**
- Modify: `terraform/environments/dev/main.tf`

Per user instruction: this change goes in dev only. Prod and dev share Firestore, so a dev-triggered sweep recovers both environments' tasks when the orchestrator writes the shared collection. If prod operates independently, replicate this block in `terraform/environments/prod/main.tf` later — out of scope for this PR.

- [ ] **Step 1: Read the existing schedulers in the file to match the pattern**

Open `terraform/environments/dev/main.tf` and find the block around line 1789 (`google_cloud_scheduler_job "cron_agent_tick"`). Use this as the pattern. Also find the `google_cloud_run_service_iam_member` pattern that grants `scheduler@` invoker on each Cloud Run service — confirm a similar grant exists or must be added for `intexuraos-code-agent`.

Search for existing code-agent scheduler invoker grant:

```bash
grep -n "scheduler.*code_agent\|code_agent.*scheduler" terraform/environments/dev/main.tf || echo "not found"
```

- [ ] **Step 2: Add the scheduler job (and invoker IAM if missing)**

Append to `terraform/environments/dev/main.tf` (below the `cron_agent_tick` block is a good spot):

```hcl
# Grant the shared Cloud Scheduler SA invoker on code-agent (no-op if already granted).
resource "google_cloud_run_service_iam_member" "scheduler_invokes_code_agent" {
  project  = var.project_id
  location = var.region
  service  = local.services.code_agent.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_scheduler.email}"

  depends_on = [module.code_agent]
}

resource "google_cloud_scheduler_job" "code_tasks_zombie_sweep" {
  name        = "intexuraos-code-tasks-zombie-sweep-${var.environment}"
  description = "Sweep stuck code tasks (status in dispatched/running with stale lastHeartbeat) and mark them interrupted"
  schedule    = "*/5 * * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://${local.services.code_agent.name}-${local.cloud_run_url_suffix}/internal/code/detect-zombies"
    body        = base64encode("{}")

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = "https://${local.services.code_agent.name}-${local.cloud_run_url_suffix}"
    }

    headers = {
      "Content-Type" = "application/json"
      "X-Internal-Auth" = var.internal_auth_token
    }
  }

  retry_config {
    retry_count          = 1
    min_backoff_duration = "30s"
    max_backoff_duration = "120s"
  }

  depends_on = [
    google_cloud_run_service_iam_member.scheduler_invokes_code_agent,
    module.code_agent,
  ]
}
```

Implementer note: inspect the actual variable and local names in the file — `var.internal_auth_token`, `local.services.code_agent.name`, `local.cloud_run_url_suffix`, `google_service_account.cloud_scheduler`, `module.code_agent` may be named differently. Match the existing conventions used by `cron_agent_tick` and `linear_sync_hourly`. Do NOT duplicate the invoker IAM resource if one already exists for code-agent — reuse it.

Also confirm how `X-Internal-Auth` is handled for other scheduler-invoked endpoints in this file. If the existing pattern relies on OIDC only and reads the header through a wrapper, adapt to match. The `/internal/code/detect-zombies` handler currently requires `X-Internal-Auth` (see `codeRoutes.ts:3405-3409`).

- [ ] **Step 3: Validate Terraform**

```bash
cd terraform/environments/dev
terraform fmt
terraform validate
cd - > /dev/null
```

Expected: formatted without changes, validate passes.

- [ ] **Step 4: Plan against dev project**

```bash
cd terraform/environments/dev
terraform plan -var-file=... # match existing pattern in repo
cd - > /dev/null
```

Confirm the plan shows exactly two additions: the IAM member (if needed) and the scheduler job. Abort if anything else is modified. Do NOT apply from this plan — the PR review is the gate.

- [ ] **Step 5: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "chore(terraform/dev): schedule code-tasks zombie sweep every 5 minutes

Cloud Scheduler hits /internal/code/detect-zombies every 5 minutes.
Dev and prod share Firestore, so dev's scheduler recovers both. The
endpoint already existed as dead code — this turns it on. Belt-and-
suspenders under the new status-update endpoint from Tasks 1-4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: End-to-end regression test

**Why:** One test that would have caught the original `manualSteps` bug and its equivalents: a real `task-complete`-shaped payload, signed correctly, round-tripped through the code-agent route, landing in Firestore via the new endpoint.

**Files:**
- Create: `workers/orchestrator/src/__tests__/integration/status-update-e2e.test.ts`

- [ ] **Step 1: Write the test**

Create `workers/orchestrator/src/__tests__/integration/status-update-e2e.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { createFastifyPlugin } from '@intexuraos/common-http';
import { updateTaskStatusRoute } from '../../../../apps/code-agent/src/routes/code/updateTaskStatusRoute.js';
import { setServices, resetServices, getServices } from '../../../../apps/code-agent/src/services.js';
import { StatusUpdateClient } from '../../services/status-update-client.js';
import { pino } from 'pino';

const ORCH_SECRET = 'shared-secret';
const INTERNAL = 'internal-auth';

describe('StatusUpdateClient ↔ updateTaskStatusRoute end-to-end', () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
    const app = Fastify();
    await app.register(createFastifyPlugin({ internalAuthToken: INTERNAL }));
    await app.register(updateTaskStatusRoute);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('unexpected server address');
    }
    return { url: `http://127.0.0.1:${String(address.port)}`, close: async () => await app.close() };
  }

  beforeEach(async () => {
    resetServices();
    // seed in-memory codeTaskRepo with a running task
    const inMemoryRepo = /* construct a minimal fake — same helper pattern used in updateTaskStatusRoute.test.ts */;
    await inMemoryRepo.create({ id: 'task_int', status: 'running', /* … */ });
    setServices({ ...getServices(), codeTaskRepo: inMemoryRepo });
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('orchestrator client commits status and code-agent persists it', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: server.url,
      orchestratorSecret: ORCH_SECRET,
      internalAuthToken: INTERNAL,
      logger: pino({ level: 'silent' }),
    });

    const result = await client.commit({
      taskId: 'task_int',
      status: 'failed',
      completedAt: new Date('2026-04-17T18:10:27.316Z'),
      error: { code: 'TASK_COMPLETION_VERIFICATION_FAILED', message: 'Missing fields: memory_acknowledgment' },
      result: { prUrl: 'https://github.com/x/y/pull/1', branch: 'fix/x' },
    });

    expect(result.ok).toBe(true);

    const stored = await getServices().codeTaskRepo.findById('task_int');
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.status).toBe('failed');
    expect(stored.value.error?.code).toBe('TASK_COMPLETION_VERIFICATION_FAILED');
  });
});
```

Implementer note: this test crosses package boundaries (orchestrator test importing from code-agent). If the monorepo's test config / path mapping does not allow that, either:
- place the test inside `apps/code-agent/src/__tests__/integration/` and import `StatusUpdateClient` from `workers/orchestrator` instead, OR
- keep it where it is and add a path mapping, OR
- inline a minimal fake of the code-agent route using the same body schema and signature validation logic (acceptable as a fallback — the Task 2 test already covers the route in isolation; this integration test's value is the client-server round-trip).

- [ ] **Step 2: Run; confirm PASS**

Run whichever workspace the test ended up in.

- [ ] **Step 3: Commit**

```bash
git add <paths>
git commit -m "test: add end-to-end regression for status-update endpoint round-trip

Signs a realistic task-complete payload with the orchestrator client and
verifies the code-agent route persists it. Catches the whole class of
'schema coerces body, HMAC mismatches, task stays running' bugs that
the old task-complete webhook was vulnerable to.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Final Steps

- [ ] **Step 1: Run the full tracked CI locally from repo root**

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-final.txt
```

Expected: complete green. Any failure in any workspace must be resolved before commit per the project's Commit Gate.

- [ ] **Step 2: Push the feature branch and open the PR**

Branch name: `fix/robust-task-finalize` (no INT-XXX prefix — user explicitly said no Linear issue). Target: `development`.

PR title: `fix: make task finalization robust via dedicated status endpoint`

PR body:

```
## Summary

Eliminates the "stuck in `running`" class of bugs. Orchestrator now
commits terminal task status via a new dedicated, minimal endpoint
(`PATCH /internal/code-tasks/:id/status`) authed with the shared
orchestratorSecret HMAC. The old `task-complete` webhook is demoted to
side-effects (Linear labels, WhatsApp, etc.) and no longer load-bearing
for status.

Defense in depth: zombie watchdog cron now actually runs (every 5 min)
and queries on `lastHeartbeat` instead of `updatedAt` (which was being
falsely refreshed by unrelated webhooks like PR merges).

Triggered by investigation of task_103bd7e0-5b25-4842-a493-a5ffdc8f3d46
where `manualSteps: string[]` in the orchestrator payload was coerced
to `string` by ajv on the receiving side, breaking the HMAC and
returning 401 — silently dropped by the webhook client because 4xx is
not retried. HMAC now verified against `request.rawBody`, so schema
coercion can never break signatures again.

## Changes

- `fix(code-agent)`: `validateOrchestratorSignature` prefers `request.rawBody`
- `feat(code-agent)`: new `PATCH /internal/code-tasks/:id/status` endpoint
- `feat(orchestrator)`: `StatusUpdateClient` with retry + 4xx-no-retry
- `feat(orchestrator)`: `finalizeTask` commits status before firing webhook
- `fix(code-agent)`: `findZombieTasks` filters on `lastHeartbeat`
- `chore(terraform/dev)`: Cloud Scheduler cron for `/internal/code/detect-zombies`
- `test`: end-to-end regression for the orchestrator→code-agent round-trip

## Endpoint Changes

- **Created:** `PATCH /internal/code-tasks/:id/status`
- **Modified:** none
- **Removed:** none
- **Unchanged:** all existing endpoints

## Test plan

- [x] Unit tests per task
- [x] End-to-end integration test
- [x] `pnpm run ci:tracked` green locally
- [ ] After merge: manually resolve `task_103bd7e0-5b25-4842-a493-a5ffdc8f3d46` (set status=failed in Firestore — owner will do once PR merges)
- [ ] After merge: Terraform apply for dev scheduler
```

---

## Self-Review Checklist

**Spec coverage:**
- Dedicated endpoint → Task 2 ✓
- Simple authorization with existing secrets → Tasks 1, 2 (validateOrchestratorSignature + internal auth, both already used by heartbeat) ✓
- Orchestrator calls it from finalize → Task 4 ✓
- Zombie watchdog turned on → Task 6 ✓
- `lastHeartbeat` used for staleness → Task 5 ✓
- Dev terraform only → Task 6 ✓
- No INT-XXX → Final steps ✓
- Commit + push + PR → Final steps ✓

**Placeholder scan:** All steps include actual code or exact commands. No "TBD", no "add error handling as appropriate." A few places flag implementation discretion (e.g. fake helpers, terraform variable names, route-registration pattern) but they point at concrete existing files to mirror.

**Type consistency:**
- `StatusUpdatePayload` defined in Task 3, consumed in Task 4 — fields match.
- `StatusUpdateError` defined in Task 3, consumed in Task 4 `statusCommitResult.error.type` check — union covers `4xx | 5xx | network | timeout`, matches.
- `UpdateTaskStatusBody` (route) and `StatusUpdatePayload` (client): route body requires `taskId`, `status`, `completedAt`; client payload is `taskId`, `status`, `completedAt` (Date, ISO-stringified at call site) — match.
