# Linear Issues Count Guardian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated hourly cron-triggered system within the linear-agent that monitors active Linear issue count and, when the count exceeds 200, uses Gemini Flash to intelligently classify and delete ~30 redundant issues to maintain the count below the 250 subscription limit.

**Architecture:** The system adds a new internal endpoint (`POST /internal/linear/prune-issues`) to the linear-agent service, triggered hourly by Cloud Scheduler. The endpoint orchestrates: (1) count check against a configurable threshold, (2) issue data enrichment for classification, (3) Gemini Flash-based intelligent scoring of deletion candidates, (4) Linear API deletion of top candidates via the SDK's `issue.delete()` soft-delete, (5) local Firestore cleanup. All actions are logged via structured logging (Cloud Logging), not Firestore.

**Tech Stack:** TypeScript/Fastify (linear-agent), @linear/sdk v29 (`issue.delete()`), @google/genai via `infra-gemini` (Gemini 2.5 Flash for classification), Google Cloud Scheduler (hourly cron trigger), Terraform (infrastructure).

---

## Endpoint Changes

### Created
| Method   | Path                            | Auth                                      | Description                                   |
| -------- | ------------------------------- | ----------------------------------------- | --------------------------------------------- |
| POST     | `/internal/linear/prune-issues` | OIDC (Cloud Scheduler) or X-Internal-Auth | Trigger issue pruning for all connected users |

### Unchanged
| Method           | Path                        | Notes                             |
| ---------------- | --------------------------- | --------------------------------- |
| POST             | `/internal/linear/sync-all` | Existing hourly sync — unmodified |
| All other routes |                             | No changes                        |

---

## File Structure

### New Files
| File                                                                         | Responsibility                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`                | Core pruning orchestration: threshold check, candidate selection, deletion, stats |
| `apps/linear-agent/src/infra/llm/issuePruningClassifier.ts`                  | Gemini Flash integration for intelligent issue classification                     |
| `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts` | Unit tests for the pruning use case                                               |
| `apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts`   | Unit tests for the classifier                                                     |
| `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`            | Route integration tests                                                           |

### Modified Files
| File                                                    | Change                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/linear-agent/src/domain/ports.ts`                 | Add `deleteIssue()` to `LinearApiClient` port; add `IssuePruningClassifier` port |
| `apps/linear-agent/src/domain/models.ts`                | Add `PruneCandidate`, `PruneStats`, `PruneConfig` types                          |
| `apps/linear-agent/src/domain/index.ts`                 | Export new use case, types, and port                                             |
| `apps/linear-agent/src/infra/linear/linearApiClient.ts` | Implement `deleteIssue()` method                                                 |
| `apps/linear-agent/src/services.ts`                     | Add `issuePruningClassifier` to `ServiceContainer`                               |
| `apps/linear-agent/src/routes/internalRoutes.ts`        | Add `POST /internal/linear/prune-issues` handler                                 |
| `apps/linear-agent/src/index.ts`                        | No env var changes needed — `INTEXURAOS_GEMINI_APP_API_KEY` already available    |
| `terraform/environments/dev/main.tf`                    | Add `linear_issues_prune_hourly` Cloud Scheduler job                             |

---

## Subtask Contracts

### Subtask 1: linear-agent (apps/linear-agent)
**Owns:** All application code — domain models, ports, use case, classifier, route, service container, tests.
**Contract exposed to Subtask 2:**
- Endpoint: `POST /internal/linear/prune-issues`
- Auth: OIDC token (Cloud Scheduler) validated at Cloud Run infrastructure level, OR `X-Internal-Auth` header validated at application level
- Request body: none
- Response (200): `{ success: true, data: PruneStats }`
- Response (401): Unauthorized
- Response (500): Internal error

### Subtask 2: terraform (terraform/)
**Owns:** Cloud Scheduler job configuration in `terraform/environments/dev/main.tf`.
**Contract consumed from Subtask 1:**
- Target URI: `https://${local.services.linear_agent.name}-${local.cloud_run_url_suffix}/internal/linear/prune-issues`
- HTTP method: POST
- Auth: OIDC token with `audience = linear-agent service URL`
- IAM: Reuses existing `scheduler_invokes_linear_agent` IAM binding (already grants `roles/run.invoker`)

---

## Shared Type Definitions

These types are defined in Subtask 1 and referenced throughout the plan:

```typescript
// apps/linear-agent/src/domain/models.ts

/** Configuration for the pruning system */
interface PruneConfig {
  /** Threshold above which pruning activates (default: 200) */
  activationThreshold: number;
  /** Target number of issues to delete per run (default: 30) */
  targetDeletionCount: number;
}

/** A candidate issue scored for deletion */
interface PruneCandidate {
  /** Linear issue UUID */
  id: string;
  /** Human-readable identifier e.g. "INT-123" */
  identifier: string;
  /** Issue title */
  title: string;
  /** Deletion priority score (0-100, higher = more deletable) */
  score: number;
  /** Human-readable reason for deletion */
  reason: string;
  /** Classification category */
  category: 'cancelled' | 'duplicate' | 'sub-issue' | 'simple-fix' | 'review-only' | 'other';
}

/** Stats returned after a pruning run */
interface PruneStats {
  /** Whether pruning was skipped (below threshold) */
  skipped: boolean;
  /** Reason for skipping (if applicable) */
  skipReason?: string;
  /** Total active issues before pruning */
  totalActive: number;
  /** Number of issues successfully deleted */
  deleted: number;
  /** Number of issues remaining after pruning */
  remaining: number;
  /** Issues that were deleted with reasons */
  deletedCandidates: Array<{ identifier: string; title: string; reason: string }>;
  /** Issues that failed to delete */
  failedDeletions: Array<{ identifier: string; error: string }>;
  /** Duration of the pruning run in milliseconds */
  durationMs: number;
}

// apps/linear-agent/src/domain/ports.ts (addition to existing LinearApiClient)

/** Delete (trash) an issue in Linear */
deleteIssue(apiKey: string, issueId: string): Promise<Result<void, LinearError>>;

// New port
/** Classifies issues to find deletion candidates */
interface IssuePruningClassifier {
  /** Score and rank issues for deletion based on configurable criteria */
  classifyCandidates(
    issues: SyncedLinearIssue[],
    targetCount: number,
    logger: Logger
  ): Promise<Result<PruneCandidate[], LinearError>>;
}
```

---

## Task 1: Add deleteIssue to LinearApiClient Port and Implementation

**Files:**
- Modify: `apps/linear-agent/src/domain/ports.ts` (line ~153, after `getWorkflowStates`)
- Modify: `apps/linear-agent/src/infra/linear/linearApiClient.ts` (add method to client object)

- [ ] **Step 1: Add deleteIssue to the LinearApiClient port**

Add the `deleteIssue` method signature to the `LinearApiClient` interface in `ports.ts`, after `getWorkflowStates`:

```typescript
/** Delete (trash) an issue in Linear. This is a soft-delete (recoverable via Linear UI). */
deleteIssue(apiKey: string, issueId: string): Promise<Result<void, LinearError>>;
```

- [ ] **Step 2: Implement deleteIssue in the API client**

Add the implementation to the object returned by `createLinearApiClient()` in `linearApiClient.ts`. Follow the same pattern as existing methods (e.g., `updateIssueState`):

```typescript
async deleteIssue(apiKey: string, issueId: string): Promise<Result<void, LinearError>> {
  try {
    const client = getOrCreateClient(apiKey);
    const issue = await client.issue(issueId);
    const result = await issue.delete();
    if (!result.success) {
      return err({ code: 'API_ERROR', message: `Failed to delete issue ${issueId}` });
    }
    return ok(undefined);
  } catch (error) {
    return err(mapLinearError(error));
  }
},
```

- [ ] **Step 3: Verify build**

Run: `cd /repo && pnpm build --filter=linear-agent`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/linear-agent/src/domain/ports.ts apps/linear-agent/src/infra/linear/linearApiClient.ts
git commit -m "feat(linear-agent): add deleteIssue to LinearApiClient port and implementation"
```

---

## Task 2: Add Domain Types for Pruning

**Files:**
- Modify: `apps/linear-agent/src/domain/models.ts`
- Modify: `apps/linear-agent/src/domain/ports.ts`
- Modify: `apps/linear-agent/src/domain/index.ts`

- [ ] **Step 1: Add pruning types to models.ts**

Add at the end of `models.ts`:

```typescript
/** Configuration for the issue pruning system */
export interface PruneConfig {
  /** Threshold above which pruning activates */
  activationThreshold: number;
  /** Target number of issues to delete per run */
  targetDeletionCount: number;
}

/** A candidate issue scored for deletion */
export interface PruneCandidate {
  /** Linear issue UUID */
  id: string;
  /** Human-readable identifier e.g. "INT-123" */
  identifier: string;
  /** Issue title */
  title: string;
  /** Deletion priority score (0-100, higher = more deletable) */
  score: number;
  /** Human-readable reason for deletion */
  reason: string;
  /** Classification category */
  category: 'cancelled' | 'duplicate' | 'sub-issue' | 'simple-fix' | 'review-only' | 'other';
}

/** Stats returned after a pruning run */
export interface PruneStats {
  /** Whether pruning was skipped (below threshold) */
  skipped: boolean;
  /** Reason for skipping (if applicable) */
  skipReason?: string;
  /** Total active issues before pruning */
  totalActive: number;
  /** Number of issues successfully deleted */
  deleted: number;
  /** Number of issues remaining after pruning */
  remaining: number;
  /** Issues that were deleted with reasons */
  deletedCandidates: Array<{ identifier: string; title: string; reason: string }>;
  /** Issues that failed to delete */
  failedDeletions: Array<{ identifier: string; error: string }>;
  /** Duration of the pruning run in milliseconds */
  durationMs: number;
}
```

- [ ] **Step 2: Add IssuePruningClassifier port to ports.ts**

Add after the `LinearCommentRepository` interface:

```typescript
/** Classifies synced issues to find deletion candidates using LLM */
export interface IssuePruningClassifier {
  /** Score and rank issues for deletion based on configurable criteria */
  classifyCandidates(
    issues: SyncedLinearIssue[],
    targetCount: number,
    logger: Logger
  ): Promise<Result<PruneCandidate[], LinearError>>;
}
```

Import `Logger` from `pino` at the top of `ports.ts`:

```typescript
import type { Logger } from 'pino';
```

- [ ] **Step 3: Export new types from domain/index.ts**

Add to `domain/index.ts`:

```typescript
export type { PruneConfig, PruneCandidate, PruneStats } from './models.js';
export type { IssuePruningClassifier } from './ports.js';
```

- [ ] **Step 4: Verify build**

Run: `cd /repo && pnpm build --filter=linear-agent`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/linear-agent/src/domain/models.ts apps/linear-agent/src/domain/ports.ts apps/linear-agent/src/domain/index.ts
git commit -m "feat(linear-agent): add domain types and ports for issue pruning"
```

---

## Task 3: Implement GeminiIssuePruningClassifier

**Files:**
- Create: `apps/linear-agent/src/infra/llm/issuePruningClassifier.ts`
- Create: `apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createIssuePruningClassifier } from '../../../infra/llm/issuePruningClassifier.js';
import type { IssuePruningClassifier, SyncedLinearIssue, PruneCandidate } from '../../../domain/index.js';
import type { Logger } from 'pino';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createTestIssue(overrides: Partial<SyncedLinearIssue>): SyncedLinearIssue {
  return {
    id: 'test-id',
    identifier: 'INT-100',
    title: 'Test issue',
    description: 'Test description',
    state: 'Done',
    stateType: 'completed',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test',
    userId: 'user-1',
    parentId: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    syncedAt: '2026-03-29T00:00:00.000Z',
    teamId: 'team-1',
    ...overrides,
  };
}

describe('IssuePruningClassifier', () => {
  let classifier: IssuePruningClassifier;
  let fakeGenerate: ReturnType<typeof vi.fn>;
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();
    fakeGenerate = vi.fn();
    classifier = createIssuePruningClassifier({
      generate: fakeGenerate,
      logger,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns scored candidates from Gemini response', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', title: 'Cancelled task', stateType: 'cancelled', state: 'Canceled' }),
      createTestIssue({ id: '2', identifier: 'INT-200', title: 'Active task', stateType: 'started', state: 'In Progress' }),
      createTestIssue({ id: '3', identifier: 'INT-300', title: 'Sub-issue fix', stateType: 'completed', parentId: 'parent-1' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-100', score: 95, reason: 'Cancelled issue with no outcome', category: 'cancelled' },
          { identifier: 'INT-300', score: 70, reason: 'Completed sub-issue', category: 'sub-issue' },
        ]),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 2, logger);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.identifier).toBe('INT-100');
    expect(result.value[0]!.score).toBe(95);
    expect(result.value[0]!.category).toBe('cancelled');
    expect(result.value[1]!.identifier).toBe('INT-300');
  });

  it('filters out non-closed issues before sending to Gemini', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'started' }),
      createTestIssue({ id: '2', identifier: 'INT-200', stateType: 'backlog' }),
      createTestIssue({ id: '3', identifier: 'INT-300', stateType: 'completed', state: 'Done' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-300', score: 60, reason: 'Completed singular issue', category: 'simple-fix' },
        ]),
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only INT-300 should be in the prompt (completed/cancelled only)
    const promptArg = fakeGenerate.mock.calls[0]![0] as string;
    expect(promptArg).not.toContain('INT-100');
    expect(promptArg).not.toContain('INT-200');
    expect(promptArg).toContain('INT-300');
  });

  it('returns error when Gemini call fails', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'Gemini unavailable' },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles malformed Gemini JSON response gracefully', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: { content: 'not valid json at all', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(result.error.message).toContain('parse');
  });

  it('enriches candidates with issue metadata from input', async () => {
    const issues = [
      createTestIssue({ id: 'uuid-1', identifier: 'INT-100', title: 'My task', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-100', score: 90, reason: 'Cancelled', category: 'cancelled' },
        ]),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.id).toBe('uuid-1');
    expect(result.value[0]!.title).toBe('My task');
  });

  it('returns empty array when no closed issues exist', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'started' }),
    ];

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
    expect(fakeGenerate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts`
Expected: FAIL — module `../../../infra/llm/issuePruningClassifier.js` not found.

- [ ] **Step 3: Write the classifier implementation**

Create `apps/linear-agent/src/infra/llm/issuePruningClassifier.ts`:

```typescript
/**
 * Gemini Flash-based issue pruning classifier.
 * Scores synced Linear issues as deletion candidates using LLM intelligence.
 *
 * NOTE: Tested via fake generate function injection in unit tests.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { IssuePruningClassifier, SyncedLinearIssue, PruneCandidate, LinearError } from '../../domain/index.js';

interface GeminiGenerateResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

interface GeminiGenerateError {
  code: string;
  message: string;
}

interface ClassifierDeps {
  generate: (prompt: string) => Promise<Result<GeminiGenerateResult, GeminiGenerateError>>;
  logger: Logger;
}

interface GeminiCandidateResponse {
  identifier: string;
  score: number;
  reason: string;
  category: PruneCandidate['category'];
}

const PRUNING_PROMPT_VERSION = '1.0.0';

function buildClassificationPrompt(
  issues: SyncedLinearIssue[],
  targetCount: number
): string {
  const issueData = issues.map((issue) => {
    const hasParent = issue.parentId !== null && issue.parentId !== undefined;
    return {
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state,
      stateType: issue.stateType,
      hasParent,
      parentId: issue.parentId ?? null,
      labels: issue.labels.map((l) => l.name),
      priority: issue.priority,
      descriptionLength: issue.description?.length ?? 0,
      descriptionPreview: issue.description?.slice(0, 300) ?? '',
      createdAt: issue.createdAt,
    };
  });

  return `You are a Linear issue triage assistant. Analyze these closed/cancelled Linear issues and select the top ${String(targetCount)} candidates for deletion.

PROMPT VERSION: ${PRUNING_PROMPT_VERSION}

DELETION PRIORITY (highest to lowest):
1. CANCELLED and DUPLICATE issues — always highest priority to delete
2. Sub-issues (have a parentId) — good candidates since parent retains context
3. Simple fix issues — short descriptions, no complex logic, review/investigate tasks without PR outcomes
4. Singular completed issues with low complexity — small changes, one-file fixes

KEEP (lower deletion priority):
- Parent issues with children — they provide context for sub-issues
- Issues with complex descriptions that document architecture decisions or debugging insights
- Issues with labels like "complex-task" — likely contain valuable context

INSTRUCTIONS:
- Return EXACTLY a JSON array of objects, nothing else (no markdown, no explanation)
- Each object: { "identifier": "INT-XXX", "score": <0-100>, "reason": "<1 sentence>", "category": "<cancelled|duplicate|sub-issue|simple-fix|review-only|other>" }
- Score 100 = most deletable, 0 = should not delete
- Sort by score descending
- Return at most ${String(targetCount)} candidates
- Only include candidates with score >= 40

ISSUES TO CLASSIFY:
${JSON.stringify(issueData, null, 2)}`;
}

export function createIssuePruningClassifier(deps: ClassifierDeps): IssuePruningClassifier {
  return {
    async classifyCandidates(
      issues: SyncedLinearIssue[],
      targetCount: number,
      logger: Logger
    ): Promise<Result<PruneCandidate[], LinearError>> {
      // Pre-filter: only send closed/cancelled issues to Gemini
      const closedIssues = issues.filter(
        (i) => i.stateType === 'completed' || i.stateType === 'cancelled'
      );

      if (closedIssues.length === 0) {
        logger.info('No closed/cancelled issues found for classification');
        return ok([]);
      }

      logger.info(
        { totalIssues: issues.length, closedIssues: closedIssues.length, targetCount },
        'Classifying issues for pruning'
      );

      const prompt = buildClassificationPrompt(closedIssues, targetCount);

      const result = await deps.generate(prompt);
      if (!result.ok) {
        logger.error({ error: result.error }, 'Gemini classification failed');
        return err({ code: 'INTERNAL_ERROR', message: `Classification failed: ${result.error.message}` });
      }

      logger.info(
        { usage: result.value.usage },
        'Gemini classification completed'
      );

      // Parse JSON response
      let parsed: GeminiCandidateResponse[];
      try {
        const content = result.value.content.trim();
        // Handle potential markdown code block wrapping
        const jsonContent = content.startsWith('[')
          ? content
          : content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        parsed = JSON.parse(jsonContent) as GeminiCandidateResponse[];
      } catch {
        logger.error(
          { responsePreview: result.value.content.slice(0, 200) },
          'Failed to parse Gemini classification response'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: 'Failed to parse classification response as JSON',
        });
      }

      // Build a lookup map for enriching candidates with full issue data
      const issueMap = new Map(closedIssues.map((i) => [i.identifier, i]));

      const candidates: PruneCandidate[] = parsed
        .filter((c) => issueMap.has(c.identifier))
        .map((c) => {
          const issue = issueMap.get(c.identifier)!;
          return {
            id: issue.id,
            identifier: c.identifier,
            title: issue.title,
            score: c.score,
            reason: c.reason,
            category: c.category,
          };
        });

      logger.info({ candidateCount: candidates.length }, 'Classification complete');

      return ok(candidates);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/linear-agent/src/infra/llm/issuePruningClassifier.ts apps/linear-agent/src/__tests__/infra/llm/issuePruningClassifier.test.ts
git commit -m "feat(linear-agent): implement Gemini-based issue pruning classifier with tests"
```

---

## Task 4: Implement pruneIssues Use Case

**Files:**
- Create: `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`
- Create: `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pruneIssues, type PruneIssuesDeps } from '../../../domain/useCases/pruneIssuesUseCase.js';
import type { SyncedLinearIssue, PruneCandidate, PruneConfig } from '../../../domain/index.js';
import type { Logger } from 'pino';
import { ok, err, type Result } from '@intexuraos/common-core';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createTestIssue(overrides: Partial<SyncedLinearIssue>): SyncedLinearIssue {
  return {
    id: 'test-id',
    identifier: 'INT-100',
    title: 'Test issue',
    description: 'Test description',
    state: 'Done',
    stateType: 'completed',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test',
    userId: 'user-1',
    parentId: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    syncedAt: '2026-03-29T00:00:00.000Z',
    teamId: 'team-1',
    ...overrides,
  };
}

const DEFAULT_CONFIG: PruneConfig = {
  activationThreshold: 200,
  targetDeletionCount: 30,
};

describe('pruneIssues', () => {
  let deps: PruneIssuesDeps;
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();
    deps = {
      connectionRepo: {
        getAllConnectedUserIds: vi.fn().mockResolvedValue(ok(['user-1'])),
        getFullConnection: vi.fn().mockResolvedValue(
          ok({ userId: 'user-1', apiKey: 'key-1', teamId: 'team-1', teamName: 'Test', webhookSecret: null, connected: true, createdAt: '', updatedAt: '' })
        ),
      },
      issueRepo: {
        listByUserId: vi.fn(),
        deleteById: vi.fn().mockResolvedValue(ok(undefined)),
      },
      linearClient: {
        deleteIssue: vi.fn().mockResolvedValue(ok(undefined)),
        listIssues: vi.fn(),
      },
      classifier: {
        classifyCandidates: vi.fn(),
      },
      logger,
      config: DEFAULT_CONFIG,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips pruning when total active issues are below threshold', async () => {
    const issues = Array.from({ length: 50 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(true);
    expect(result.value.skipReason).toContain('below threshold');
    expect(result.value.totalActive).toBe(50);
    expect(deps.classifier.classifyCandidates).not.toHaveBeenCalled();
  });

  it('deletes candidates and cleans up Firestore when above threshold', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, userId: 'user-1' })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
      { id: 'id-1', identifier: 'INT-1', title: 'Task 1', score: 80, reason: 'Sub-issue', category: 'sub-issue' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(false);
    expect(result.value.deleted).toBe(2);
    expect(result.value.totalActive).toBe(210);
    expect(result.value.remaining).toBe(208);
    expect(deps.linearClient.deleteIssue).toHaveBeenCalledTimes(2);
    expect(deps.linearClient.deleteIssue).toHaveBeenCalledWith('key-1', 'id-0');
    expect(deps.issueRepo.deleteById).toHaveBeenCalledTimes(2);
  });

  it('continues deleting remaining candidates when one fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}`, userId: 'user-1' })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));

    const candidates: PruneCandidate[] = [
      { id: 'id-0', identifier: 'INT-0', title: 'Task 0', score: 90, reason: 'Cancelled', category: 'cancelled' },
      { id: 'id-1', identifier: 'INT-1', title: 'Task 1', score: 80, reason: 'Sub-issue', category: 'sub-issue' },
    ];
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(ok(candidates));
    (deps.linearClient.deleteIssue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'Rate limited' }))
      .mockResolvedValueOnce(ok(undefined));

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(1);
    expect(result.value.failedDeletions).toHaveLength(1);
    expect(result.value.failedDeletions[0]!.identifier).toBe('INT-0');
  });

  it('returns error when getting connected users fails', async () => {
    (deps.connectionRepo.getAllConnectedUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Firestore down' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns error when classifier fails', async () => {
    const issues = Array.from({ length: 210 }, (_, i) =>
      createTestIssue({ id: `id-${String(i)}`, identifier: `INT-${String(i)}` })
    );
    (deps.issueRepo.listByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(ok(issues));
    (deps.classifier.classifyCandidates as ReturnType<typeof vi.fn>).mockResolvedValue(
      err({ code: 'INTERNAL_ERROR', message: 'Gemini failed' })
    );

    const result = await pruneIssues(deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Gemini failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the use case implementation**

Create `apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts`:

```typescript
/**
 * Prune redundant Linear issues to stay under subscription limits.
 *
 * Orchestrates: threshold check -> Gemini classification -> Linear API deletion -> Firestore cleanup.
 * All actions logged via structured logging (Cloud Logging).
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  LinearConnectionRepository,
  LinearIssueRepository,
  LinearApiClient,
  IssuePruningClassifier,
  LinearError,
  PruneConfig,
  PruneStats,
  SyncedLinearIssue,
} from '../index.js';

export interface PruneIssuesDeps {
  connectionRepo: Pick<LinearConnectionRepository, 'getAllConnectedUserIds' | 'getFullConnection'>;
  issueRepo: Pick<LinearIssueRepository, 'listByUserId' | 'deleteById'>;
  linearClient: Pick<LinearApiClient, 'deleteIssue' | 'listIssues'>;
  classifier: IssuePruningClassifier;
  logger: Logger;
  config: PruneConfig;
}

/**
 * Run the issue pruning workflow for all connected users.
 *
 * 1. Get all connected users and aggregate their synced issue count
 * 2. If total unique issues exceed activation threshold, classify candidates
 * 3. Delete top candidates via Linear API
 * 4. Clean up local Firestore copies
 */
export async function pruneIssues(
  deps: PruneIssuesDeps
): Promise<Result<PruneStats, LinearError>> {
  const { connectionRepo, issueRepo, linearClient, classifier, logger, config } = deps;
  const startTime = Date.now();

  logger.info({ config }, 'Starting issue pruning workflow');

  // Step 1: Get all connected users
  const usersResult = await connectionRepo.getAllConnectedUserIds();
  if (!usersResult.ok) {
    return usersResult;
  }

  const userIds = usersResult.value;
  if (userIds.length === 0) {
    logger.info('No connected users found, skipping pruning');
    return ok({
      skipped: true,
      skipReason: 'No connected users',
      totalActive: 0,
      deleted: 0,
      remaining: 0,
      deletedCandidates: [],
      failedDeletions: [],
      durationMs: Date.now() - startTime,
    });
  }

  // Step 2: Aggregate all issues across users (deduplicate by issue ID)
  const allIssuesMap = new Map<string, { issue: SyncedLinearIssue; userIds: string[] }>();

  for (const userId of userIds) {
    const issuesResult = await issueRepo.listByUserId(userId);
    if (!issuesResult.ok) {
      logger.error({ userId, error: issuesResult.error }, 'Failed to list issues for user, continuing');
      continue;
    }

    for (const issue of issuesResult.value) {
      const existing = allIssuesMap.get(issue.id);
      if (existing !== undefined) {
        existing.userIds.push(userId);
      } else {
        allIssuesMap.set(issue.id, { issue, userIds: [userId] });
      }
    }
  }

  const totalActive = allIssuesMap.size;
  logger.info({ totalActive, threshold: config.activationThreshold }, 'Issue count check');

  // Step 3: Check threshold
  if (totalActive <= config.activationThreshold) {
    logger.info(
      { totalActive, threshold: config.activationThreshold },
      'Issue count below threshold, skipping pruning'
    );
    return ok({
      skipped: true,
      skipReason: `Issue count (${String(totalActive)}) is below threshold (${String(config.activationThreshold)})`,
      totalActive,
      deleted: 0,
      remaining: totalActive,
      deletedCandidates: [],
      failedDeletions: [],
      durationMs: Date.now() - startTime,
    });
  }

  // Step 4: Classify candidates using Gemini
  const allIssues = [...allIssuesMap.values()].map((entry) => entry.issue);
  const classifyResult = await classifier.classifyCandidates(
    allIssues,
    config.targetDeletionCount,
    logger
  );

  if (!classifyResult.ok) {
    return classifyResult;
  }

  const candidates = classifyResult.value;
  logger.info({ candidateCount: candidates.length }, 'Classification complete, starting deletions');

  // Step 5: Get API key for deletion (use first connected user's key)
  const connectionResult = await connectionRepo.getFullConnection(userIds[0]!);
  if (!connectionResult.ok) {
    return connectionResult;
  }
  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'No connected user found for API operations' });
  }

  // Step 6: Delete candidates
  const deletedCandidates: PruneStats['deletedCandidates'] = [];
  const failedDeletions: PruneStats['failedDeletions'] = [];

  for (const candidate of candidates) {
    logger.info(
      { identifier: candidate.identifier, score: candidate.score, reason: candidate.reason, category: candidate.category },
      'Deleting issue'
    );

    const deleteResult = await linearClient.deleteIssue(connection.apiKey, candidate.id);

    if (!deleteResult.ok) {
      logger.error(
        { identifier: candidate.identifier, error: deleteResult.error },
        'Failed to delete issue from Linear'
      );
      failedDeletions.push({ identifier: candidate.identifier, error: deleteResult.error.message });
      continue;
    }

    // Clean up all local Firestore copies (multi-tenant: each user may have a copy)
    const entry = allIssuesMap.get(candidate.id);
    if (entry !== undefined) {
      for (const userId of entry.userIds) {
        const localDeleteResult = await issueRepo.deleteById(candidate.id, userId);
        if (!localDeleteResult.ok) {
          logger.warn(
            { identifier: candidate.identifier, userId, error: localDeleteResult.error },
            'Failed to delete local Firestore copy (non-fatal)'
          );
        }
      }
    }

    deletedCandidates.push({
      identifier: candidate.identifier,
      title: candidate.title,
      reason: candidate.reason,
    });

    logger.info({ identifier: candidate.identifier }, 'Issue deleted successfully');
  }

  const stats: PruneStats = {
    skipped: false,
    totalActive,
    deleted: deletedCandidates.length,
    remaining: totalActive - deletedCandidates.length,
    deletedCandidates,
    failedDeletions,
    durationMs: Date.now() - startTime,
  };

  logger.info(stats, 'Issue pruning workflow completed');

  return ok(stats);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Export from domain/index.ts**

Add to `apps/linear-agent/src/domain/index.ts`:

```typescript
export {
  pruneIssues,
  type PruneIssuesDeps,
} from './useCases/pruneIssuesUseCase.js';
```

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/domain/useCases/pruneIssuesUseCase.ts apps/linear-agent/src/__tests__/domain/useCases/pruneIssuesUseCase.test.ts apps/linear-agent/src/domain/index.ts
git commit -m "feat(linear-agent): implement pruneIssues use case with Gemini classification"
```

---

## Task 5: Update ServiceContainer and Wire Up Dependencies

**Files:**
- Modify: `apps/linear-agent/src/services.ts`
- Modify: `apps/linear-agent/src/domain/index.ts` (already done in Task 4)

- [ ] **Step 1: Add IssuePruningClassifier to ServiceContainer**

In `apps/linear-agent/src/services.ts`:

1. Import the classifier factory:
```typescript
import { createIssuePruningClassifier } from './infra/llm/issuePruningClassifier.js';
import type { IssuePruningClassifier } from './domain/index.js';
```

2. Add to `ServiceContainer` interface:
```typescript
issuePruningClassifier: IssuePruningClassifier;
```

3. In `initServices()`, create the classifier. The platform Gemini API key is already available via `process.env['INTEXURAOS_GEMINI_APP_API_KEY']`. Create a Gemini client for classification:

```typescript
import { createGeminiClient } from '@intexuraos/infra-gemini';
import { LlmModels, getLlmPricingConfig } from '@intexuraos/llm-pricing';
```

Then in `initServices()`:

```typescript
const geminiApiKey = process.env['INTEXURAOS_GEMINI_APP_API_KEY'];
const issuePruningClassifier = geminiApiKey !== undefined && geminiApiKey !== ''
  ? createIssuePruningClassifier({
      generate: async (prompt: string) => {
        const pricingConfig = getLlmPricingConfig(LlmModels.Gemini25Flash);
        const geminiClient = createGeminiClient({
          apiKey: geminiApiKey,
          model: LlmModels.Gemini25Flash,
          userId: 'system:pruning',
          pricing: {
            inputPricePerMillion: pricingConfig.inputPricePerMillion,
            outputPricePerMillion: pricingConfig.outputPricePerMillion,
          },
          logger,
        });
        return await geminiClient.generate(prompt);
      },
      logger,
    })
  : createIssuePruningClassifier({
      generate: async () => ({ ok: false as const, error: { code: 'INVALID_KEY', message: 'No Gemini API key configured' } }),
      logger,
    });
```

4. Add `issuePruningClassifier` to the container object.

- [ ] **Step 2: Verify build**

Run: `cd /repo && pnpm build --filter=linear-agent`
Expected: Build succeeds. May need to run `pnpm install && pnpm build` if `infra-gemini` or `llm-pricing` imports fail.

- [ ] **Step 3: Commit**

```bash
git add apps/linear-agent/src/services.ts
git commit -m "feat(linear-agent): wire IssuePruningClassifier into ServiceContainer"
```

---

## Task 6: Add Internal Route for Pruning

**Files:**
- Modify: `apps/linear-agent/src/routes/internalRoutes.ts`
- Create: `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { ok, err } from '@intexuraos/common-core';
import type { FastifyInstance } from 'fastify';

function createFakeServices(): ServiceContainer {
  return {
    connectionRepository: {
      getAllConnectedUserIds: vi.fn().mockResolvedValue(ok(['user-1'])),
      getFullConnection: vi.fn().mockResolvedValue(
        ok({ userId: 'user-1', apiKey: 'key', teamId: 't', teamName: 'T', webhookSecret: null, connected: true, createdAt: '', updatedAt: '' })
      ),
      save: vi.fn(),
      getConnection: vi.fn(),
      getApiKey: vi.fn(),
      isConnected: vi.fn(),
      disconnect: vi.fn(),
      findUserIdsByTeamId: vi.fn(),
      findWebhookSecretByTeamId: vi.fn(),
      updateWebhookSecret: vi.fn(),
    },
    linearApiClient: {
      validateAndGetTeams: vi.fn(),
      createIssue: vi.fn(),
      listIssues: vi.fn(),
      getIssue: vi.fn(),
      getIssueByIdentifier: vi.fn(),
      updateIssueState: vi.fn(),
      updateIssue: vi.fn(),
      createComment: vi.fn(),
      listIssueLabels: vi.fn(),
      getWorkflowStates: vi.fn(),
      deleteIssue: vi.fn().mockResolvedValue(ok(undefined)),
    },
    extractionService: { extractIssue: vi.fn() },
    failedIssueRepository: { create: vi.fn(), listByUser: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn() },
    processedActionRepository: { getByActionId: vi.fn(), create: vi.fn() },
    issueRepository: {
      save: vi.fn(),
      findById: vi.fn(),
      findByIdentifier: vi.fn(),
      findByIdentifiers: vi.fn(),
      listByUserId: vi.fn().mockResolvedValue(ok([])),
      deleteById: vi.fn().mockResolvedValue(ok(undefined)),
      findUserIdsByIssueId: vi.fn(),
    },
    commentRepository: {
      save: vi.fn(), findById: vi.fn(), listByIssueId: vi.fn(),
      countByIssueId: vi.fn(), getCommentSummaries: vi.fn(), deleteById: vi.fn(),
    },
    userServiceClient: { getLlmClient: vi.fn(), getLlmClientDirect: vi.fn() } as any,
    codeAgentClient: { triggerCodeTask: vi.fn() },
    issuePruningClassifier: {
      classifyCandidates: vi.fn().mockResolvedValue(ok([])),
    },
  } as unknown as ServiceContainer;
}

describe('POST /internal/linear/prune-issues', () => {
  let app: FastifyInstance;
  let services: ServiceContainer;

  beforeEach(async () => {
    services = createFakeServices();
    setServices(services);
    app = await createServer();
  });

  afterEach(async () => {
    resetServices();
    await app.close();
  });

  it('returns 200 with skipped stats when below threshold', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
      headers: { 'x-internal-auth': 'test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.skipped).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts OIDC Bearer token auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/linear/prune-issues',
      headers: { authorization: 'Bearer oidc-token-from-scheduler' },
    });

    expect(response.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Add the route handler**

In `apps/linear-agent/src/routes/internalRoutes.ts`, add the new route inside the `internalRoutes` callback, before the `done()` call. Import `pruneIssues` at the top:

```typescript
import { processLinearAction, validateIssue, generateIssueTitle, fullSync, fullSyncAllUsers, pruneIssues } from '../domain/index.js';
```

Add the route:

```typescript
  // Issue pruning endpoint — triggered by Cloud Scheduler hourly (INT-1164)
  fastify.post(
    '/internal/linear/prune-issues',
    {
      schema: {
        operationId: 'pruneIssues',
        summary: 'Prune redundant Linear issues to stay under subscription limit',
        description: 'Checks active issue count and, if above threshold, uses Gemini to classify and delete redundant issues',
        tags: ['internal'],
        response: {
          200: {
            description: 'Pruning completed (may have been skipped if below threshold)',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['skipped', 'totalActive', 'deleted', 'remaining', 'deletedCandidates', 'failedDeletions', 'durationMs'],
                properties: {
                  skipped: { type: 'boolean', description: 'Whether pruning was skipped' },
                  skipReason: { type: 'string', description: 'Reason for skipping' },
                  totalActive: { type: 'number', description: 'Total active issues before pruning' },
                  deleted: { type: 'number', description: 'Number of issues deleted' },
                  remaining: { type: 'number', description: 'Issues remaining after pruning' },
                  deletedCandidates: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        identifier: { type: 'string' },
                        title: { type: 'string' },
                        reason: { type: 'string' },
                      },
                    },
                  },
                  failedDeletions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        identifier: { type: 'string' },
                        error: { type: 'string' },
                      },
                    },
                  },
                  durationMs: { type: 'number', description: 'Duration in milliseconds' },
                },
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal Server Error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);

      // Cloud Scheduler uses OIDC tokens validated by Cloud Run at infrastructure level.
      // Direct service calls use x-internal-auth header.
      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          reply.status(401);
          return await reply.fail('UNAUTHORIZED', 'Unauthorized');
        }
      }

      const services = getServices();

      request.log.info('internal/pruneIssues: starting issue pruning');

      const result = await pruneIssues({
        connectionRepo: services.connectionRepository,
        issueRepo: services.issueRepository,
        linearClient: services.linearApiClient,
        classifier: services.issuePruningClassifier,
        logger: request.log as unknown as Logger,
        config: {
          activationThreshold: 200,
          targetDeletionCount: 30,
        },
      });

      if (!result.ok) {
        return await handleLinearError(result.error, reply);
      }

      request.log.info(
        {
          skipped: result.value.skipped,
          deleted: result.value.deleted,
          remaining: result.value.remaining,
        },
        'internal/pruneIssues: pruning completed'
      );

      return await reply.ok(result.value);
    }
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /repo && pnpm vitest run apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run full workspace verification**

Run: `cd /repo && pnpm run verify:workspace:tracked -- linear-agent`
Expected: All tests pass, coverage meets threshold.

- [ ] **Step 6: Commit**

```bash
git add apps/linear-agent/src/routes/internalRoutes.ts apps/linear-agent/src/__tests__/routes/pruneIssuesRoute.test.ts
git commit -m "feat(linear-agent): add POST /internal/linear/prune-issues endpoint"
```

---

## Task 7: Terraform Cloud Scheduler Job

**Files:**
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Add the Cloud Scheduler job**

In `terraform/environments/dev/main.tf`, after the existing `linear_sync_hourly` block (around line 1576), add:

```hcl
# -----------------------------------------------------------------------------
# Cloud Scheduler - Linear Issues Prune (Hourly) (INT-1164)
# Monitors active issue count and prunes redundant issues when above threshold
# -----------------------------------------------------------------------------

resource "google_cloud_scheduler_job" "linear_issues_prune_hourly" {
  name        = "intexuraos-linear-issues-prune-hourly-${var.environment}"
  description = "Prune redundant Linear issues when count exceeds threshold"
  schedule    = "30 * * * *"
  time_zone   = "UTC"
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://${local.services.linear_agent.name}-${local.cloud_run_url_suffix}/internal/linear/prune-issues"

    oidc_token {
      service_account_email = google_service_account.cloud_scheduler.email
      audience              = "https://${local.services.linear_agent.name}-${local.cloud_run_url_suffix}"
    }
  }

  retry_config {
    retry_count          = 1
    max_retry_duration   = "120s"
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_service_iam_member.scheduler_invokes_linear_agent,
    module.linear_agent,
  ]
}
```

**Note:** Schedule is `30 * * * *` (30 minutes past each hour) to offset from the existing sync at `0 * * * *`. This ensures sync completes before pruning evaluates the issue count. The IAM binding `scheduler_invokes_linear_agent` already exists and grants the scheduler service account `roles/run.invoker` on the linear-agent Cloud Run service.

- [ ] **Step 2: Validate Terraform syntax**

Run: `cd /repo/terraform/environments/dev && terraform validate`
Expected: "Success! The configuration is valid."

- [ ] **Step 3: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "infra: add Cloud Scheduler job for hourly Linear issue pruning (INT-1164)"
```

---

## Task 8: Final Integration Verification

- [ ] **Step 1: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: All workspaces pass tests and coverage.

- [ ] **Step 2: Commit any remaining fixes**

If any tests need adjustment due to ServiceContainer changes (e.g., existing tests that mock the container), fix them and commit.

- [ ] **Step 3: Final commit**

```bash
git commit -m "test(linear-agent): update existing tests for issuePruningClassifier in ServiceContainer"
```
