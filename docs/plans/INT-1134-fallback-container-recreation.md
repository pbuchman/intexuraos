# INT-1134: Fallback Container Recreation on Message Send — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user sends a message to a task whose container has been destroyed (pruned after inactivity), transparently recreate a new container using dispatch metadata from code-agent and deliver the message — instead of returning a `not_found` error.

**Architecture:** The orchestrator's `sendMessage` handler gets a fallback path: when a task is not found in local state persistence, it calls code-agent's `GET /internal/tasks/:id/dispatch-metadata` endpoint to retrieve original task configuration, reconstructs a minimal `Task` object, creates a fresh worktree, builds a system prompt, and starts a new container with the user's message. The code-agent endpoint is extended with three additional fields required for complete task reconstruction. The web-app requires no changes — it already handles the `{ action: 'resumed' }` response.

**Tech Stack:** TypeScript, Fastify (code-agent), Docker container lifecycle (orchestrator), nock (HTTP mocking), vitest

---

## Shared Contract

Both subtasks depend on this agreed-upon API contract for the dispatch-metadata response. The **orchestrator consumes** this contract; **code-agent produces** it.

```typescript
// GET /internal/tasks/:taskId/dispatch-metadata — Response (200 OK)
{
  // ── Existing fields (unchanged) ──
  taskId: string;
  prompt: string;
  repository: string;
  baseBranch: string;
  agentType: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | null;
  workerType: string;
  linearIssueId: string | null;
  webhookSecret: string | null;
  prNumber: number | null;

  // ── NEW fields (INT-1134) ──
  webhookUrl: string;                    // Always present — code-agent constructs from its serviceUrl config
  continuationPrBranch: string | null;   // From Firestore `prBranch` field — allows worktree checkout of existing PR branch
  trackingCommentId: string | null;      // From Firestore `trackingCommentId` — included in system prompt for PR comment tracking
}
```

**Error contract (unchanged):** 404 with `{ success: false, error: { code: 'NOT_FOUND', message: '...' } }` when task doesn't exist in Firestore.

## Endpoint Changes

### Modified
- `GET /internal/tasks/:taskId/dispatch-metadata` (code-agent) — Add `webhookUrl`, `continuationPrBranch`, `trackingCommentId` to response

### Unchanged
- `POST /tasks/:taskId/messages` (orchestrator, via code-agent proxy) — Same HTTP request/response contract; new server-side fallback behavior is transparent to callers

---

## Task 1: Code-Agent App — Extend dispatch-metadata response

**Files:**
- Modify: `apps/code-agent/src/routes/internalRoutes.ts:197-301` (response schema + handler)
- Modify: `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts` (update tests)

**Context for implementer:**
- The `serviceUrl` config is available via `getServices().serviceUrl` (see `apps/code-agent/src/services.ts:141`)
- The webhook URL pattern is: `${serviceUrl}/internal/webhooks/task-complete` (see `apps/code-agent/src/domain/usecases/drainTaskQueue.ts:325`)
- The Firestore `CodeTask` model already has `prBranch` and `trackingCommentId` fields (see `apps/code-agent/src/domain/models/codeTask.ts`)

---

- [ ] **Step 1: Write failing test for new response fields**

Open `apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts`. The existing success test (`returns 200 with dispatch metadata for a known task`, around line 135) asserts 9 fields. Add a new test that validates the three new fields:

```typescript
it('returns new INT-1134 fields in dispatch metadata', async () => {
  const result = await codeTaskRepo.create({
    userId: 'user-1',
    prompt: 'Fix the bug',
    sanitizedPrompt: 'Fix the bug',
    systemPromptHash: 'hash-1',
    workerType: 'qwen',
    workerLocation: 'home-mac',
    repository: 'intexuraos/test',
    baseBranch: 'main',
    traceId: 'trace-1',
    agentType: 'execution',
    linearIssueId: 'INT-999',
    webhookSecret: 'secret-abc',
    prNumber: 42,
    prBranch: 'feature/int-999',
    trackingCommentId: 'comment-123',
  });
  if (!result.ok) throw new Error('Failed to create task');

  const response = await server.inject({
    method: 'GET',
    url: `/internal/tasks/${result.value.id}/dispatch-metadata`,
    headers: { 'x-internal-auth': process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '' },
  });

  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.webhookUrl).toBe('http://localhost:8080/internal/webhooks/task-complete');
  expect(body.continuationPrBranch).toBe('feature/int-999');
  expect(body.trackingCommentId).toBe('comment-123');
});
```

Also update the existing `returns null for optional fields when not set on the task` test to assert the new nullable fields:

```typescript
// Add to existing assertions in that test:
expect(body.continuationPrBranch).toBeNull();
expect(body.trackingCommentId).toBeNull();
// webhookUrl should always be present even for minimal tasks:
expect(body.webhookUrl).toBe('http://localhost:8080/internal/webhooks/task-complete');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: Tests fail because the response doesn't include `webhookUrl`, `continuationPrBranch`, or `trackingCommentId`.

- [ ] **Step 3: Update response schema and handler**

In `apps/code-agent/src/routes/internalRoutes.ts`, update the response schema (around line 215) to add the three new properties:

```typescript
// Inside the 200 response schema properties object, ADD:
webhookUrl: { type: 'string' },
continuationPrBranch: { type: ['string', 'null'] },
trackingCommentId: { type: ['string', 'null'] },
```

Update the `required` array to include the new fields:

```typescript
required: ['taskId', 'prompt', 'repository', 'baseBranch', 'agentType', 'workerType', 'linearIssueId', 'webhookSecret', 'prNumber', 'webhookUrl', 'continuationPrBranch', 'trackingCommentId'],
```

Update the handler (around line 279) to include the new fields in the response:

```typescript
const { codeTaskRepo, serviceUrl } = getServices();

// ... existing findById logic ...

const task = findResult.value;

// @allow-raw-send: internal endpoint returns structured dispatch metadata directly
return await reply.send({
  taskId: task.id,
  prompt: task.prompt,
  repository: task.repository,
  baseBranch: task.baseBranch,
  agentType: task.agentType ?? null,
  workerType: task.workerType,
  linearIssueId: task.linearIssueId ?? null,
  webhookSecret: task.webhookSecret ?? null,
  prNumber: task.prNumber ?? null,
  // INT-1134: fields for fallback container recreation
  webhookUrl: `${serviceUrl}/internal/webhooks/task-complete`,
  continuationPrBranch: task.prBranch ?? null,
  trackingCommentId: task.trackingCommentId ?? null,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm run verify:workspace:tracked -- code-agent`

Expected: All tests pass, including the new assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/internalRoutes.ts apps/code-agent/src/__tests__/routes/internalDispatchMetadata.test.ts
git commit -m "feat(code-agent): add webhookUrl, continuationPrBranch, trackingCommentId to dispatch-metadata

INT-1134: Extend the GET /internal/tasks/:taskId/dispatch-metadata endpoint
with three additional fields needed for fallback container recreation:
- webhookUrl: constructed from serviceUrl config
- continuationPrBranch: from Firestore prBranch field
- trackingCommentId: from Firestore trackingCommentId field"
```

---

## Task 2: Orchestrator Worker — Implement fallback sendMessage flow

**Files:**
- Create: `workers/orchestrator/src/services/dispatch-metadata-client.ts`
- Create: `workers/orchestrator/src/__tests__/dispatch-metadata-client.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts:585-674`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`

**Context for implementer:**
- The `sendMessage` handler is at `workers/orchestrator/src/services/task-dispatcher.ts:585-674`
- The TODO to replace: `// TODO(INT-1130): call code-agent /internal/tasks/:id/dispatch-metadata when task not in state` (line 599)
- Existing HTTP client pattern for code-agent calls: `workers/orchestrator/src/services/deep-validator-helpers.ts:62-113` (uses native `fetch` with `AbortSignal.timeout()`)
- The `OrchestratorConfig` already has `codeAgentUrl` and `internalAuthToken` (lines 155, 161 in `types/config.ts`)
- `buildSystemPrompt` is in `workers/orchestrator/src/services/system-prompt.ts:1031-1057`
- `buildResumePreamble` is a private method on `TaskDispatcher` at line 1454
- The test file mocks code-agent helpers at module level: `vi.mock('../services/deep-validator-helpers.js', ...)`

**Design decisions:**
- The fallback returns `{ action: 'resumed' }` — same as normal resume. No UI changes needed.
- `linearIssueLabels` is NOT stored in code-agent's Firestore (stripped as legacy). Use `[]` — the `agentType` field from dispatch-metadata is the primary routing key for `buildSystemPrompt`, so empty labels don't affect prompt routing when `agentType` is present.
- `linearIssueTitle` is NOT available. It's optional in `SystemPromptParams` and only adds minor context to prompts.
- If `webhookSecret` is null from dispatch-metadata, use empty string. The `LogForwarder` has a derivation fallback using `orchestratorSecret + taskId`.
- Container creation is async (same pattern as existing resume flow). The method returns immediately after saving the task to state.

---

### Part A: fetchDispatchMetadata HTTP client

- [ ] **Step 1: Write failing tests for fetchDispatchMetadata**

Create `workers/orchestrator/src/__tests__/dispatch-metadata-client.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { fetchDispatchMetadata } from '../services/dispatch-metadata-client.js';

const CODE_AGENT_URL = 'http://localhost:8080';
const AUTH_TOKEN = 'test-internal-auth-token';
const TASK_ID = 'task_abc123';

const mockLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => mockLogger,
} as never;

describe('fetchDispatchMetadata', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('returns dispatch metadata on success', async () => {
    const metadata = {
      taskId: TASK_ID,
      prompt: 'Fix the bug',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      agentType: 'execution',
      workerType: 'opus',
      linearIssueId: 'INT-999',
      webhookSecret: 'secret-abc',
      prNumber: 42,
      webhookUrl: 'http://code-agent/internal/webhooks/task-complete',
      continuationPrBranch: 'feature/int-999',
      trackingCommentId: 'comment-123',
    };

    nock(CODE_AGENT_URL)
      .get(`/internal/tasks/${TASK_ID}/dispatch-metadata`)
      .matchHeader('x-internal-auth', AUTH_TOKEN)
      .reply(200, metadata);

    const result = await fetchDispatchMetadata(
      TASK_ID,
      { codeAgentUrl: CODE_AGENT_URL, internalAuthToken: AUTH_TOKEN },
      mockLogger
    );

    expect(result).toEqual(metadata);
  });

  it('returns null when task not found (404)', async () => {
    nock(CODE_AGENT_URL)
      .get(`/internal/tasks/${TASK_ID}/dispatch-metadata`)
      .reply(404, { success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

    const result = await fetchDispatchMetadata(
      TASK_ID,
      { codeAgentUrl: CODE_AGENT_URL, internalAuthToken: AUTH_TOKEN },
      mockLogger
    );

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    nock(CODE_AGENT_URL)
      .get(`/internal/tasks/${TASK_ID}/dispatch-metadata`)
      .replyWithError('Connection refused');

    const result = await fetchDispatchMetadata(
      TASK_ID,
      { codeAgentUrl: CODE_AGENT_URL, internalAuthToken: AUTH_TOKEN },
      mockLogger
    );

    expect(result).toBeNull();
  });

  it('returns null on non-200 response', async () => {
    nock(CODE_AGENT_URL)
      .get(`/internal/tasks/${TASK_ID}/dispatch-metadata`)
      .reply(500, { error: 'Internal server error' });

    const result = await fetchDispatchMetadata(
      TASK_ID,
      { codeAgentUrl: CODE_AGENT_URL, internalAuthToken: AUTH_TOKEN },
      mockLogger
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && npx vitest run workers/orchestrator/src/__tests__/dispatch-metadata-client.test.ts`

Expected: Fails because `dispatch-metadata-client.ts` doesn't exist yet.

- [ ] **Step 3: Implement fetchDispatchMetadata**

Create `workers/orchestrator/src/services/dispatch-metadata-client.ts`:

```typescript
import type { Logger } from '@intexuraos/common-core';
import type { CodeAgentClientConfig } from './deep-validator-helpers.js';

export interface DispatchMetadata {
  taskId: string;
  prompt: string;
  repository: string;
  baseBranch: string;
  agentType: 'planning' | 'execution' | 'pull_request' | 'review' | 'remediation' | null;
  workerType: string;
  linearIssueId: string | null;
  webhookSecret: string | null;
  prNumber: number | null;
  webhookUrl: string;
  continuationPrBranch: string | null;
  trackingCommentId: string | null;
}

/**
 * Fetches dispatch metadata from code-agent for a task that has been pruned
 * from orchestrator state. Returns null if the task is not found or on error.
 */
export async function fetchDispatchMetadata(
  taskId: string,
  config: CodeAgentClientConfig,
  logger: Logger
): Promise<DispatchMetadata | null> {
  const { codeAgentUrl, internalAuthToken, timeoutMs = 10_000 } = config;
  try {
    const url = `${codeAgentUrl}/internal/tasks/${encodeURIComponent(taskId)}/dispatch-metadata`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Internal-Auth': internalAuthToken,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logger.warn(
        { taskId, status: response.status },
        'Failed to fetch dispatch metadata from code-agent'
      );
      return null;
    }

    return (await response.json()) as DispatchMetadata;
  } catch (error) {
    logger.warn(
      { taskId, error: error instanceof Error ? error.message : String(error) },
      'Failed to fetch dispatch metadata from code-agent'
    );
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && npx vitest run workers/orchestrator/src/__tests__/dispatch-metadata-client.test.ts`

Expected: All 4 tests pass.

**Note:** If `nock` does not intercept native `fetch` in this Node version, the implementer should check how `deep-validator-helpers.ts` tests handle this (it uses the same `fetch` pattern). An alternative is using `vi.spyOn(globalThis, 'fetch')` for mocking.

- [ ] **Step 5: Commit**

```bash
git add workers/orchestrator/src/services/dispatch-metadata-client.ts workers/orchestrator/src/__tests__/dispatch-metadata-client.test.ts
git commit -m "feat(orchestrator): add fetchDispatchMetadata HTTP client

INT-1134: New module to fetch task dispatch metadata from code-agent's
GET /internal/tasks/:id/dispatch-metadata endpoint. Returns DispatchMetadata
on success, null on 404 or error. Follows existing code-agent HTTP client
pattern (native fetch + AbortSignal.timeout)."
```

---

### Part B: sendMessage fallback — synchronous path

- [ ] **Step 6: Add module mock and write failing test for fallback recreation**

In `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`:

**Add the module mock** near the top of the file (alongside existing `vi.mock` calls around line 29):

```typescript
vi.mock('../services/dispatch-metadata-client.js', () => ({
  fetchDispatchMetadata: vi.fn().mockResolvedValue(null),
}));
```

**Add the import** below the existing mock imports:

```typescript
import { fetchDispatchMetadata } from '../services/dispatch-metadata-client.js';
const mockFetchDispatchMetadata = vi.mocked(fetchDispatchMetadata);
```

**Add a new test** inside the existing `describe('sendMessage', ...)` block:

```typescript
it('recreates container from dispatch metadata when task not in state', async () => {
  mockFetchDispatchMetadata.mockResolvedValueOnce({
    taskId: 'recreate-task',
    prompt: 'Original prompt',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    agentType: 'execution',
    workerType: 'opus',
    linearIssueId: 'INT-999',
    webhookSecret: 'secret-123',
    prNumber: 42,
    webhookUrl: 'https://code-agent/internal/webhooks/task-complete',
    continuationPrBranch: 'feature/int-999',
    trackingCommentId: null,
  });

  const result = await dispatcher.sendMessage('recreate-task', 'Follow-up message');
  await flushAsync();

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ action: 'resumed' });
  }

  // Verify fetchDispatchMetadata was called with correct params
  expect(mockFetchDispatchMetadata).toHaveBeenCalledWith(
    'recreate-task',
    { codeAgentUrl: mockConfig.codeAgentUrl, internalAuthToken: mockConfig.internalAuthToken },
    expect.anything()
  );

  // Verify task was saved to state
  const state = await statePersistence.load();
  const task = state.tasks['recreate-task'];
  expect(task).toBeDefined();
  expect(task?.status).toBe('running');
  expect(task?.webhookUrl).toBe('https://code-agent/internal/webhooks/task-complete');
  expect(task?.agentType).toBe('execution');
  expect(task?.baseBranch).toBe('development');
  expect(task?.continuationPrNumber).toBe(42);
  expect(task?.continuationPrBranch).toBe('feature/int-999');
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd /repo && npx vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "recreates container from dispatch metadata"`

Expected: Fails because `sendMessage` still returns `not_found` for unknown tasks.

- [ ] **Step 8: Implement fallback logic in sendMessage**

In `workers/orchestrator/src/services/task-dispatcher.ts`:

**Add import** at the top of the file:

```typescript
import { fetchDispatchMetadata } from './dispatch-metadata-client.js';
import type { DispatchMetadata } from './dispatch-metadata-client.js';
```

**Replace the TODO block** (lines 598-601) in `sendMessage`:

```typescript
    if (task === undefined) {
      return await this.handleFallbackRecreation(taskId, message);
    }
```

**Add the `handleFallbackRecreation` private method** (place it after `sendMessage`, before `getTask`):

```typescript
  private async handleFallbackRecreation(
    taskId: string,
    message: string
  ): Promise<Result<SendMessageResult, SendMessageError>> {
    const metadata = await fetchDispatchMetadata(
      taskId,
      {
        codeAgentUrl: this.config.codeAgentUrl,
        internalAuthToken: this.config.internalAuthToken,
      },
      this.logger
    );

    if (metadata === null) {
      return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
    }

    if (metadata.agentType === 'review' || metadata.agentType === 'remediation') {
      return {
        ok: false,
        error: {
          type: 'invalid_agent_type' as const,
          message: 'Cannot send messages to review/remediation tasks',
        },
      };
    }

    // Reconstruct minimal Task from dispatch metadata
    const task: Task = {
      taskId,
      workerType: metadata.workerType as WorkerType,
      prompt: message,
      repository: metadata.repository,
      baseBranch: metadata.baseBranch,
      linearIssueId: metadata.linearIssueId ?? undefined,
      linearIssueLabels: [], // Not stored in code-agent Firestore; agentType handles prompt routing
      webhookUrl: metadata.webhookUrl,
      webhookSecret: metadata.webhookSecret ?? '',
      status: 'running',
      worktreePath: '', // Set by recreateDestroyedContainer
      containerId: '', // Set by recreateDestroyedContainer
      startedAt: new Date().toISOString(),
      agentType: metadata.agentType ?? undefined,
      prNumber: metadata.prNumber ?? undefined,
      continuationPrNumber: metadata.prNumber ?? undefined,
      continuationPrBranch: metadata.continuationPrBranch ?? undefined,
      trackingCommentId: metadata.trackingCommentId ?? undefined,
      attemptCount: 1,
      verificationHistory: [],
      hasChildren: false,
    };

    // Build resume prompt with PR state checking preamble
    const prompt = this.buildResumePreamble(task) + message;
    task.pendingResumeStart = {
      prompt,
      acceptedAt: new Date().toISOString(),
    };

    // Register webhook secret before any log forwarding calls
    this.logForwarder.registerTask(taskId, task.webhookSecret);

    this.appendOrchestratorTaskLog(taskId, 'Recreating destroyed container from dispatch metadata');
    this.appendTaggedTaskLog(
      taskId,
      'prompt',
      message.length > 200 ? message.slice(0, 200) + '\u2026' : message
    );

    await this.saveTask(task);

    this.runningCount++;
    void this.recreateDestroyedContainer(task).catch((error: unknown) => {
      void this.failAcceptedResume(task, error);
    });

    this.logger.info({ taskId }, 'Fallback container recreation accepted with user message');
    return { ok: true, value: { action: 'resumed' } };
  }
```

**Add the `recreateDestroyedContainer` private method** (place it after `handleFallbackRecreation`):

```typescript
  private async recreateDestroyedContainer(task: Task): Promise<void> {
    const prompt = task.pendingResumeStart?.prompt;
    /* v8 ignore start -- async-timing: handleFallbackRecreation validates pendingResumeStart before invoking the async helper @preserve */
    if (prompt === undefined) {
      await this.failAcceptedResume(
        task,
        new Error('Accepted resume is missing the persisted startup prompt')
      );
      return;
    }
    /* v8 ignore stop @preserve */

    try {
      // Create fresh worktree — use continuation branch if available
      const worktreePath =
        task.continuationPrBranch !== undefined
          ? await this.worktreeManager.createWorktree(
              task.taskId,
              task.baseBranch,
              task.continuationPrBranch
            )
          : await this.worktreeManager.createWorktree(task.taskId, task.baseBranch);

      task.worktreePath = worktreePath;

      // Build system prompt from available metadata
      const systemPrompt = buildSystemPrompt({
        taskId: task.taskId,
        linearIssueId: task.linearIssueId,
        linearIssueLabels: task.linearIssueLabels,
        workerType: task.workerType,
        agentType: task.agentType,
        trackingCommentId: task.trackingCommentId,
        continuationPrNumber: task.continuationPrNumber,
        continuationPrBranch: task.continuationPrBranch,
      });

      // Start fresh container (continueSession: false — no existing container to reuse)
      const workerResult = await this.startWorkerAttempt(task, {
        prompt,
        systemPrompt,
        continueSession: false,
      });

      if (!workerResult.ok) {
        await this.failAcceptedResume(task, workerResult.error);
        return;
      }

      task.containerId = workerResult.containerId;
      delete task.pendingResumeStart;
      await this.saveTask(task);

      this.scheduleTimeoutWarning(task.taskId);
      this.scheduleTimeoutKill(task.taskId);
      this.startCompletionMonitoring(task.taskId);

      this.logger.info({ taskId: task.taskId }, 'Destroyed container recreated with user message');
    } catch (error) {
      await this.failAcceptedResume(task, error);
    }
  }
```

**Import `buildSystemPrompt`** — verify the existing import at the top of task-dispatcher.ts. If not already imported:

```typescript
import { buildSystemPrompt } from './system-prompt.js';
```

Also verify that `WorkerType` is imported from `./isolation/types.js` for the type cast.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd /repo && npx vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "recreates container from dispatch metadata"`

Expected: PASS

- [ ] **Step 10: Write and verify additional edge case tests**

Add these tests to the `describe('sendMessage', ...)` block in `task-dispatcher.test.ts`:

```typescript
it('returns not_found when dispatch metadata returns null (task not in Firestore)', async () => {
  // Default mock already returns null, so no override needed
  const result = await dispatcher.sendMessage('unknown-task-no-firestore', 'Hello');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('not_found');
  }
  expect(mockFetchDispatchMetadata).toHaveBeenCalledWith(
    'unknown-task-no-firestore',
    expect.objectContaining({ codeAgentUrl: mockConfig.codeAgentUrl }),
    expect.anything()
  );
});

it('returns invalid_agent_type when dispatch metadata shows review agent', async () => {
  mockFetchDispatchMetadata.mockResolvedValueOnce({
    taskId: 'review-recreate',
    prompt: 'Review this PR',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    agentType: 'review',
    workerType: 'opus',
    linearIssueId: null,
    webhookSecret: null,
    prNumber: null,
    webhookUrl: 'https://code-agent/internal/webhooks/task-complete',
    continuationPrBranch: null,
    trackingCommentId: null,
  });

  const result = await dispatcher.sendMessage('review-recreate', 'Add comments');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_agent_type');
  }
});

it('returns invalid_agent_type when dispatch metadata shows remediation agent', async () => {
  mockFetchDispatchMetadata.mockResolvedValueOnce({
    taskId: 'remediation-recreate',
    prompt: 'Remediate failures',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    agentType: 'remediation',
    workerType: 'opus',
    linearIssueId: null,
    webhookSecret: null,
    prNumber: null,
    webhookUrl: 'https://code-agent/internal/webhooks/task-complete',
    continuationPrBranch: null,
    trackingCommentId: null,
  });

  const result = await dispatcher.sendMessage('remediation-recreate', 'Fix CI');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe('invalid_agent_type');
  }
});

it('allows fallback recreation for pull_request agent type', async () => {
  mockFetchDispatchMetadata.mockResolvedValueOnce({
    taskId: 'pr-recreate',
    prompt: 'Review PR #42',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    agentType: 'pull_request',
    workerType: 'opus',
    linearIssueId: null,
    webhookSecret: 'secret-pr',
    prNumber: 42,
    webhookUrl: 'https://code-agent/internal/webhooks/task-complete',
    continuationPrBranch: 'feature/pr-42',
    trackingCommentId: null,
  });

  const result = await dispatcher.sendMessage('pr-recreate', 'Update the PR');
  await flushAsync();

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ action: 'resumed' });
  }
});
```

- [ ] **Step 11: Run full sendMessage test suite**

Run: `cd /repo && npx vitest run workers/orchestrator/src/__tests__/task-dispatcher.test.ts -t "sendMessage"`

Expected: ALL sendMessage tests pass, including both existing and new tests. The existing `returns not_found for nonexistent task` test should still pass because the default mock returns `null`.

- [ ] **Step 12: Commit**

```bash
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts
git commit -m "feat(orchestrator): implement fallback container recreation in sendMessage

INT-1134: When sendMessage receives a taskId not in orchestrator state,
it now calls code-agent's dispatch-metadata endpoint to retrieve original
task configuration. If found, it reconstructs a minimal Task, creates a
fresh worktree, and starts a new container with the user's message.

Handles edge cases: metadata not found (returns not_found), review/
remediation agents (returns invalid_agent_type), and async container
creation failures (task marked failed via failAcceptedResume)."
```

---

### Part C: Full workspace verification

- [ ] **Step 13: Run full orchestrator workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- orchestrator`

Expected: All tests pass, coverage meets thresholds.

If coverage gaps exist in the new code, address them. Common gaps to check:
- The `recreateDestroyedContainer` method's error paths — `worktreeManager.createWorktree` rejecting, `startWorkerAttempt` returning `{ ok: false }`, or throwing
- The `handleFallbackRecreation` method is fully exercised by the tests in Step 10

If specific branches need coverage, add targeted tests:

```typescript
it('marks task as failed when worktree creation fails during fallback recreation', async () => {
  mockFetchDispatchMetadata.mockResolvedValueOnce({
    taskId: 'fail-worktree-task',
    prompt: 'Original prompt',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    agentType: 'execution',
    workerType: 'opus',
    linearIssueId: null,
    webhookSecret: 'secret',
    prNumber: null,
    webhookUrl: 'https://code-agent/internal/webhooks/task-complete',
    continuationPrBranch: null,
    trackingCommentId: null,
  });

  vi.mocked(mockWorktreeManager.createWorktree).mockRejectedValueOnce(
    new Error('Failed to create worktree')
  );

  const result = await dispatcher.sendMessage('fail-worktree-task', 'Hello');
  await flushAsync();

  // sendMessage returns resumed immediately (async creation)
  expect(result.ok).toBe(true);

  // But the task should be marked as failed after async flow
  const state = await statePersistence.load();
  const task = state.tasks['fail-worktree-task'];
  expect(task?.status).toBe('failed');
});
```

- [ ] **Step 14: Run CI across tracked workspaces**

Run: `cd /repo && pnpm run ci:tracked`

Expected: All workspaces pass. If failures occur in unrelated workspaces, investigate and fix.

- [ ] **Step 15: Final commit (if any additional changes)**

```bash
git add -A
git commit -m "test(orchestrator): add coverage for fallback recreation error paths

INT-1134: Additional tests for worktree creation failure and
container startup failure during fallback container recreation."
```

---

## Edge Cases & Design Notes

### Handled in this implementation:
1. **Task not in Firestore** → `fetchDispatchMetadata` returns null → `not_found` error returned to user
2. **dispatch-metadata HTTP error** → `fetchDispatchMetadata` returns null → `not_found` error returned to user
3. **Review/remediation agent type** → `invalid_agent_type` error returned to user (these task types don't support user messages)
4. **Worktree creation failure** → `failAcceptedResume` marks task as failed, sends failure webhook
5. **Container startup failure** → `failAcceptedResume` marks task as failed, sends failure webhook
6. **Null webhookSecret** → Empty string used; `LogForwarder` has fallback derivation from `orchestratorSecret + taskId`

### Out of scope (potential follow-ups):
1. **Distinct UI indicator** — Currently returns `{ action: 'resumed' }` same as normal resume. A future enhancement could add `{ action: 'recreated' }` with a "Recreating container..." UI message.
2. **Race condition** — Two simultaneous `sendMessage` calls to the same pruned task could both trigger recreation. The second worktree creation would fail (duplicate name), which is handled by `failAcceptedResume`. Low probability in practice.
3. **Continuation context enrichment** — The fallback doesn't fetch `linearIssueTitle` or `linearIssueLabels` (not in code-agent Firestore). A future enhancement could call `fetchLinearIssueContextViaCodeAgent` to enrich the system prompt.
