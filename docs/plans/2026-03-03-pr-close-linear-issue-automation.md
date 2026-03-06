# PR Close Linear Issue Automation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically transition associated Linear issues to "Done" when a GitHub PR is closed.

**Architecture:** GitHub webhook handler in code-agent receives `pull_request` events with `action: 'closed'`. It discovers associated Linear issues via two methods: (1) code task linked to the PR, (2) `INT-XXX` patterns in PR body/comments. For each discovered issue, it calls the Linear API to transition the state to "Done".

**Tech Stack:** TypeScript, Fastify (webhook routes), Linear SDK, Vitest (testing)

---

## Background

### Current State

- GitHub webhooks are received at `POST /webhooks/github` in code-agent
- `pull_request` events with `action: 'closed'` are parsed but not specially handled
- Linear issue state transitions support: `backlog`, `todo`, `in_progress`, `in_review`, `qa`
- Code tasks are linked to PRs via `prNumber` and `prBranch` fields
- `codeTaskRepo.findByPR(repository, prNumber)` returns the task that created a PR

### Target State

- When a PR is closed, automatically transition associated Linear issues to "Done"
- Discovery methods:
  1. **Code Task Link:** Look up task via `findByPR`, get `linearIssueId`
  2. **PR Body Pattern:** Parse `INT-XXX` patterns from PR body
- Both methods should be tried; all discovered issues should be transitioned

### Linear Workflow States

| State Name | Type      | ID (IntexuraOS team)                 |
| ---------- | --------- | ------------------------------------ |
| Done       | completed | e95d5420-217a-4085-a8ea-3d01b4926e90 |
| Canceled   | canceled  | 645f31e1-bdcb-4cf2-8738-5bfeaeca2a74 |

---

## Interface Contracts (Shared by All Tasks)

### Contract A: Linear Agent State Update API

**Endpoint:** `PATCH /internal/issues/:issueId/state`

**Request Body:**
```typescript
interface UpdateStateBody {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';
}
```

**State Mapping (STATE_NAME_MAP):**
```typescript
const STATE_NAME_MAP: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
  done: 'Done',  // NEW
};
```

### Contract B: LinearIssueService Interface

```typescript
interface LinearIssueService {
  // ... existing methods ...

  /**
   * Transition issue to Done when PR is closed.
   * Silently logs and returns on failure (fire-and-forget).
   */
  markDone(userId: string, linearIssueId: string): Promise<void>;
}
```

### Contract C: LinearAgentClient Port

```typescript
interface UpdateIssueStateRequest {
  userId: string;
  issueId: string;
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';  // 'done' added
}
```

### Contract D: INT-XXX Parser Utility

```typescript
/**
 * Extract Linear issue identifiers from text.
 * @param text - PR body or comment text
 * @returns Array of unique issue identifiers (e.g., ['INT-123', 'INT-456'])
 */
function extractLinearIssueIdentifiers(text: string): string[];
```

---

## Task 1: Linear Agent - Add 'done' State Support

**Files:**
- Modify: `apps/linear-agent/src/routes/internalIssuesRoutes.ts`
- Test: `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`

### Step 1: Update STATE_NAME_MAP

In `apps/linear-agent/src/routes/internalIssuesRoutes.ts`, add 'done' mapping:

```typescript
const STATE_NAME_MAP: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  qa: 'QA',
  done: 'Done',  // ADD THIS LINE
};
```

### Step 2: Update UpdateStateBody Type

In the same file, update the interface:

```typescript
interface UpdateStateBody {
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';  // Add 'done'
}
```

### Step 3: Update Schema

In the route schema, update the enum:

```typescript
state: {
  type: 'string',
  enum: ['backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done'],  // Add 'done'
  description: 'Target workflow state',
},
```

### Step 4: Write Test

Add test to `apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts`:

```typescript
it('should update issue state to done', async () => {
  // Setup mocks for connection, API key, workflow states
  // Call PATCH /internal/issues/:issueId/state with { state: 'done' }
  // Verify response is 200 OK
  // Verify linearApiClient.updateIssueState was called with correct stateId for "Done"
});
```

### Step 5: Run Tests

```bash
pnpm --filter linear-agent test
```

### Step 6: Commit

```bash
git add apps/linear-agent/src/routes/internalIssuesRoutes.ts apps/linear-agent/src/__tests__/routes/internalIssuesRoutes.test.ts
git commit -m "feat(linear-agent): add 'done' state support to internal API"
```

---

## Task 2: Code Agent - Add 'done' State to Client Interface

**Files:**
- Modify: `apps/code-agent/src/domain/ports/linearAgentClient.ts`
- Modify: `apps/code-agent/src/infra/http/linearAgentHttpClient.ts`
- Test: `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`

### Step 1: Update Port Interface

In `apps/code-agent/src/domain/ports/linearAgentClient.ts`:

```typescript
export interface UpdateIssueStateRequest {
  userId: string;
  issueId: string;
  state: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'qa' | 'done';  // Add 'done'
}
```

### Step 2: Add Test for 'done' State

In `apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts`, add test:

```typescript
it('should update issue state to done', async () => {
  nock(baseUrl)
    .patch('/internal/issues/INT-123/state', { state: 'done' })
    .reply(200, { success: true, data: {} });

  const result = await client.updateIssueState({
    userId: 'user-123',
    issueId: 'INT-123',
    state: 'done',
  });

  expect(result.ok).toBe(true);
});
```

### Step 3: Run Tests

```bash
pnpm --filter code-agent test -- linearAgentHttpClient
```

### Step 4: Commit

```bash
git add apps/code-agent/src/domain/ports/linearAgentClient.ts apps/code-agent/src/__tests__/infra/http/linearAgentHttpClient.test.ts
git commit -m "feat(code-agent): add 'done' state to LinearAgentClient interface"
```

---

## Task 3: Code Agent - Add markDone to LinearIssueService

**Files:**
- Modify: `apps/code-agent/src/domain/services/linearIssueService.ts`
- Test: `apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts`

### Step 1: Add markDone to Interface

In `apps/code-agent/src/domain/services/linearIssueService.ts`:

```typescript
export interface LinearIssueService {
  // ... existing methods ...

  /**
   * Transition issue to Done when PR is closed.
   */
  markDone(userId: string, linearIssueId: string): Promise<void>;
}
```

### Step 2: Implement markDone

In the same file, add implementation:

```typescript
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

### Step 3: Write Failing Test First

In `apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts`:

```typescript
describe('markDone', () => {
  it('should call updateIssueState with done state', async () => {
    const mockClient = {
      updateIssueState: vi.fn().mockResolvedValue(ok(undefined)),
      // ... other methods
    };
    const service = createLinearIssueService({ linearAgentClient: mockClient, logger });

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
      // ... other methods
    };
    const service = createLinearIssueService({ linearAgentClient: mockClient, logger });

    await service.markDone('user-123', '');

    expect(mockClient.updateIssueState).not.toHaveBeenCalled();
  });

  it('should log warning on failure but not throw', async () => {
    const mockClient = {
      updateIssueState: vi.fn().mockResolvedValue(err({ code: 'UNAVAILABLE', message: 'error' })),
      // ... other methods
    };
    const service = createLinearIssueService({ linearAgentClient: mockClient, logger });

    // Should not throw
    await expect(service.markDone('user-123', 'INT-456')).resolves.toBeUndefined();
  });
});
```

### Step 4: Run Tests

```bash
pnpm --filter code-agent test -- linearIssueService
```

### Step 5: Commit

```bash
git add apps/code-agent/src/domain/services/linearIssueService.ts apps/code-agent/src/__tests__/domain/services/linearIssueService.test.ts
git commit -m "feat(code-agent): add markDone to LinearIssueService"
```

---

## Task 4: Code Agent - PR Close Webhook Handler

**Files:**
- Modify: `apps/code-agent/src/routes/webhooks/github.ts`
- Create: `apps/code-agent/src/domain/utils/linearIssueExtractor.ts`
- Test: `apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`

### Step 1: Create INT-XXX Extractor Utility

Create `apps/code-agent/src/domain/utils/linearIssueExtractor.ts`:

```typescript
/**
 * Extracts Linear issue identifiers (INT-XXX) from text.
 * Used to discover associated issues from PR body and comments.
 */

const LINEAR_ISSUE_PATTERN = /\bINT-\d+\b/gi;

/**
 * Extract unique Linear issue identifiers from text.
 * @param text - Text to search (PR body, comment, etc.)
 * @returns Array of unique uppercase identifiers (e.g., ['INT-123', 'INT-456'])
 */
export function extractLinearIssueIdentifiers(text: string | null | undefined): string[] {
  if (text === null || text === undefined || text === '') {
    return [];
  }

  const matches = text.match(LINEAR_ISSUE_PATTERN);
  if (matches === null) {
    return [];
  }

  // Deduplicate and uppercase
  const unique = [...new Set(matches.map((m) => m.toUpperCase()))];
  return unique;
}
```

### Step 2: Write Tests for Extractor

Create `apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractLinearIssueIdentifiers } from '../../../domain/utils/linearIssueExtractor.js';

describe('extractLinearIssueIdentifiers', () => {
  it('should extract single INT-XXX identifier', () => {
    expect(extractLinearIssueIdentifiers('Fixes INT-123')).toEqual(['INT-123']);
  });

  it('should extract multiple identifiers', () => {
    expect(extractLinearIssueIdentifiers('Fixes INT-123 and INT-456')).toEqual(['INT-123', 'INT-456']);
  });

  it('should deduplicate identifiers', () => {
    expect(extractLinearIssueIdentifiers('INT-123 INT-123 INT-123')).toEqual(['INT-123']);
  });

  it('should be case-insensitive and normalize to uppercase', () => {
    expect(extractLinearIssueIdentifiers('int-123 Int-456')).toEqual(['INT-123', 'INT-456']);
  });

  it('should return empty array for null/undefined/empty input', () => {
    expect(extractLinearIssueIdentifiers(null)).toEqual([]);
    expect(extractLinearIssueIdentifiers(undefined)).toEqual([]);
    expect(extractLinearIssueIdentifiers('')).toEqual([]);
  });

  it('should return empty array when no matches', () => {
    expect(extractLinearIssueIdentifiers('No issues here')).toEqual([]);
  });

  it('should not match partial patterns', () => {
    expect(extractLinearIssueIdentifiers('NOTINT-123 INT123')).toEqual([]);
  });

  it('should match at word boundaries', () => {
    expect(extractLinearIssueIdentifiers('[INT-123] (INT-456)')).toEqual(['INT-123', 'INT-456']);
  });
});
```

### Step 3: Add PR Close Handler

In `apps/code-agent/src/routes/webhooks/github.ts`, add new handler function:

```typescript
import { extractLinearIssueIdentifiers } from '../../domain/utils/linearIssueExtractor.js';

/**
 * Handle PR closed event: transition associated Linear issues to Done.
 * Fire-and-forget - webhook returns immediately.
 *
 * Discovery methods:
 * 1. Code task linked to PR via findByPR
 * 2. INT-XXX patterns in PR body
 */
async function handlePRClosed(event: GitHubPREvent, logger: Logger): Promise<void> {
  try {
    // Only handle pull_request events with closed action
    if (event.eventType !== 'pull_request' || event.action !== 'closed') {
      return;
    }

    const services = getServices();
    const discoveredIssues = new Set<string>();
    let userId: string | null = null;

    // Method 1: Find via code task
    const taskResult = await services.codeTaskRepo.findByPR(event.repository, event.pullRequestNumber);
    if (taskResult.ok && taskResult.value !== null) {
      const task = taskResult.value;
      userId = task.userId;
      if (task.linearIssueId !== undefined && task.linearIssueId !== null) {
        discoveredIssues.add(task.linearIssueId);
        logger.info(
          { repository: event.repository, prNumber: event.pullRequestNumber, linearIssueId: task.linearIssueId },
          'Found Linear issue via code task'
        );
      }
    }

    // Method 2: Extract from PR body
    const bodyIssues = extractLinearIssueIdentifiers(event.body);
    for (const issueId of bodyIssues) {
      discoveredIssues.add(issueId);
    }

    if (bodyIssues.length > 0) {
      logger.info(
        { repository: event.repository, prNumber: event.pullRequestNumber, issues: bodyIssues },
        'Found Linear issues in PR body'
      );
    }

    // No issues found - nothing to do
    if (discoveredIssues.size === 0) {
      logger.debug(
        { repository: event.repository, prNumber: event.pullRequestNumber },
        'No Linear issues found for closed PR'
      );
      return;
    }

    // If we don't have a userId from task, we need to look it up
    // For now, skip if no userId - this happens when PR was created outside our system
    if (userId === null) {
      logger.warn(
        { repository: event.repository, prNumber: event.pullRequestNumber, issues: [...discoveredIssues] },
        'Cannot transition issues: no userId available (PR not created by code task)'
      );
      return;
    }

    // Transition all discovered issues to Done
    for (const issueId of discoveredIssues) {
      await services.linearIssueService.markDone(userId, issueId);
      logger.info(
        { repository: event.repository, prNumber: event.pullRequestNumber, linearIssueId: issueId },
        'Transitioned Linear issue to Done on PR close'
      );
    }
  } catch (error) {
    logger.error(
      { error, repository: event.repository, prNumber: event.pullRequestNumber },
      'Unexpected error handling PR close'
    );
  }
}
```

### Step 4: Call Handler from Webhook Route

In the main webhook handler, after saving the event, add:

```typescript
// Handle PR close - transition Linear issues to Done
if (parsedEvent.eventType === 'pull_request' && parsedEvent.action === 'closed') {
  void handlePRClosed(savedEvent, logger);
}
```

### Step 5: Write Integration Tests

In `apps/code-agent/src/__tests__/routes/webhooks/github.test.ts`, add:

```typescript
describe('PR close handling', () => {
  it('should call markDone when PR is closed with linked code task', async () => {
    const mockMarkDone = vi.fn();
    // Setup services with linearIssueService.markDone mock
    // Setup codeTaskRepo.findByPR to return a task with linearIssueId

    const { payload, signature } = signPayload({
      action: 'closed',
      repository: { id: 1, full_name: 'intexuraos/test', owner: { login: 'intexuraos', id: 1 } },
      pull_request: { id: 1, number: 42, title: 'Test PR', state: 'closed' },
      sender: { login: 'testuser', id: 1, type: 'User' },
    });

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
    // Wait for fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(mockMarkDone).toHaveBeenCalled();
  });

  it('should extract INT-XXX from PR body and call markDone', async () => {
    // Similar setup with PR body containing 'Fixes INT-123'
    // Verify markDone called with 'INT-123'
  });
});
```

### Step 6: Run Tests

```bash
pnpm --filter code-agent test -- github.test
pnpm --filter code-agent test -- linearIssueExtractor
```

### Step 7: Commit

```bash
git add apps/code-agent/src/routes/webhooks/github.ts \
        apps/code-agent/src/domain/utils/linearIssueExtractor.ts \
        apps/code-agent/src/__tests__/domain/utils/linearIssueExtractor.test.ts \
        apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
git commit -m "feat(code-agent): auto-transition Linear issues to Done on PR close"
```

---

## Verification

After all tasks are complete:

```bash
pnpm run ci:tracked
```

All tests must pass. Coverage thresholds must be met.

---

## Endpoint Changes

| Service      | Method | Path                            | Change                                 |
| ------------ | ------ | ------------------------------- | -------------------------------------- |
| linear-agent | PATCH  | /internal/issues/:issueId/state | Add `'done'` to state enum             |
| code-agent   | POST   | /webhooks/github                | Add PR close handler (fire-and-forget) |

---

## Risks and Mitigations

| Risk                       | Mitigation                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| Linear API rate limiting   | Fire-and-forget with warning logs; user can retry manually            |
| Multiple issues in PR body | Deduplicate before processing                                         |
| PR closed without merge    | Both merged and unmerged PRs are transitioned to Done (intentional)   |
| No userId available        | Skip transition with warning; only affects PRs created outside system |
