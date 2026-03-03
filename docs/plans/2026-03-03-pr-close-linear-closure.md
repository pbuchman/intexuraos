# PR Close → Linear Issue Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically transition associated Linear issues to "Done" status when a GitHub PR is closed.

**Architecture:** When a GitHub `pull_request` webhook event with `action: 'closed'` arrives at code-agent, the handler discovers associated Linear issues via two methods: (1) looking up the code task that created the PR, and (2) parsing `INT-XXX` patterns from the PR body. For each discovered issue, the system calls linear-agent to transition the issue to "Done" state.

**Tech Stack:** TypeScript, Fastify (code-agent webhooks), Linear SDK (@linear/sdk), Vitest for testing

---

## Contract Definitions (Shared Across All Tasks)

### Linear State Enum Extension

```typescript
// In apps/linear-agent/src/routes/internalIssuesRoutes.ts
interface UpdateStateBody {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}

const STATE_NAME_MAP: Record<string, string> = {
  // ... existing entries ...
  done: 'Done',
};
```

### LinearAgentClient Port Extension

```typescript
// In apps/code-agent/src/domain/ports/linearAgentClient.ts
export interface UpdateIssueStateRequest {
  userId: string;
  issueId: string;
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}
```

### LinearIssueService Extension

```typescript
// In apps/code-agent/src/domain/services/linearIssueService.ts
export interface LinearIssueService {
  // ... existing methods ...

  /**
   * Transition issue to Done when PR is closed/merged.
   */
  markDone(userId: string, linearIssueId: string): Promise<void>;
}
```

### PR Close Handler Contract

```typescript
// In apps/code-agent/src/routes/webhooks/github.ts
// When pull_request event with action='closed' arrives:
// 1. Find code task via findByPR(repository, prNumber)
// 2. If task has linearIssueId → call markDone(task.userId, task.linearIssueId)
// 3. Parse PR body for INT-XXX patterns → for each, call markDone
```

---

## Task 1: Linear-Agent - Add "done" State Support

**Files:**
- Modify: `apps/linear-agent/src/routes/internalIssuesRoutes.ts:20-45`
- Test: `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`

**Step 1: Write the failing test**

```typescript
// In apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts
describe('PATCH /internal/issues/:issueId/state', () => {
  it('should accept done state and map to Done workflow state', async () => {
    // Setup: mock linearApiClient.getWorkflowStates to return Done state
    // Setup: mock linearApiClient.updateIssueState to succeed

    const response = await app.inject({
      method: 'PATCH',
      url: '/internal/issues/test-issue-id/state',
      headers: {
        'x-internal-auth': internalAuthToken,
        'x-user-id': 'test-user-id',
      },
      body: { state: 'done' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter linear-agent test -- --run internalIssuesRoutes`
Expected: FAIL - state 'done' not in enum

**Step 3: Update UpdateStateBody interface**

```typescript
// In apps/linear-agent/src/routes/internalIssuesRoutes.ts
interface UpdateStateBody {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}
```

**Step 4: Update STATE_NAME_MAP**

```typescript
const STATE_NAME_MAP: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
  done: 'Done',
};
```

**Step 5: Update schema enum**

```typescript
// In the PATCH route schema
body: {
  type: 'object',
  required: ['state'],
  properties: {
    state: {
      type: 'string',
      enum: ['backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done'],
      description: 'Target workflow state',
    },
  },
},
```

**Step 6: Run test to verify it passes**

Run: `pnpm --filter linear-agent test -- --run internalIssuesRoutes`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/linear-agent/src/routes/internalIssuesRoutes.ts apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts
git commit -m "feat(linear-agent): add 'done' state to issue state transitions"
```

---

## Task 2: Code-Agent - Update LinearAgentClient Port and HTTP Client

**Files:**
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts:24-28`
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts:116-164`
- Test: `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`

**Step 1: Write the failing test**

```typescript
// In apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts
describe('updateIssueState', () => {
  it('should accept done state', async () => {
    nock(baseUrl)
      .patch('/internal/issues/INT-123/state')
      .reply(200, { success: true, data: {} });

    const result = await client.updateIssueState({
      userId: 'user-123',
      issueId: 'INT-123',
      state: 'done',
    });

    expect(result.ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run linearAgentHttpClient`
Expected: FAIL - TypeScript error, 'done' not in union type

**Step 3: Update UpdateIssueStateRequest interface**

```typescript
// In apps/code-agent/src/domain/ports/linearAgentClient.ts
export interface UpdateIssueStateRequest {
  userId: string;
  issueId: string;
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run linearAgentHttpClient`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/ports/linearAgentClient.ts apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts
git commit -m "feat(code-agent): add 'done' state to LinearAgentClient port"
```

---

## Task 3: Code-Agent - Add markDone to LinearIssueService

**Files:**
- Modify: `apps/code-agent/src/domain/services/linearIssueService.ts:32-57,178-194`
- Test: `apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts`

**Step 1: Write the failing test**

```typescript
// In apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts
describe('markDone', () => {
  it('should call linearAgentClient.updateIssueState with done state', async () => {
    const mockClient = {
      updateIssueState: vi.fn().mockResolvedValue(ok(undefined)),
      // ... other mocked methods
    };

    const service = createLinearIssueService({
      linearAgentClient: mockClient,
      logger: mockLogger,
    });

    await service.markDone('user-123', 'INT-456');

    expect(mockClient.updateIssueState).toHaveBeenCalledWith({
      userId: 'user-123',
      issueId: 'INT-456',
      state: 'done',
    });
  });

  it('should skip if linearIssueId is empty', async () => {
    const mockClient = {
      updateIssueState: vi.fn(),
    };

    const service = createLinearIssueService({
      linearAgentClient: mockClient,
      logger: mockLogger,
    });

    await service.markDone('user-123', '');

    expect(mockClient.updateIssueState).not.toHaveBeenCalled();
  });

  it('should log warning on failure but not throw', async () => {
    const mockClient = {
      updateIssueState: vi.fn().mockResolvedValue(err({ code: 'UNAVAILABLE', message: 'down' })),
    };

    const service = createLinearIssueService({
      linearAgentClient: mockClient,
      logger: mockLogger,
    });

    // Should not throw
    await service.markDone('user-123', 'INT-456');

    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run linearIssueService`
Expected: FAIL - markDone is not a function

**Step 3: Add markDone to interface**

```typescript
// In apps/code-agent/src/domain/services/linearIssueService.ts
export interface LinearIssueService {
  ensureIssueExists(params: { /* ... */ }): Promise<EnsureIssueResult>;
  markInProgress(userId: string, linearIssueId: string): Promise<void>;
  markInReview(userId: string, linearIssueId: string): Promise<void>;

  /**
   * Transition issue to Done when PR is closed/merged.
   */
  markDone(userId: string, linearIssueId: string): Promise<void>;
}
```

**Step 4: Implement markDone**

```typescript
// In createLinearIssueService function, after markInReview
async markDone(userId: string, linearIssueId: string): Promise<void> {
  if (!linearIssueId) {
    logger.debug({}, 'Skipping state transition (no issue ID)');
    return;
  }

  const result = await linearAgentClient.updateIssueState({
    userId,
    issueId: linearIssueId,
    state: 'done',
  });

  if (!result.ok) {
    logger.warn({ linearIssueId, error: result.error }, 'Failed to update Linear issue to Done');
  }
},
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run linearIssueService`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/code-agent/src/domain/services/linearIssueService.ts apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts
git commit -m "feat(code-agent): add markDone to LinearIssueService"
```

---

## Task 4: Code-Agent - Handle PR Close Webhook Event

**Files:**
- Modify: `apps/code-agent/src/routes/webhooks/github.ts`
- Create: `apps/code-agent/src/domain/utils/linearIssueExtractor.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts`

### Part A: Linear Issue Extractor Utility

**Step 1: Write the failing test for extractor**

```typescript
// In apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractLinearIssueIds } from '../../../domain/utils/linearIssueExtractor.js';

describe('extractLinearIssueIds', () => {
  it('should extract single INT-XXX from text', () => {
    const result = extractLinearIssueIds('Fixes INT-123');
    expect(result).toEqual(['INT-123']);
  });

  it('should extract multiple INT-XXX from text', () => {
    const result = extractLinearIssueIds('Fixes INT-123 and INT-456');
    expect(result).toEqual(['INT-123', 'INT-456']);
  });

  it('should deduplicate repeated identifiers', () => {
    const result = extractLinearIssueIds('INT-123 mentioned again INT-123');
    expect(result).toEqual(['INT-123']);
  });

  it('should return empty array for text without identifiers', () => {
    const result = extractLinearIssueIds('No issues here');
    expect(result).toEqual([]);
  });

  it('should handle null/undefined input', () => {
    expect(extractLinearIssueIds(null)).toEqual([]);
    expect(extractLinearIssueIds(undefined)).toEqual([]);
  });

  it('should handle case variations', () => {
    const result = extractLinearIssueIds('int-123 INT-456 Int-789');
    expect(result).toEqual(['INT-123', 'INT-456', 'INT-789']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run linearIssueExtractor`
Expected: FAIL - module not found

**Step 3: Implement extractor utility**

```typescript
// In apps/code-agent/src/domain/utils/linearIssueExtractor.ts
/**
 * Extract Linear issue identifiers (INT-XXX) from text.
 * Used to discover associated issues from PR body/comments.
 */

const LINEAR_ISSUE_PATTERN = /\bINT-\d+\b/gi;

export function extractLinearIssueIds(text: string | null | undefined): string[] {
  if (text === null || text === undefined) {
    return [];
  }

  const matches = text.match(LINEAR_ISSUE_PATTERN);
  if (matches === null) {
    return [];
  }

  // Normalize to uppercase and deduplicate
  const unique = new Set(matches.map(m => m.toUpperCase()));
  return Array.from(unique);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run linearIssueExtractor`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/code-agent/src/domain/utils/linearIssueExtractor.ts apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts
git commit -m "feat(code-agent): add Linear issue extractor utility"
```

### Part B: PR Close Webhook Handler

**Step 6: Write the failing test for webhook handler**

```typescript
// In apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
// Add to existing describe block

describe('pull_request closed event', () => {
  it('should mark Linear issue as done when PR is closed and task exists', async () => {
    const mockLinearIssueService = {
      markDone: vi.fn().mockResolvedValue(undefined),
      // ... other methods
    };

    // Update services to include mockLinearIssueService

    const prPayload = {
      action: 'closed',
      repository: {
        id: 123,
        name: 'intexuraos',
        full_name: 'intexuraos/intexuraos',
        owner: { login: 'intexuraos', id: 1 },
      },
      pull_request: {
        id: 456,
        number: 42,
        title: 'Test PR',
        body: 'Fixes INT-999',
        state: 'closed',
        merged_at: '2026-03-03T00:00:00Z',
      },
      sender: { login: 'testuser', id: 789, type: 'User' },
    };

    const { payload, signature } = signPayload(prPayload);

    // Mock findByPR to return a task with linearIssueId
    mockCodeTaskRepo.findByPR.mockResolvedValue(ok({
      id: 'task-123',
      userId: 'user-456',
      linearIssueId: 'INT-100',
      // ... other task fields
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-event': 'pull_request',
      },
      body: payload,
    });

    expect(response.statusCode).toBe(200);

    // Verify markDone was called for task's linearIssueId
    await vi.waitFor(() => {
      expect(mockLinearIssueService.markDone).toHaveBeenCalledWith('user-456', 'INT-100');
    });
  });

  it('should extract and close Linear issues from PR body', async () => {
    // Similar test but without task, relying on PR body extraction
    // Should call markDone for INT-999 from PR body
  });
});
```

**Step 7: Run test to verify it fails**

Run: `pnpm --filter code-agent test -- --run github.test`
Expected: FAIL - markDone not called

**Step 8: Implement PR close handler**

```typescript
// In apps/code-agent/src/routes/webhooks/github.ts

// Add import
import { extractLinearIssueIds } from '../../domain/utils/linearIssueExtractor.js';

// Add new function after dispatchPRCommentToTask
/**
 * Handle PR close event - transition associated Linear issues to Done.
 * Fire-and-forget — webhook returns immediately.
 */
async function handlePRClose(event: GitHubPREvent, logger: Logger): Promise<void> {
  try {
    const services = getServices();
    const closedIssueIds = new Set<string>();

    // Method 1: Find task that created this PR
    const taskResult = await services.codeTaskRepo.findByPR(event.repository, event.pullRequestNumber);

    if (taskResult.ok && taskResult.value !== null) {
      const task = taskResult.value;
      if (task.linearIssueId) {
        logger.info(
          { taskId: task.id, linearIssueId: task.linearIssueId, prNumber: event.pullRequestNumber },
          'Found task for closed PR, marking Linear issue as done'
        );
        await services.linearIssueService.markDone(task.userId, task.linearIssueId);
        closedIssueIds.add(task.linearIssueId);
      }
    }

    // Method 2: Extract INT-XXX from PR body
    const extractedIds = extractLinearIssueIds(event.body);
    for (const issueId of extractedIds) {
      if (closedIssueIds.has(issueId)) {
        continue; // Already closed via task
      }

      logger.info(
        { issueId, prNumber: event.pullRequestNumber },
        'Found Linear issue in PR body, marking as done'
      );

      // Note: We need a userId to call markDone.
      // For extracted issues, use the task's userId if available,
      // otherwise skip (we can't transition without auth context)
      if (taskResult.ok && taskResult.value !== null) {
        await services.linearIssueService.markDone(taskResult.value.userId, issueId);
        closedIssueIds.add(issueId);
      }
    }

    logger.info(
      { closedCount: closedIssueIds.size, prNumber: event.pullRequestNumber },
      'PR close handling complete'
    );
  } catch (error) {
    logger.error(
      { error, repository: event.repository, prNumber: event.pullRequestNumber },
      'Unexpected error handling PR close'
    );
  }
}

// In the webhook handler, after saving the event, add:
const isPRCloseEvent =
  parsedEvent.eventType === 'pull_request' &&
  parsedEvent.action === 'closed';

if (isPRCloseEvent) {
  void handlePRClose(savedEvent, logger);
}
```

**Step 9: Run test to verify it passes**

Run: `pnpm --filter code-agent test -- --run github.test`
Expected: PASS

**Step 10: Run full verification**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: PASS

**Step 11: Commit**

```bash
git add apps/code-agent/src/routes/webhooks/github.ts apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
git commit -m "feat(code-agent): handle PR close webhook to transition Linear issues to Done"
```

---

## Final Verification

**Step 1: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: All checks pass

**Step 2: Create final commit if needed**

```bash
git status
# If any uncommitted changes, commit them
```

---

## Endpoint Changes

| Service      | Method   | Path                              | Change                              |
| ------------ | -------- | --------------------------------- | ----------------------------------- |
| linear-agent | PATCH    | `/internal/issues/:issueId/state` | Add `'done'` to state enum          |

## Files Modified Summary

| Service        | File                                             | Change Type   |
| -------------- | ------------------------------------------------ | ------------- |
| linear-agent   | `src/routes/internalIssuesRoutes.ts`             | Modified      |
| code-agent     | `src/domain/ports/linearAgentClient.ts`          | Modified      |
| code-agent     | `src/domain/services/linearIssueService.ts`      | Modified      |
| code-agent     | `src/domain/utils/linearIssueExtractor.ts`       | Created       |
| code-agent     | `src/routes/webhooks/github.ts`                  | Modified      |
