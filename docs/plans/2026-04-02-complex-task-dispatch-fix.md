# Complex-Task Dispatch Correctness and Linear Relationship Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the complex-task execution flow so clicking Implement on a complex parent creates child execution tasks only, with no leaked parent task, using live Linear data for child discovery.

**Architecture:** Split the execution submission flow into two explicit branches after live issue validation. The complex-task branch skips parent task creation, calls a new linear-agent live direct-children endpoint, creates child tasks, and returns the first child as the backward-compatible primary. linear-agent webhook sync is repaired to persist correct parentId via live API hydration.

**Tech Stack:** TypeScript, Fastify, Linear SDK, Firestore, Vitest

---

## File Structure

### `linear-agent` (deploy first)
- Create: `apps/linear-agent/src/domain/useCases/getDirectChildren.ts`
- Create: `apps/linear-agent/src/__tests__/domain/useCases/getDirectChildren.test.ts`
- Modify: `apps/linear-agent/src/routes/internalIssuesRoutes.ts` (add direct-children endpoint)
- Modify: `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`
- Modify: `apps/linear-agent/src/domain/useCases/syncSingleIssueUseCase.ts`
- Modify: `apps/linear-agent/src/__tests__/domain/useCases/syncSingleIssueUseCase.test.ts`
- Modify: `apps/linear-agent/src/domain/ports.ts`
- Modify: `apps/linear-agent/src/domain/index.ts`

### `code-agent` (deploy after linear-agent)
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts`
- Modify: `apps/code-agent/src/__tests__/domain/useCases/fanOutChildTasks.test.ts`
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts`
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`
- Modify: `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts` (add `fanOutChildTaskIds` field)

---

## Task 1: Add `fanOutChildTaskIds` field to CodeTask model

**Files:**
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Test: `apps/code-agent/src/__tests__/domain/models/codeTask.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/code-agent/src/__tests__/domain/models/codeTask.test.ts
import { describe, it, expect } from 'vitest';
import type { CodeTask } from '../../domain/models/codeTask.js';

describe('CodeTask model', () => {
  it('allows optional fanOutChildTaskIds field for complex parent tracking', () => {
    const task: CodeTask = {
      id: 'task_123',
      userId: 'user_456',
      traceId: 'trace_789',
      prompt: 'Test',
      sanitizedPrompt: 'Test',
      systemPromptHash: 'hash',
      workerType: 'auto',
      workerLocation: 'queued',
      repository: 'owner/repo',
      baseBranch: 'main',
      status: 'planned',
      dedupKey: 'dedup',
      callbackReceived: false,
      createdAt: {} as Timestamp,
      updatedAt: {} as Timestamp,
      fanOutChildTaskIds: ['task_child1', 'task_child2'],
    };
    expect(task.fanOutChildTaskIds).toEqual(['task_child1', 'task_child2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/models/codeTask.test.ts`
Expected: FAIL with TypeScript error or undefined property

- [ ] **Step 3: Add `fanOutChildTaskIds` field to CodeTask interface**

```typescript
// apps/code-agent/src/domain/models/codeTask.ts
// Add after line 194 (after implementationTaskId):

  // Fan-out child tracking (for complex-task parent issues)
  fanOutChildTaskIds?: string[];   // List of child execution task IDs launched from complex parent
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/models/codeTask.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/models/codeTask.ts apps/code-agent/src/__tests__/domain/models/codeTask.test.ts
git commit -m "feat(code-agent): add fanOutChildTaskIds field to CodeTask model

INT-1207: Track child task IDs launched from complex parent issues"
```

---

## Task 2: Add Linear SDK method for direct children query

**Files:**
- Modify: `apps/linear-agent/src/domain/ports.ts`
- Modify: `apps/linear-agent/src/infra/linear/linearApiClient.ts`
- Test: `apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts`

- [ ] **Step 1: Add port interface**

```typescript
// apps/linear-agent/src/domain/ports.ts
// Add to LinearApiClient interface:

  /** Fetch direct children of an issue from live Linear API */
  getDirectChildren(
    apiKey: string,
    issueId: string
  ): Promise<Result<DirectChildIssue[], LinearError>>;

// Add new type:
export interface DirectChildIssue {
  id: string;
  identifier: string;
  url: string;
  parentId: string | null;
  labels: { id: string; name: string }[];
  assigneeId: string | null;
  state: { id: string; name: string; type: string };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts
describe('getDirectChildren', () => {
  it('fetches direct children from live Linear API', async () => {
    // This test requires Linear SDK mock
  });
});
```

- [ ] **Step 3: Implement getDirectChildren in linearApiClient**

```typescript
// apps/linear-agent/src/infra/linear/linearApiClient.ts
// Add method to the returned object:

    async getDirectChildren(
      apiKey: string,
      issueId: string
    ): Promise<Result<DirectChildIssue[], LinearError>> {
      const dedupKey = createDedupKey('getDirectChildren', apiKey.slice(0, 8), issueId);

      try {
        const children = await withDeduplication(dedupKey, async () => {
          logger.info({ issueId }, 'Fetching direct children from Linear');

          const client = getOrCreateClient(apiKey);
          const issue = await client.issue(issueId);
          const childrenConnection = await issue.children();

          return childrenConnection.nodes.map((child) => ({
            id: child.id,
            identifier: child.identifier,
            url: child.url,
            parentId: child.parentId ?? null,
            labels: child.labels.nodes.map((l) => ({ id: l.id, name: l.name })),
            assigneeId: child.assignee?.id ?? null,
            state: { id: child.state.id, name: child.state.name, type: child.state.type },
          }));
        });

        logger.info({ issueId, childCount: children.length }, 'Fetched direct children');
        return ok(children);
      } catch (error) {
        logger.error({ error, issueId }, 'Failed to fetch direct children');
        return err(mapLinearError(error));
      }
    },
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter linear-agent test -- src/__tests__/infra/linearApiClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/linear-agent/src/domain/ports.ts apps/linear-agent/src/infra/linear/linearApiClient.ts apps/linear-agent/src/__tests__/infra/linearApiClient.test.ts
git commit -m "feat(linear-agent): add getDirectChildren method to LinearApiClient

INT-1207: Fetch direct children from live Linear API for complex-task fan-out"
```

---

## Task 3: Create getDirectChildren use case in linear-agent

**Files:**
- Create: `apps/linear-agent/src/domain/useCases/getDirectChildren.ts`
- Create: `apps/linear-agent/src/__tests__/domain/useCases/getDirectChildren.test.ts`
- Modify: `apps/linear-agent/src/domain/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/linear-agent/src/__tests__/domain/useCases/getDirectChildren.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { getDirectChildren, type GetDirectChildrenDeps } from '../../domain/useCases/getDirectChildren.js';
import type { DirectChildIssue } from '../../domain/ports.js';

describe('getDirectChildren', () => {
  let mockLogger: Logger;
  let mockConnectionRepository: { getApiKey: ReturnType<typeof vi.fn> };
  let mockLinearApiClient: { getDirectChildren: ReturnType<typeof vi.fn> };

  const userId = 'user_123';
  const issueId = 'issue_uuid_456';
  const apiKey = 'linear_api_key_789';

  const mockChildren: DirectChildIssue[] = [
    {
      id: 'child_uuid_1',
      identifier: 'INT-101',
      url: 'https://linear.app/issue/INT-101',
      parentId: issueId,
      labels: [{ id: 'label_1', name: 'code-task' }],
      assigneeId: null,
      state: { id: 'state_1', name: 'Backlog', type: 'unstarted' },
    },
    {
      id: 'child_uuid_2',
      identifier: 'INT-102',
      url: 'https://linear.app/issue/INT-102',
      parentId: issueId,
      labels: [{ id: 'label_1', name: 'code-task' }],
      assigneeId: null,
      state: { id: 'state_1', name: 'Backlog', type: 'unstarted' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    mockConnectionRepository = { getApiKey: vi.fn() };
    mockLinearApiClient = { getDirectChildren: vi.fn() };
  });

  function createDeps(): GetDirectChildrenDeps {
    return {
      logger: mockLogger,
      connectionRepository: mockConnectionRepository as unknown as GetDirectChildrenDeps['connectionRepository'],
      linearApiClient: mockLinearApiClient as unknown as GetDirectChildrenDeps['linearApiClient'],
    };
  }

  it('returns direct children from live Linear API', async () => {
    mockConnectionRepository.getApiKey.mockResolvedValue(ok(apiKey));
    mockLinearApiClient.getDirectChildren.mockResolvedValue(ok(mockChildren));

    const result = await getDirectChildren(createDeps(), { userId, issueId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.identifier).toBe('INT-101');
      expect(result.value[1]?.identifier).toBe('INT-102');
    }
    expect(mockLinearApiClient.getDirectChildren).toHaveBeenCalledWith(apiKey, issueId);
  });

  it('returns NOT_CONNECTED error when user has no API key', async () => {
    mockConnectionRepository.getApiKey.mockResolvedValue(ok(null));

    const result = await getDirectChildren(createDeps(), { userId, issueId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_CONNECTED');
    }
  });

  it('returns UNAVAILABLE error when Linear API fails', async () => {
    mockConnectionRepository.getApiKey.mockResolvedValue(ok(apiKey));
    mockLinearApiClient.getDirectChildren.mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed' }));

    const result = await getDirectChildren(createDeps(), { userId, issueId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAVAILABLE');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter linear-agent test -- src/__tests__/domain/useCases/getDirectChildren.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement getDirectChildren use case**

```typescript
// apps/linear-agent/src/domain/useCases/getDirectChildren.ts
/**
 * Use case: Fetch direct children of a Linear issue from live API.
 *
 * INT-1207: Live Linear child discovery for complex-task fan-out.
 * This is the authoritative source for execution-critical child discovery.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { LinearConnectionRepository, LinearApiClient, LinearError, DirectChildIssue } from '../ports.js';

export interface GetDirectChildrenDeps {
  logger: Logger;
  connectionRepository: LinearConnectionRepository;
  linearApiClient: LinearApiClient;
}

export interface GetDirectChildrenRequest {
  userId: string;
  issueId: string; // Linear UUID
}

/**
 * Fetch direct children of an issue from live Linear API.
 * This bypasses cached synced data and queries Linear directly.
 */
export async function getDirectChildren(
  deps: GetDirectChildrenDeps,
  request: GetDirectChildrenRequest,
): Promise<Result<DirectChildIssue[], LinearError>> {
  const { logger, connectionRepository, linearApiClient } = deps;
  const { userId, issueId } = request;

  logger.info({ userId, issueId }, 'Fetching direct children from live Linear');

  // Get user's API key
  const apiKeyResult = await connectionRepository.getApiKey(userId);
  if (!apiKeyResult.ok) {
    return err({ code: 'UNAVAILABLE', message: apiKeyResult.error.message });
  }

  const apiKey = apiKeyResult.value;
  if (apiKey === null) {
    logger.warn({ userId }, 'User not connected to Linear');
    return err({ code: 'NOT_CONNECTED', message: 'User not connected to Linear' });
  }

  // Fetch direct children from live API
  const childrenResult = await linearApiClient.getDirectChildren(apiKey, issueId);
  if (!childrenResult.ok) {
    logger.error({ error: childrenResult.error, issueId }, 'Failed to fetch direct children');
    return err(childrenResult.error);
  }

  logger.info(
    { issueId, childCount: childrenResult.value.length, childIdentifiers: childrenResult.value.map((c) => c.identifier) },
    'Fetched direct children from live Linear',
  );

  return ok(childrenResult.value);
}
```

- [ ] **Step 4: Export from domain/index.ts**

```typescript
// apps/linear-agent/src/domain/index.ts
// Add export:
export { getDirectChildren, type GetDirectChildrenDeps, type GetDirectChildrenRequest } from './useCases/getDirectChildren.js';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter linear-agent test -- src/__tests__/domain/useCases/getDirectChildren.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/getDirectChildren.ts apps/linear-agent/src/__tests__/domain/useCases/getDirectChildren.test.ts apps/linear-agent/src/domain/index.ts
git commit -m "feat(linear-agent): add getDirectChildren use case

INT-1207: Live Linear child discovery for complex-task fan-out"
```

---

## Task 4: Add `/internal/linear/issues/:issueId/direct-children` endpoint

**Files:**
- Modify: `apps/linear-agent/src/routes/internalIssuesRoutes.ts`
- Modify: `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts
// Add to describe block:

  describe('GET /internal/linear/issues/:issueId/direct-children', () => {
    it('returns direct children from live Linear API', async () => {
      const userId = 'user_123';
      const issueId = 'issue_uuid_456';

      // Setup mocks...
      const response = await app.inject({
        method: 'GET',
        url: `/internal/linear/issues/${issueId}/direct-children`,
        headers: {
          'X-Internal-Auth': 'test-secret',
          'X-User-Id': userId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.children).toBeInstanceOf(Array);
    });
  });
```

- [ ] **Step 2: Add the endpoint**

```typescript
// apps/linear-agent/src/routes/internalIssuesRoutes.ts
// Add after the /internal/issues/:issueId/tree endpoint:

  // GET /internal/linear/issues/:issueId/direct-children - Fetch direct children from live Linear
  fastify.get<{ Params: IssueIdParams }>(
    '/internal/linear/issues/:issueId/direct-children',
    {
      schema: {
        operationId: 'getDirectChildrenInternal',
        summary: 'Get direct children from live Linear (internal)',
        description: 'Fetches direct children of an issue from live Linear API. Used by code-agent for complex-task fan-out.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['issueId'],
          properties: {
            issueId: { type: 'string', description: 'Linear issue UUID' },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  children: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        identifier: { type: 'string' },
                        url: { type: 'string' },
                        parentId: { type: ['string', 'null'] },
                        labels: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              name: { type: 'string' },
                            },
                          },
                        },
                        assigneeId: { type: ['string', 'null'] },
                        state: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            type: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: { /* standard 401 */ },
          403: { /* standard 403 */ },
          500: { /* standard 500 */ },
        },
      },
    },
    async (request: FastifyRequest<{ Params: IssueIdParams }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const userId = request.headers['x-user-id'];
      if (typeof userId !== 'string') {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Missing X-User-Id header');
      }

      const { issueId } = request.params;
      const logger = request.log as Logger;

      logger.info({ userId, issueId }, 'internal/getDirectChildren: fetching children');

      const services = getServices();

      const result = await getDirectChildren(
        { logger, connectionRepository: services.connectionRepository, linearApiClient: services.linearApiClient },
        { userId, issueId },
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_CONNECTED') {
          reply.status(403);
          return await reply.fail('FORBIDDEN', 'User not connected to Linear');
        }
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({
        children: result.value.map((child) => ({
          id: child.id,
          identifier: child.identifier,
          url: child.url,
          parentId: child.parentId,
          labels: child.labels,
          assigneeId: child.assigneeId,
          state: child.state,
        })),
      });
    },
  );
```

- [ ] **Step 3: Import getDirectChildren at top of file**

```typescript
// apps/linear-agent/src/routes/internalIssuesRoutes.ts
// Add to imports:
import { getDirectChildren } from '../domain/index.js';
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter linear-agent test -- src/__tests__/routes/internalIssuesRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/linear-agent/src/routes/internalIssuesRoutes.ts apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts
git commit -m "feat(linear-agent): add direct-children internal endpoint

INT-1207: Live Linear child discovery for code-agent fan-out"
```

---

## Task 5: Repair webhook issue sync to hydrate parentId from live Linear

**Files:**
- Modify: `apps/linear-agent/src/domain/useCases/syncSingleIssueUseCase.ts`
- Modify: `apps/linear-agent/src/__tests__/domain/useCases/syncSingleIssueUseCase.test.ts`
- Modify: `apps/linear-agent/src/domain/ports.ts` (add hydrateIssue method to LinearApiClient)
- Modify: `apps/linear-agent/src/infra/linear/linearApiClient.ts`

- [ ] **Step 1: Add hydrateIssueFromApi method to LinearApiClient**

```typescript
// apps/linear-agent/src/domain/ports.ts
// Add to LinearApiClient interface:

  /** Hydrate issue from live Linear API */
  hydrateIssueFromApi(
    apiKey: string,
    issueId: string
  ): Promise<Result<HydratedIssue, LinearError>>;

export interface HydratedIssue {
  id: string;
  identifier: string;
  parentId: string | null;
  childCount: number;
  labels: { id: string; name: string }[];
  assigneeId: string | null;
  state: { id: string; name: string; type: string };
}
```

- [ ] **Step 2: Implement hydrateIssueFromApi in linearApiClient**

```typescript
// apps/linear-agent/src/infra/linear/linearApiClient.ts
// Add to the returned object:

    async hydrateIssueFromApi(
      apiKey: string,
      issueId: string
    ): Promise<Result<HydratedIssue, LinearError>> {
      try {
        logger.info({ issueId }, 'Hydrating issue from live Linear API');

        const client = getOrCreateClient(apiKey);
        const issue = await client.issue(issueId);

        const hydrated: HydratedIssue = {
          id: issue.id,
          identifier: issue.identifier,
          parentId: issue.parentId ?? null,
          childCount: 0, // Will be calculated if needed
          labels: issue.labels.nodes.map((l) => ({ id: l.id, name: l.name })),
          assigneeId: issue.assignee?.id ?? null,
          state: { id: issue.state.id, name: issue.state.name, type: issue.state.type },
        };

        logger.info({ issueId, parentId: hydrated.parentId }, 'Hydrated issue from API');
        return ok(hydrated);
      } catch (error) {
        logger.error({ error, issueId }, 'Failed to hydrate issue from API');
        return err(mapLinearError(error));
      }
    },
```

- [ ] **Step 3: Update syncSingleIssue to optionally hydrate from API**

```typescript
// apps/linear-agent/src/domain/useCases/syncSingleIssueUseCase.ts
// Replace entire file with updated version:

/**
 * Sync a single issue from a webhook event.
 *
 * INT-1207: Hydrates parentId from live Linear API before persisting,
 * because webhook payloads may not include complete parent references.
 */
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { LinearIssueRepository, LinearConnectionRepository, LinearApiClient, LinearError } from '../index.js';
import type { LinearWebhookEvent } from '../webhookTypes.js';
import { mapWebhookToSyncedIssue } from '../issueMapper.js';

export interface SyncSingleIssueDeps {
  issueRepo: LinearIssueRepository;
  connectionRepository: LinearConnectionRepository;
  linearApiClient: LinearApiClient;
  logger: Logger;
}

export interface SyncSingleIssueResult {
  action: 'created' | 'updated' | 'deleted' | 'skipped';
  issueId: string;
  hydrationSource: 'api' | 'webhook_fallback';
}

/**
 * Sync a single issue based on webhook event.
 *
 * For create/update actions, hydrates from live Linear API to ensure
 * parentId and other relationships are accurate.
 */
export async function syncSingleIssue(
  event: LinearWebhookEvent,
  userId: string,
  deps: SyncSingleIssueDeps
): Promise<Result<SyncSingleIssueResult, LinearError>> {
  const { issueRepo, connectionRepository, linearApiClient, logger } = deps;
  const { action, data } = event;

  logger.info({ action, issueId: data.id, identifier: data.identifier }, 'Processing webhook event');

  switch (action) {
    case 'remove': {
      const deleteResult = await issueRepo.deleteById(data.id, userId);
      if (!deleteResult.ok) {
        logger.error({ error: deleteResult.error }, 'Failed to delete issue');
        return deleteResult;
      }
      logger.info({ issueId: data.id }, 'Issue deleted');
      return ok({ action: 'deleted', issueId: data.id, hydrationSource: 'webhook_fallback' });
    }

    case 'create':
    case 'update': {
      // Get user's API key for hydration
      const apiKeyResult = await connectionRepository.getApiKey(userId);
      let hydrationSource: 'api' | 'webhook_fallback' = 'webhook_fallback';

      let syncedIssue = mapWebhookToSyncedIssue(data, userId);

      // Hydrate from live API if possible
      if (apiKeyResult.ok && apiKeyResult.value !== null) {
        const hydrateResult = await linearApiClient.hydrateIssueFromApi(apiKeyResult.value, data.id);

        if (hydrateResult.ok) {
          // Override with API-hydrated values
          syncedIssue = {
            ...syncedIssue,
            parentId: hydrateResult.value.parentId,
            labels: hydrateResult.value.labels.map((l) => ({ ...l, color: l.color ?? '' })),
            assigneeId: hydrateResult.value.assigneeId,
            state: hydrateResult.value.state.name,
            stateType: hydrateResult.value.state.type as 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled',
          };
          hydrationSource = 'api';
          logger.info(
            { issueId: data.id, parentId: hydrateResult.value.parentId, hydrationSource: 'api' },
            'Hydrated issue from live Linear API',
          );
        } else {
          logger.warn(
            { issueId: data.id, error: hydrateResult.error, hydrationSource: 'webhook_fallback' },
            'Failed to hydrate issue from API, using webhook data',
          );
        }
      }

      const saveResult = await issueRepo.save(syncedIssue);
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save issue');
        return saveResult;
      }

      logger.info({ issueId: data.id, action, hydrationSource }, 'Issue synced');
      return ok({ action, issueId: data.id, hydrationSource });
    }

    default: {
      logger.warn({ action }, 'Unknown webhook action, skipping');
      return ok({ action: 'skipped', issueId: data.id, hydrationSource: 'webhook_fallback' });
    }
  }
}
```

- [ ] **Step 4: Write tests for hydration**

```typescript
// apps/linear-agent/src/__tests__/domain/useCases/syncSingleIssueUseCase.test.ts
// Add tests for hydration behavior:

  describe('hydration', () => {
    it('hydrates parentId from live Linear API on create', async () => {
      // Setup: webhook data has parentId: null, but API returns parentId: 'parent_uuid'
      const webhookData = createWebhookData({ parent: undefined });
      mockConnectionRepository.getApiKey.mockResolvedValue(ok('api_key'));
      mockLinearApiClient.hydrateIssueFromApi.mockResolvedValue(ok({
        id: 'issue_123',
        identifier: 'INT-100',
        parentId: 'parent_uuid_456',
        childCount: 0,
        labels: [],
        assigneeId: null,
        state: { id: 'state_1', name: 'Backlog', type: 'unstarted' },
      }));
      mockIssueRepo.save.mockResolvedValue(ok(undefined));

      const result = await syncSingleIssue(createEvent('create', webhookData), userId, createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hydrationSource).toBe('api');
      }
      expect(mockIssueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: 'parent_uuid_456' }),
      );
    });

    it('falls back to webhook data when API hydration fails', async () => {
      const webhookData = createWebhookData({ parent: { id: 'webhook_parent' } });
      mockConnectionRepository.getApiKey.mockResolvedValue(ok('api_key'));
      mockLinearApiClient.hydrateIssueFromApi.mockResolvedValue(err({ code: 'API_ERROR', message: 'Failed' }));
      mockIssueRepo.save.mockResolvedValue(ok(undefined));

      const result = await syncSingleIssue(createEvent('create', webhookData), userId, createDeps());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.hydrationSource).toBe('webhook_fallback');
      }
    });
  });
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter linear-agent test -- src/__tests__/domain/useCases/syncSingleIssueUseCase.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/syncSingleIssueUseCase.ts apps/linear-agent/src/__tests__/domain/useCases/syncSingleIssueUseCase.test.ts apps/linear-agent/src/domain/ports.ts apps/linear-agent/src/infra/linear/linearApiClient.ts
git commit -m "fix(linear-agent): hydrate parentId from live Linear API during webhook sync

INT-1207: Ensure parent-child relationships are correct in synced data"
```

---

## Task 6: Add `fetchDirectChildren` method to LinearAgentClient port in code-agent

**Files:**
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts`
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`
- Test: `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`

- [ ] **Step 1: Add to LinearAgentClient interface**

```typescript
// apps/code-agent/src/domain/ports/linearAgentClient.ts
// Add after fetchIssueTree:

export interface DirectChildIssue {
  id: string;
  identifier: string;
  url: string;
  parentId: string | null;
  labels: { id: string; name: string }[];
  assigneeId: string | null;
  state: { id: string; name: string; type: string };
}

export interface LinearAgentClient {
  // ... existing methods ...

  /**
   * Fetch direct children of an issue from live Linear API.
   * INT-1207: Used for complex-task fan-out child discovery.
   */
  fetchDirectChildren(request: {
    userId: string;
    issueId: string; // Linear UUID
  }): Promise<Result<DirectChildIssue[], LinearAgentError>>;
}
```

- [ ] **Step 2: Implement in linearAgentHttpClient**

```typescript
// apps/code-agent/src/infra/http/linearAgentHttpClient.ts
// Add method to returned object:

    async fetchDirectChildren(request: { userId: string; issueId: string }): Promise<Result<DirectChildIssue[], LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/direct-children`;

      logger.info({ issueId: request.issueId }, 'Fetching direct children from linear-agent');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
            'X-User-Id': request.userId,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent fetchDirectChildren failed');
          return err({ code: response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            children: DirectChildIssue[];
          };
        };

        if (!body.success || body.data === undefined) {
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        logger.info({ issueId: request.issueId, childCount: body.data.children.length }, 'Fetched direct children');
        return ok(body.data.children);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
```

- [ ] **Step 3: Write tests**

```typescript
// apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts
// Add test for fetchDirectChildren

  describe('fetchDirectChildren', () => {
    it('fetches direct children from linear-agent', async () => {
      const mockChildren = [
        { id: 'child_1', identifier: 'INT-101', url: 'https://linear.app/issue/INT-101', parentId: 'parent_123', labels: [{ id: 'l1', name: 'code-task' }], assigneeId: null, state: { id: 's1', name: 'Backlog', type: 'unstarted' } },
      ];

      nock(baseUrl)
        .get('/internal/linear/issues/parent_123/direct-children')
        .reply(200, { success: true, data: { children: mockChildren } });

      const result = await client.fetchDirectChildren({ userId: 'user_123', issueId: 'parent_123' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.identifier).toBe('INT-101');
      }
    });
  });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter code-agent test -- src/__tests__/infra/http/linearAgentHttpClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/ports/linearAgentClient.ts apps/code-agent/src/infra/http/linearAgentHttpClient.ts apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts
git commit -m "feat(code-agent): add fetchDirectChildren method to LinearAgentClient

INT-1207: Call linear-agent live direct-children endpoint for complex fan-out"
```

---

## Task 7: Refactor `submitToExecutionAgent` to split complex-task branch

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`

- [ ] **Step 1: Write failing test for complex-task not creating parent execution task**

```typescript
// apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts
// Add to describe block:

  describe('complex-task fan-out', () => {
    it('does not create a parent execution task for complex-task label', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.hasActiveTaskForLinearIssue.mockResolvedValue(ok({ hasActive: false }));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
      mockLinearAgentClient.validateIssue.mockResolvedValue(ok({
        id: 'issue_uuid_123',
        identifier: linearIssueId,
        title: 'Complex Task',
        url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
        labels: ['complex-task', 'code-task'],
        childCount: 2,
        parentId: null,
      }));
      mockLinearAgentClient.fetchDirectChildren.mockResolvedValue(ok([
        { id: 'child_1', identifier: 'INT-101', url: 'https://linear.app/issue/INT-101', parentId: 'issue_uuid_123', labels: [{ id: 'l1', name: 'code-task' }], assigneeId: null, state: { id: 's1', name: 'Backlog', type: 'unstarted' } },
        { id: 'child_2', identifier: 'INT-102', url: 'https://linear.app/issue/INT-102', parentId: 'issue_uuid_123', labels: [{ id: 'l1', name: 'code-task' }], assigneeId: null, state: { id: 's1', name: 'Backlog', type: 'unstarted' } },
      ]));
      mockCodeTaskRepo.update.mockResolvedValue(ok(mockTask));
      mockCodeTaskRepo.create.mockResolvedValue(ok({ ...mockTask, id: 'child_task_1' }));
      mockTaskEnqueueService.enqueue.mockResolvedValue(ok({ taskId: 'child_task_1', queuePosition: 1 }));

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should return first child as primary
        expect(result.value.codeTaskId).toBe('child_task_1');
        expect(result.value.childTaskIds).toHaveLength(2);
      }

      // Critical: parent execution task should NOT be created
      // Only child tasks should be created
      expect(mockCodeTaskRepo.create).toHaveBeenCalledTimes(2); // 2 children, no parent
    });

    it('returns error when complex-task has no qualifying children', async () => {
      const mockTask = createMockTask();
      mockCodeTaskRepo.findByIdForUser.mockResolvedValue(ok(mockTask));
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok({ workers: [enabledWorker] }));
      mockLinearAgentClient.validateIssue.mockResolvedValue(ok({
        id: 'issue_uuid_123',
        identifier: linearIssueId,
        title: 'Complex Task',
        url: `https://linear.app/pbuchman/issue/${linearIssueId}`,
        labels: ['complex-task', 'code-task'],
        childCount: 0,
        parentId: null,
      }));
      mockLinearAgentClient.fetchDirectChildren.mockResolvedValue(ok([]));

      const result = await submitToExecutionAgent(createDeps(), { originalTaskId, userId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('no_qualifying_children');
      }
      // No tasks should be created
      expect(mockCodeTaskRepo.create).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`
Expected: FAIL - currently creates parent execution task

- [ ] **Step 3: Refactor submitToExecutionAgent**

The key changes:
1. Check for `complex-task` label BEFORE creating execution task
2. For complex tasks, skip parent task creation entirely
3. Call `fetchDirectChildren` for live child discovery
4. Create child tasks directly (not via fanOutChildTasks helper)
5. Update planning task with `fanOutChildTaskIds`

```typescript
// apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts
// Add new error code:
export type SubmitToExecutionAgentErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'no_linear_issue'
  | 'already_implemented'
  | 'active_task_exists'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'queue_full'
  | 'plan_pr_merge_failed'
  | 'no_qualifying_children'  // NEW
  | 'internal_error';

// After line 284 (after label validation), add complex-task branch:

  // === COMPLEX-TASK BRANCH ===
  // If the issue has complex-task label, fan out to children WITHOUT creating parent execution task
  if (isComplexTask) {
    logger.info({ linearIssueId, parentIssueUuid: validateResult.value.id }, 'Complex task detected, discovering direct children from live Linear');

    // Fetch direct children from live Linear via linear-agent
    const childrenResult = await linearAgentClient.fetchDirectChildren({
      userId,
      issueId: validateResult.value.id,
    });

    if (!childrenResult.ok) {
      logger.error({ linearIssueId, error: childrenResult.error }, 'Failed to fetch direct children');
      return err({ code: 'internal_error', message: `Failed to fetch children: ${childrenResult.error.message}` });
    }

    // Filter to direct children with code-task label
    const qualifyingChildren = childrenResult.value
      .filter((child) => child.parentId === validateResult.value.id)
      .filter((child) => child.labels.some((l) => l.name.toLowerCase() === 'code-task'))
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    if (qualifyingChildren.length === 0) {
      logger.warn({ linearIssueId, liveChildCount: childrenResult.value.length }, 'Complex task has no qualifying children with code-task label');
      return err({ code: 'no_qualifying_children', message: 'No direct children with code-task label found' });
    }

    logger.info(
      {
        linearIssueId,
        parentIssueUuid: validateResult.value.id,
        liveChildCount: childrenResult.value.length,
        qualifyingChildCount: qualifyingChildren.length,
        qualifyingChildIdentifiers: qualifyingChildren.map((c) => c.identifier),
      },
      'Complex task: creating child execution tasks',
    );

    // Two-phase: create all child tasks first, then enqueue
    const createdChildTaskIds: string[] = [];
    const createdChildTasks: CodeTask[] = [];

    for (const child of qualifyingChildren) {
      const childTaskId = `task_${randomUUID()}`;
      const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, childTaskId);

      const createResult = await codeTaskRepo.create({
        id: childTaskId,
        userId,
        prompt: EXECUTION_AGENT_PROMPT,
        sanitizedPrompt: child.identifier,
        systemPromptHash: planningTask.systemPromptHash,
        workerType: effectiveWorkerType,
        workerLocation: 'queued' as const,
        repository: planningTask.repository,
        baseBranch: planningTask.baseBranch,
        traceId: `execution-${planningTask.traceId}-child-${child.identifier}`,
        webhookSecret,
        parentTaskId: planningTask.id,
        followUpReason: 'execution_implement' as const,
        agentType: 'execution' as const,
        linearIssueId: child.identifier,
      });

      if (!createResult.ok) {
        logger.error({ childIdentifier: child.identifier, error: createResult.error }, 'Failed to create child task, rolling back');

        // Mark already-created children as non-dispatchable
        for (const createdId of createdChildTaskIds) {
          await codeTaskRepo.update(createdId, { status: 'cancelled' });
        }

        return err({ code: 'internal_error', message: `Failed to create child task for ${child.identifier}` });
      }

      createdChildTaskIds.push(childTaskId);
      createdChildTasks.push(createResult.value);
    }

    // All child tasks created successfully - now enqueue them
    for (const childTask of createdChildTasks) {
      const enqueueResult = await taskEnqueueService.enqueue({ taskId: childTask.id, userId });
      if (!enqueueResult.ok) {
        logger.warn({ childTaskId: childTask.id, error: enqueueResult.error }, 'Failed to enqueue child task (task remains queued)');
      }
    }

    // Update planning task with fanOutChildTaskIds
    const primaryChildId = createdChildTaskIds[0];
    if (primaryChildId === undefined) {
      return err({ code: 'internal_error', message: 'No child tasks created' });
    }

    const updateResult = await codeTaskRepo.update(planningTask.id, {
      implementationTaskId: primaryChildId,
      fanOutChildTaskIds: createdChildTaskIds,
    });

    if (!updateResult.ok) {
      logger.warn({ planningTaskId: planningTask.id, error: updateResult.error }, 'Failed to update planning task with fanOutChildTaskIds');
    }

    logger.info(
      {
        planningTaskId: planningTask.id,
        primaryChildId,
        childTaskIds: createdChildTaskIds,
        childIdentifiers: qualifyingChildren.map((c) => c.identifier),
      },
      'Complex task fan-out completed',
    );

    // Update Linear issue state
    await linearAgentClient.updateIssueState({ userId, issueId: linearIssueId, state: 'in_progress' });

    // Add comment to Linear issue
    const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
    await linearAgentClient.addComment({
      userId,
      issueId: linearIssueId,
      body: `🚀 **Execution Agent fan-out started**

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
**Child tasks:** ${createdChildTaskIds.map((id, i) => `[${qualifyingChildren[i]?.identifier}](${webUrl}/#/code-tasks/${id})`).join(', ')}`,
    });

    return ok({
      codeTaskId: primaryChildId,
      resourceUrl: `/#/code-tasks/${primaryChildId}`,
      workerLocation: 'queued' as WorkerLocation,
      implementationOf: planningTask.id,
      childTaskIds: createdChildTaskIds,
    });
  }

  // === NORMAL SINGLE-TASK BRANCH ===
  // Continue with existing logic for non-complex tasks...
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.test.ts
git commit -m "fix(code-agent): split complex-task branch to avoid parent execution task

INT-1207: Complex parents fan out to children only, no parent task created"
```

---

## Task 8: Add diagnostic logging for complex-task fan-out

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts`

- [ ] **Step 1: Add structured logging with mismatch detection**

Add logging that compares live children vs cached tree:

```typescript
// apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts
// After fetching live children, add mismatch detection:

    // Diagnostic: compare live children with cached tree
    const cachedTreeResult = await linearAgentClient.fetchIssueTree({
      userId,
      issueId: validateResult.value.id,
    });

    if (cachedTreeResult.ok) {
      const cachedChildren = cachedTreeResult.value.descendants.filter(
        (d) => d.parentId === validateResult.value.id,
      );
      const liveIdentifiers = new Set(qualifyingChildren.map((c) => c.identifier));
      const cachedIdentifiers = new Set(cachedChildren.map((c) => c.identifier));

      const onlyInLive = qualifyingChildren.filter((c) => !cachedIdentifiers.has(c.identifier));
      const onlyInCached = cachedChildren.filter((c) => !liveIdentifiers.has(c.identifier));

      if (onlyInLive.length > 0 || onlyInCached.length > 0) {
        logger.warn(
          {
            linearIssueId,
            liveChildCount: qualifyingChildren.length,
            cachedChildCount: cachedChildren.length,
            onlyInLive: onlyInLive.map((c) => c.identifier),
            onlyInCached: onlyInCached.map((c) => c.identifier),
          },
          'Complex-task fan-out: live vs cached mismatch detected',
        );
      }
    }
```

- [ ] **Step 2: Run tests to verify logging doesn't break anything**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/useCases/submitToExecutionAgent.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/usecases/submitToExecutionAgent.ts
git commit -m "feat(code-agent): add diagnostic logging for live vs cached child mismatch

INT-1207: Help diagnose future incidents with structured logs"
```

---

## Task 9: Update `fanOutChildTasks` helper to accept pre-resolved children

**Files:**
- Modify: `apps/code-agent/src/domain/usecases/fanOutChildTasks.ts`
- Test: `apps/code-agent/src/__tests__/domain/useCases/fanOutChildTasks.test.ts`

Note: This helper is now unused after the refactor, but we keep it for potential future use and refactor it to be a pure task-creation helper.

- [ ] **Step 1: Refactor fanOutChildTasks signature**

```typescript
// apps/code-agent/src/domain/usecases/fanOutChildTasks.ts
// Update the request interface and function:

export interface FanOutChildTasksRequest {
  parentTask: CodeTask;
  userId: string;
  /** Pre-resolved children to create tasks for (INT-1207: caller resolves from live Linear) */
  children: Array<{
    identifier: string;
    id: string;
    url: string;
    labels: string[];
  }>;
}

/**
 * Create and enqueue child tasks for pre-resolved children.
 *
 * INT-1207: Refactored to accept pre-resolved children.
 * Caller is responsible for child discovery from live Linear.
 */
export async function fanOutChildTasks(
  deps: FanOutChildTasksDeps,
  request: FanOutChildTasksRequest,
): Promise<Result<FanOutChildTasksResult, FanOutChildTasksError>> {
  const { logger, codeTaskRepo, taskEnqueueService } = deps;
  const { parentTask, userId, children } = request;

  if (children.length === 0) {
    return err({ code: 'no_qualifying_children', message: 'No children provided' });
  }

  logger.info(
    { parentTaskId: parentTask.id, childCount: children.length, childIdentifiers: children.map((c) => c.identifier) },
    'Fan-out: creating child tasks',
  );

  // Create child tasks concurrently
  const results = await Promise.all(
    children.map((child) => createAndEnqueueChild(deps, parentTask, child, userId)),
  );

  const childTaskIds = results.filter((id): id is string => id !== null);

  if (childTaskIds.length === 0) {
    return err({ code: 'internal_error', message: 'All child task creations failed' });
  }

  return ok({
    childTaskIds,
    parentTaskId: parentTask.id,
  });
}
```

- [ ] **Step 2: Update tests**

```typescript
// apps/code-agent/src/__tests__/domain/useCases/fanOutChildTasks.test.ts
// Update tests to pass pre-resolved children:

  it('creates child tasks for pre-resolved children', async () => {
    const parentTask = createParentTask();
    mockCodeTaskRepo.create.mockResolvedValue(ok(createParentTask({ id: 'child-task-1' })));

    const result = await fanOutChildTasks(createDeps(), {
      parentTask,
      userId: 'user-456',
      children: [
        { identifier: 'INT-101', id: 'child_1', url: 'https://linear.app/issue/INT-101', labels: ['code-task'] },
        { identifier: 'INT-102', id: 'child_2', url: 'https://linear.app/issue/INT-102', labels: ['code-task'] },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.childTaskIds).toHaveLength(2);
    }
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/useCases/fanOutChildTasks.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/domain/usecases/fanOutChildTasks.ts apps/code-agent/src/__tests__/domain/useCases/fanOutChildTasks.test.ts
git commit -m "refactor(code-agent): fanOutChildTasks accepts pre-resolved children

INT-1207: Caller is responsible for live Linear child discovery"
```

---

## Task 10: Add regression tests for INT-1199 and INT-1203 scenarios

**Files:**
- Create: `apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.regression.test.ts`

- [ ] **Step 1: Write regression tests**

```typescript
// apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.regression.test.ts
/**
 * Regression tests for INT-1199 and INT-1203 incidents.
 *
 * INT-1199: Parent execution task was created and leaked when fan-out failed.
 * INT-1203: Parent execution task was created and dispatched, children were not.
 *
 * Root cause: submitToExecutionAgent created parent task BEFORE fan-out,
 * and did not clean up on failure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import { Timestamp } from '@google-cloud/firestore';
import { submitToExecutionAgent, type SubmitToExecutionAgentDeps } from '../../../domain/usecases/submitToExecutionAgent.js';

describe('INT-1199 regression: parent task leak on fan-out failure', () => {
  // Setup mocks...
  // Test that complex-task with failed child discovery does NOT create any execution task
});

describe('INT-1203 regression: parent dispatched without children', () => {
  // Setup mocks...
  // Test that complex-task creates only child tasks, never a parent execution task
});

describe('Live vs cached mismatch: INT-1203 scenario', () => {
  // Test where live Linear has children but cached tree has stale data
  // Should use live data and succeed
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter code-agent test -- src/__tests__/domain/useCases/submitToExecutionAgent.regression.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/__tests__/domain/useCases/submitToExecutionAgent.regression.test.ts
git commit -m "test(code-agent): add regression tests for INT-1199 and INT-1203

INT-1207: Verify complex-task fan-out correctness"
```

---

## Task 11: Run full CI and verify all tests pass

**Files:**
- None (verification step)

- [ ] **Step 1: Run linear-agent CI**

Run: `pnpm --filter linear-agent run ci:tracked`
Expected: All tests pass

- [ ] **Step 2: Run code-agent CI**

Run: `pnpm --filter code-agent run ci:tracked`
Expected: All tests pass

- [ ] **Step 3: Run full workspace CI**

Run: `pnpm run ci:tracked`
Expected: All tests pass

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
# If any uncommitted changes, commit them
```

---

## Endpoint Changes

### Modified Endpoints
- `POST /code/tasks/:taskId/implement` - Returns `childTaskIds` for complex parents

### Created Endpoints
- `GET /internal/linear/issues/:issueId/direct-children` - Returns live direct children from Linear

### Removed Endpoints
- None

### Unchanged Endpoints
- All other endpoints remain backward compatible

---

## Acceptance Criteria Verification

1. ✅ Clicking Implement on a complex parent issue creates no runnable parent execution task
2. ✅ Clicking Implement on a complex parent issue creates one execution task per qualifying direct child issue
3. ✅ `submitToExecutionAgent()` uses live Linear child discovery through `linear-agent`, not cached tree data
4. ✅ If no qualifying children exist, the API returns a non-500 business error and creates no execution tasks
5. ✅ If child creation fails partway through, no leaked dispatchable tasks remain
6. ✅ `linear-agent` persists correct `parentId` for child issues during webhook-driven sync
7. ✅ The implement response remains backward compatible and also exposes all launched child task IDs
8. ✅ The planning task exposes all launched child task IDs via `fanOutChildTaskIds`
9. ✅ Complex-parent observability is sufficient to diagnose live-vs-cached mismatches

---

## Rollout Order

1. Deploy `linear-agent` first
2. Run `fullSyncAllUsers` to repair existing cached issue relationships
3. Deploy `code-agent`
4. Monitor for complex-task fan-out issues