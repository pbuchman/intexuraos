# Issue Groups Backend Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move code tasks grouping, filtering, sorting, and pagination from client-side to a new `GET /code/issue-groups` backend endpoint, with a new `/code-tasks-v3` frontend page consuming it.

**Architecture:** Backend fetches all non-archived tasks for the user, serializes them, hydrates Linear data, groups by `linearIssueId`, computes pipeline + aggregate status, applies server-side filtering/sorting, and returns paginated groups with global counts. Frontend receives pre-grouped data and renders directly — no client-side grouping.

**Tech Stack:** Fastify (backend routes), Firestore (data), React + TypeScript (frontend), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-29-issue-groups-backend-pagination-design.md`

---

## File Structure

### Backend — `apps/code-agent/`

| File                                                            | Responsibility                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/issueGrouping/types.ts`                             | All type definitions: `GroupStatus`, `SortOption`, `StepState`, `PipelineStepData`, `PipelineState`, `IssueGroup`, `ApiCodeTask` |
| `src/domain/issueGrouping/constants.ts`                         | `NON_ARCHIVED_STATUSES`, `ACTIVE_STATUSES`, `AGENT_TYPE_LABELS`                                                                  |
| `src/domain/issueGrouping/labelHelpers.ts`                      | `normalizeLabel`, `hasImplementationReadyLabel`, `hasMergeReadyLabel`, `isTaskMergeable`, `getTaskMergeUrl`                      |
| `src/domain/issueGrouping/groupByLinearIssue.ts`                | `groupByLinearIssue`, `derivePipeline`, `deriveAggregateStatus` (private)                                                        |
| `src/domain/issueGrouping/sortIssueGroups.ts`                   | `sortIssueGroups`, `parseLinearIssueNumber`                                                                                      |
| `src/domain/issueGrouping/cursor.ts`                            | `encodeCursor`, `decodeCursor`                                                                                                   |
| `src/domain/issueGrouping/index.ts`                             | Barrel export                                                                                                                    |
| `src/routes/code/issueGroupRoutes.ts`                           | `GET /code/issue-groups` route handler                                                                                           |
| `src/__tests__/domain/issueGrouping/labelHelpers.test.ts`       | Label helper unit tests                                                                                                          |
| `src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` | Grouping + pipeline + aggregate status tests                                                                                     |
| `src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`    | Sort function tests                                                                                                              |
| `src/__tests__/domain/issueGrouping/cursor.test.ts`             | Cursor encode/decode tests                                                                                                       |
| `src/__tests__/routes/code/issueGroups.test.ts`                 | Route integration tests                                                                                                          |

### Frontend — `apps/web/`

| File                                          | Responsibility                                              |
| --------------------------------------------- | ----------------------------------------------------------- |
| `src/types/issueGroups.ts`                    | API response types matching backend output                  |
| `src/services/issueGroupsApi.ts`              | `listIssueGroups()` API client function                     |
| `src/hooks/useIssueGroups.ts`                 | Hook for group-level data with pagination, refresh, polling |
| `src/pages/CodeTasksPageV3.tsx`               | New page component consuming pre-grouped data               |
| `src/__tests__/hooks/useIssueGroups.test.ts`  | Hook tests                                                  |
| `src/__tests__/pages/CodeTasksPageV3.test.ts` | Page rendering tests                                        |

### New shared module

| File                                                            | Responsibility                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/domain/serialization/codeTaskSerializer.ts`                | `taskToApiResponse` — extracted from `codeRoutes.ts` (Finding 4) |

### Existing files modified (minimal)

| File                                                                  | Change                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/codeRoutes.ts`                            | Replace local `taskToApiResponse` with import from serialization module                  |
| `apps/code-agent/src/repositories/codeTaskRepository.ts`              | Add `listAllNonArchived(userId)` to interface (Finding 1+2)                              |
| `apps/code-agent/src/repositories/firestoreCodeTaskRepository.ts`     | Implement `listAllNonArchived` — unbounded Firestore query (Finding 1+2)                 |
| `apps/code-agent/src/routes/code/index.ts`                            | Add barrel export for `issueGroupRoutes`                                                 |
| `apps/code-agent/src/routes/index.ts`                                 | Add `app.register(issueGroupRoutes, deps)` + import                                      |
| `apps/web/src/App.tsx`                                                | Add `<Route path="/code-tasks-v3">` + lazy import                                        |

---

## Task 1: Backend Types + Constants

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/types.ts`
- Create: `apps/code-agent/src/domain/issueGrouping/constants.ts`

- [ ] **Step 1: Create `types.ts`**

```typescript
// apps/code-agent/src/domain/issueGrouping/types.ts

/**
 * Types for issue grouping — ported from apps/web/src/utils/issueGroups.ts.
 * Operates on serialized API-shaped tasks (ISO string dates), not Firestore domain objects.
 */

import type { AgentType, TaskStatus, WorkerType } from '../models/codeTask.js';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';
export type SortOption = 'linear-id' | 'pr-number' | 'created-time' | 'started-time';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';

export interface PipelineStepData {
  agentType: string;
  state: StepState;
  label: string;
}

export interface PipelineState {
  steps: PipelineStepData[];
  pr: { url: string; number: string } | null;
  failedAttempts: number;
  archivedCount: number;
}

/**
 * Serialized CodeTask as returned by the API (ISO string dates, no Firestore Timestamps).
 * Mirrors apps/web/src/types/index.ts CodeTask interface.
 */
export interface ApiCodeTask {
  id: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: WorkerType;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  status: TaskStatus;
  dedupKey: string;
  callbackReceived: boolean;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssue?: {
    identifier: string;
    parentIdentifier?: string | null;
    title: string;
    state: { name: string; type: string };
    priority: number;
    assignee: { id: string; name: string } | null;
    labels: { id: string; name: string }[];
    url: string;
    commentCount: number;
    lastCommentAt: string | null;
  };
  prNumber?: number;
  agentType?: AgentType;
  implementationTaskId?: string;
  parentTaskId?: string;
  followUpReason?: string;
  result?: {
    prUrl?: string;
    branch?: string;
    commits?: number;
    summary?: string;
    ciFailed?: boolean;
    partialWork?: boolean;
    rebaseResult?: 'success' | 'conflict' | 'skipped';
    review_comments_posted?: string;
    review_types?: string;
    requirements_tracker_updated?: string;
    needs_remediation?: string;
  };
  error?: {
    code: string;
    message: string;
    remediation?: {
      retryAfter?: number;
      manualSteps?: string;
      supportLink?: string;
    };
  };
}

export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: ApiCodeTask['linearIssue'] | undefined;
  tasks: ApiCodeTask[];
  pipeline: PipelineState;
  latestTask: ApiCodeTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
}

export interface IssueGroupsResponse {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  nextCursor?: string;
}
```

- [ ] **Step 2: Create `constants.ts`**

```typescript
// apps/code-agent/src/domain/issueGrouping/constants.ts

import type { TaskStatus } from '../models/codeTask.js';

export const NON_ARCHIVED_STATUSES: readonly TaskStatus[] = [
  'queued', 'dispatched', 'running', 'planned', 'implemented',
  'reviewed', 'failed', 'interrupted', 'cancelled',
] as const;

export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'running', 'dispatched', 'queued',
]);

export const AGENT_TYPE_LABELS: Record<string, string> = {
  planning: 'Planning',
  execution: 'Execution',
  pull_request: 'PR Task',
  review: 'Review',
  remediation: 'Remediation',
  merge: 'Merge',
};

export function getAgentTypeLabel(agentType: string): string {
  const label = AGENT_TYPE_LABELS[agentType];
  if (label !== undefined) {
    return label;
  }
  return agentType.charAt(0).toUpperCase() + agentType.slice(1);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/types.ts apps/code-agent/src/domain/issueGrouping/constants.ts
git commit -m "feat(code-agent): add issue grouping types and constants (INT-1173)"
```

---

## Task 2: Backend Label Helpers + Tests

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/labelHelpers.ts`
- Create: `apps/code-agent/src/__tests__/domain/issueGrouping/labelHelpers.test.ts`

- [ ] **Step 1: Write failing tests for label helpers**

```typescript
// apps/code-agent/src/__tests__/domain/issueGrouping/labelHelpers.test.ts

import { describe, it, expect } from 'vitest';
import {
  hasImplementationReadyLabel,
  hasMergeReadyLabel,
  isTaskMergeable,
  getTaskMergeUrl,
} from '../../../domain/issueGrouping/labelHelpers.js';

describe('hasImplementationReadyLabel', () => {
  it('returns true when labels are undefined', () => {
    expect(hasImplementationReadyLabel(undefined)).toBe(true);
  });

  it('returns true when labels are empty', () => {
    expect(hasImplementationReadyLabel([])).toBe(true);
  });

  it('returns true when ready-to-implement label exists', () => {
    expect(hasImplementationReadyLabel([{ name: 'ready-to-implement' }])).toBe(true);
  });

  it('returns true for code-task label (backward compat)', () => {
    expect(hasImplementationReadyLabel([{ name: 'code-task' }])).toBe(true);
  });

  it('returns true with normalization (underscores, spaces, casing)', () => {
    expect(hasImplementationReadyLabel([{ name: 'Ready_To_Implement' }])).toBe(true);
    expect(hasImplementationReadyLabel([{ name: 'Code Task' }])).toBe(true);
  });

  it('returns false when labels exist but none match', () => {
    expect(hasImplementationReadyLabel([{ name: 'bug' }, { name: 'feature' }])).toBe(false);
  });
});

describe('hasMergeReadyLabel', () => {
  it('returns false when labels are undefined', () => {
    expect(hasMergeReadyLabel(undefined)).toBe(false);
  });

  it('returns false when labels are empty', () => {
    expect(hasMergeReadyLabel([])).toBe(false);
  });

  it('returns true when ready-to-merge label exists', () => {
    expect(hasMergeReadyLabel([{ name: 'ready-to-merge' }])).toBe(true);
  });

  it('returns true with normalization', () => {
    expect(hasMergeReadyLabel([{ name: 'Ready_To_Merge' }])).toBe(true);
  });

  it('returns false when labels exist but none match', () => {
    expect(hasMergeReadyLabel([{ name: 'ready-to-implement' }])).toBe(false);
  });
});

describe('isTaskMergeable', () => {
  it('returns true for implemented task with prUrl and merge label', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/1' },
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });

  it('returns true for reviewed task with prNumber and merge label', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(true);
  });

  it('returns true for reviewed task with prNumber and needs_remediation=0', () => {
    expect(isTaskMergeable({
      status: 'reviewed',
      prNumber: 42,
      result: { needs_remediation: '0' },
      linearIssue: { labels: [{ name: 'some-other-label' }] },
    })).toBe(true);
  });

  it('returns false without merge label or passedReview', () => {
    expect(isTaskMergeable({
      status: 'implemented',
      result: { prUrl: 'https://github.com/org/repo/pull/1' },
    })).toBe(false);
  });

  it('returns false for planned task even with merge label', () => {
    expect(isTaskMergeable({
      status: 'planned',
      linearIssue: { labels: [{ name: 'ready-to-merge' }] },
    })).toBe(false);
  });
});

describe('getTaskMergeUrl', () => {
  it('prefers result.prUrl', () => {
    expect(getTaskMergeUrl({
      repository: 'org/repo',
      prNumber: 42,
      result: { prUrl: 'https://github.com/org/repo/pull/99' },
    })).toBe('https://github.com/org/repo/pull/99');
  });

  it('constructs URL from repository + prNumber', () => {
    expect(getTaskMergeUrl({
      repository: 'org/repo',
      prNumber: 42,
    })).toBe('https://github.com/org/repo/pull/42');
  });

  it('returns undefined when no PR info', () => {
    expect(getTaskMergeUrl({ repository: 'org/repo' })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/labelHelpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement label helpers**

Port from `apps/web/src/utils/issueGroups.ts` lines 70-164. The code is near-identical — only the import path for types changes.

```typescript
// apps/code-agent/src/domain/issueGrouping/labelHelpers.ts

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

const REMEDIATION_NOT_NEEDED = '0';

const IMPLEMENTATION_READY_LABELS: ReadonlySet<string> = new Set([
  'ready-to-implement',
  'code-task',
]);

export function hasImplementationReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return true;
  }
  return labels.some((l) => IMPLEMENTATION_READY_LABELS.has(normalizeLabel(l.name)));
}

export function hasMergeReadyLabel(labels: { name: string }[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) {
    return false;
  }
  return labels.some((l) => normalizeLabel(l.name) === 'ready-to-merge');
}

export function isTaskMergeable(task: {
  status: string;
  prNumber?: number;
  result?: { prUrl?: string; needs_remediation?: string };
  linearIssue?: { labels: { name: string }[] };
}): boolean {
  const hasLabel = hasMergeReadyLabel(task.linearIssue?.labels);
  const passedReview = task.status === 'reviewed' && task.result?.needs_remediation === REMEDIATION_NOT_NEEDED;

  if (!hasLabel && !passedReview) {
    return false;
  }
  return (
    (task.status === 'implemented' && task.result?.prUrl !== undefined) ||
    (task.status === 'reviewed' && task.prNumber !== undefined)
  );
}

export function getTaskMergeUrl(task: {
  repository: string;
  prNumber?: number;
  result?: { prUrl?: string };
}): string | undefined {
  if (task.result?.prUrl !== undefined) {
    return task.result.prUrl;
  }
  if (task.prNumber !== undefined) {
    return `https://github.com/${task.repository}/pull/${String(task.prNumber)}`;
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/labelHelpers.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/labelHelpers.ts apps/code-agent/src/__tests__/domain/issueGrouping/labelHelpers.test.ts
git commit -m "feat(code-agent): add label helpers for issue grouping (INT-1173)"
```

---

## Task 3: Backend Cursor Helpers + Tests

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/cursor.ts`
- Create: `apps/code-agent/src/__tests__/domain/issueGrouping/cursor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/code-agent/src/__tests__/domain/issueGrouping/cursor.test.ts

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../domain/issueGrouping/cursor.js';

describe('cursor encoding', () => {
  it('round-trips an index', () => {
    const cursor = encodeCursor(20);
    expect(decodeCursor(cursor)).toEqual({ index: 20 });
  });

  it('round-trips index 0', () => {
    const cursor = encodeCursor(0);
    expect(decodeCursor(cursor)).toEqual({ index: 0 });
  });

  it('produces a base64url string', () => {
    const cursor = encodeCursor(42);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('throws on invalid cursor', () => {
    expect(() => decodeCursor('not-valid-json')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/cursor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cursor helpers**

```typescript
// apps/code-agent/src/domain/issueGrouping/cursor.ts

export function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index })).toString('base64url');
}

export function decodeCursor(cursor: string): { index: number } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { index: number };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/cursor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/cursor.ts apps/code-agent/src/__tests__/domain/issueGrouping/cursor.test.ts
git commit -m "feat(code-agent): add cursor encode/decode for issue group pagination (INT-1173)"
```

---

## Task 4: Backend `groupByLinearIssue` + Tests

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`
- Create: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`

This is the largest task — port of `groupByLinearIssue`, `derivePipeline`, and `deriveAggregateStatus` from `apps/web/src/utils/issueGroups.ts` lines 157-415.

- [ ] **Step 1: Write failing tests**

Tests should cover: empty input, single task standalone group, multiple tasks grouped by linearIssueId, pipeline step derivation (planning → execution actionable), aggregate status priority (active > needs-action > failed > done), merge-ready actionable step, PR extraction from result.prUrl, review-task merge fallback (needs_remediation=0), standalone groups for tasks without linearIssueId, mostRecentDispatchedAt derivation.

Create `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts` with a factory helper:

```typescript
import { describe, it, expect } from 'vitest';
import { groupByLinearIssue } from '../../../domain/issueGrouping/groupByLinearIssue.js';
import type { ApiCodeTask } from '../../../domain/issueGrouping/types.js';

function makeTask(overrides: Partial<ApiCodeTask> = {}): ApiCodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    prompt: 'test',
    sanitizedPrompt: 'test',
    systemPromptHash: 'hash',
    workerType: 'opus',
    workerLocation: 'mac',
    repository: 'org/repo',
    baseBranch: 'main',
    traceId: 'trace-1',
    status: 'planned',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: '2026-03-29T10:00:00.000Z',
    updatedAt: '2026-03-29T10:00:00.000Z',
    ...overrides,
  };
}
```

Tests to include (write at least 12 test cases covering the behaviors listed above). Each test should create specific task arrays and assert on the returned `IssueGroup[]` structure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `groupByLinearIssue.ts`**

Port from `apps/web/src/utils/issueGroups.ts` lines 157-415. Key changes from the frontend version:

1. Import `ApiCodeTask` instead of `CodeTask` from `@/types`
2. Import `ACTIVE_STATUSES` from `./constants.js`
3. Import `hasImplementationReadyLabel`, `hasMergeReadyLabel` from `./labelHelpers.js`
4. Import `getAgentTypeLabel` from `./constants.js`
5. Import type `IssueGroup`, `PipelineState`, `PipelineStepData`, `StepState`, `GroupStatus` from `./types.js`
6. Use `TaskStatus` from `../models/codeTask.js` instead of `CodeTaskStatus`

The functions `deriveStepState`, `derivePipeline`, `deriveAggregateStatus` remain private (not exported). Only `groupByLinearIssue` is exported.

The logic is identical to the frontend — same sort order, same pipeline derivation, same aggregate status priority, same merge-ready fallback for review tasks with `needs_remediation === '0'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts
git commit -m "feat(code-agent): add groupByLinearIssue with pipeline and aggregate status (INT-1173)"
```

---

## Task 5: Backend `sortIssueGroups` + Tests

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/sortIssueGroups.ts`
- Create: `apps/code-agent/src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should cover all 4 sort options: `linear-id` (desc by issue number, standalone first), `pr-number` (desc, tasks with PR first), `created-time` (desc by latestTask.createdAt), `started-time` (desc by mostRecentDispatchedAt). Include edge cases: null linearIssueId, null pipeline.pr, undefined mostRecentDispatchedAt.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `sortIssueGroups.ts`**

Port from `apps/web/src/utils/issueGroups.ts` lines 34-44 (`parseLinearIssueNumber`) and 417-482 (`sortIssueGroups`). Import types from `./types.js`. Exports: `sortIssueGroups`, `parseLinearIssueNumber`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/sortIssueGroups.ts apps/code-agent/src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts
git commit -m "feat(code-agent): add sortIssueGroups with all sort options (INT-1173)"
```

---

## Task 6: Backend Barrel Export + Index

**Files:**
- Create: `apps/code-agent/src/domain/issueGrouping/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// apps/code-agent/src/domain/issueGrouping/index.ts

export type {
  GroupStatus,
  SortOption,
  StepState,
  PipelineStepData,
  PipelineState,
  ApiCodeTask,
  IssueGroup,
  IssueGroupsResponse,
} from './types.js';

export { NON_ARCHIVED_STATUSES, ACTIVE_STATUSES } from './constants.js';
export { hasImplementationReadyLabel, hasMergeReadyLabel } from './labelHelpers.js';
export { groupByLinearIssue } from './groupByLinearIssue.js';
export { sortIssueGroups, parseLinearIssueNumber } from './sortIssueGroups.js';
export { encodeCursor, decodeCursor } from './cursor.js';
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/issueGrouping/index.ts
git commit -m "feat(code-agent): add issue grouping barrel export (INT-1173)"
```

---

## Task 7: Backend Route Handler + Tests

**Files:**
- Create: `apps/code-agent/src/routes/code/issueGroupRoutes.ts`
- Create: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`

This is the integration task that wires everything together.

- [ ] **Step 1: Write failing integration tests**

Follow the pattern from `apps/code-agent/src/__tests__/routes/code/github-pre-events.test.ts`. Use `app.inject()` to test the route. Seed fake data via the repository.

Tests to cover:
1. Returns grouped tasks for a user
2. Counts reflect all groups (before filtering)
3. `?groupStatus=active` filters correctly
4. `?sortBy=pr-number` sorts correctly
5. Pagination: first page has `nextCursor`, second page uses cursor
6. Empty state: no tasks returns `{ groups: [], counts: { active: 0, 'needs-action': 0, done: 0, failed: 0 }, totalGroups: 0 }`
7. Linear hydration: groups contain linearIssue data
8. Tasks without linearIssueId create standalone groups
9. `?limit=1` returns exactly 1 group with nextCursor
10. Invalid groupStatus values are ignored

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/code-agent && npx vitest run src/__tests__/routes/code/issueGroups.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the route handler**

```typescript
// apps/code-agent/src/routes/code/issueGroupRoutes.ts

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { CodeRoutesOptions } from './github-pre-events.js';
import { taskToApiResponse } from '../../domain/serialization/codeTaskSerializer.js';
import {
  groupByLinearIssue,
  sortIssueGroups,
  encodeCursor,
  decodeCursor,
  NON_ARCHIVED_STATUSES,
  type GroupStatus,
  type SortOption,
} from '../../domain/issueGrouping/index.js';

const VALID_GROUP_STATUSES: GroupStatus[] = ['active', 'needs-action', 'done', 'failed'];
const VALID_SORT_OPTIONS: SortOption[] = ['linear-id', 'pr-number', 'created-time', 'started-time'];

const issueGroupRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, options, done) => {
  const { jwtValidator } = options;

  fastify.get(
    '/code/issue-groups',
    {
      onRequest: jwtValidator,
      schema: {
        operationId: 'listIssueGroups',
        summary: 'List code tasks grouped by Linear issue',
        tags: ['code-tasks'],
        querystring: {
          type: 'object',
          properties: {
            groupStatus: { type: 'string', description: 'Comma-separated group status filter' },
            sortBy: { type: 'string', enum: VALID_SORT_OPTIONS, default: 'linear-id' },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { groupStatus?: string; sortBy?: string; limit?: number; cursor?: string };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/issue-groups',
        includeParams: true,
      });

      const { codeTaskRepo, linearAgentClient } = getServices();
      /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      // Parse groupStatus filter
      let groupStatusFilter: GroupStatus[] | undefined;
      if (request.query.groupStatus !== undefined) {
        groupStatusFilter = request.query.groupStatus
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is GroupStatus => VALID_GROUP_STATUSES.includes(s as GroupStatus));
        if (groupStatusFilter.length === 0) {
          groupStatusFilter = undefined;
        }
      }

      const sortBy: SortOption =
        request.query.sortBy !== undefined && VALID_SORT_OPTIONS.includes(request.query.sortBy as SortOption)
          ? (request.query.sortBy as SortOption)
          : 'linear-id';

      /* v8 ignore start -- ts-type: Fastify schema injects default — ?? fallback unreachable @preserve */
      const limit = request.query.limit ?? 20;
      /* v8 ignore stop @preserve */

      // Step 1: Fetch all non-archived tasks (unbounded — no limit)
      const listResult = await codeTaskRepo.listAllNonArchived(userId);

      if (!listResult.ok) {
        request.log.error({ error: listResult.error }, 'Failed to list tasks for issue grouping');
        return await reply.fail('INTERNAL_ERROR', listResult.error.message);
      }

      // Step 2: Serialize to API shape
      const apiTasks = listResult.value.map(taskToApiResponse);

      // Step 3: Hydrate Linear labels
      const linearIssueIds = Array.from(
        new Set(
          apiTasks
            .map((t) => t.linearIssueId)
            .filter((id): id is string => id !== undefined)
        )
      );

      if (linearIssueIds.length > 0) {
        const linearResult = await linearAgentClient.fetchIssuesForDisplay({
          userId,
          identifiers: linearIssueIds,
        });

        if (linearResult.ok) {
          const issueMap = new Map(linearResult.value.map((issue) => [issue.identifier, issue]));
          for (const task of apiTasks) {
            if (task.linearIssueId !== undefined && issueMap.has(task.linearIssueId)) {
              (task as Record<string, unknown>).linearIssue = issueMap.get(task.linearIssueId);
            }
          }
        } else {
          request.log.warn(
            { userId, error: linearResult.error, issueCount: linearIssueIds.length },
            'Failed to hydrate Linear issues for issue groups'
          );
        }
      }

      // Step 4: Group
      const allGroups = groupByLinearIssue(apiTasks);

      // Step 5: Compute global counts (before filtering)
      const counts: Record<GroupStatus, number> = { active: 0, 'needs-action': 0, done: 0, failed: 0 };
      for (const group of allGroups) {
        if (group.aggregateStatus in counts) {
          counts[group.aggregateStatus as GroupStatus]++;
        }
      }

      // Step 6: Filter
      const filtered = groupStatusFilter !== undefined
        ? allGroups.filter((g) => groupStatusFilter.includes(g.aggregateStatus as GroupStatus))
        : allGroups.filter((g) => g.aggregateStatus !== 'archived');

      // Step 7: Sort
      const sorted = sortIssueGroups(filtered, sortBy);

      // Step 8: Paginate
      const startIndex = request.query.cursor !== undefined ? decodeCursor(request.query.cursor).index : 0;
      const page = sorted.slice(startIndex, startIndex + limit);
      const nextCursor = startIndex + limit < sorted.length
        ? encodeCursor(startIndex + limit)
        : undefined;

      return await reply.ok({
        groups: page,
        counts,
        totalGroups: sorted.length,
        ...(nextCursor !== undefined && { nextCursor }),
      });
    }
  );

  done();
};

export default issueGroupRoutes;
```

**Important:** The route uses `codeTaskRepo.listAllNonArchived(userId)` as mandated by the spec. This method performs an unbounded Firestore query (no `.limit()` call), ensuring all non-archived tasks are returned regardless of dataset size. The method must be added to the `CodeTaskRepository` interface and implemented in `firestoreCodeTaskRepository.ts` — see Task 7a below.

**Note:** `taskToApiResponse` is imported from `../../domain/serialization/codeTaskSerializer.js` (see Task 7b). Do NOT export from `codeRoutes.ts` — route handlers should be leaves in the dependency graph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/code-agent && npx vitest run src/__tests__/routes/code/issueGroups.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/code/issueGroupRoutes.ts apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts
git commit -m "feat(code-agent): add GET /code/issue-groups route handler (INT-1173)"
```

---

## Task 7a: Backend Repository Method — `listAllNonArchived`

**Files:**
- Modify: `apps/code-agent/src/repositories/codeTaskRepository.ts` (add interface method)
- Modify: `apps/code-agent/src/repositories/firestoreCodeTaskRepository.ts` (add implementation)
- Modify: `apps/code-agent/src/__tests__/repositories/firestoreCodeTaskRepository.test.ts` (add test)

- [ ] **Step 1: Write failing test for `listAllNonArchived`**

Add a test to `firestoreCodeTaskRepository.test.ts` that verifies:
- Returns all non-archived tasks for a user (no limit applied)
- Excludes archived tasks
- Returns tasks ordered by `createdAt` desc

- [ ] **Step 2: Add `listAllNonArchived` to `CodeTaskRepository` interface**

```typescript
listAllNonArchived(userId: string): Promise<Result<CodeTask[], RepositoryError>>
```

- [ ] **Step 3: Implement in `firestoreCodeTaskRepository.ts`**

```typescript
async listAllNonArchived(userId: string): Promise<Result<CodeTask[], RepositoryError>> {
  const query = this.collection
    .where('userId', '==', userId)
    .where('status', 'in', NON_ARCHIVED_STATUSES)
    .orderBy('createdAt', 'desc');

  const snapshot = await query.get();
  return Result.ok(snapshot.docs.map((doc) => this.fromFirestore(doc)));
}
```

No `.limit()` call — returns all matching documents. This is the spec-mandated approach that avoids silent truncation when a user's non-archived task count exceeds any arbitrary limit.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Update fake repository in test infrastructure**

Add `listAllNonArchived` to the fake/in-memory repository used in route tests.

- [ ] **Step 6: Commit**

---

## Task 7b: Extract `taskToApiResponse` to Serialization Module

**Files:**
- Create: `apps/code-agent/src/domain/serialization/codeTaskSerializer.ts`
- Modify: `apps/code-agent/src/routes/codeRoutes.ts` (import from new module instead of local function)

- [ ] **Step 1: Create `codeTaskSerializer.ts`**

Extract `taskToApiResponse` from `codeRoutes.ts` into `apps/code-agent/src/domain/serialization/codeTaskSerializer.ts`. This isolates the serialization concern and keeps route files as leaves in the dependency graph.

**Important:** Add `needs_remediation` to both the input and return type of `taskToApiResponse`:

```typescript
result?: {
  prUrl?: string;
  branch?: string;
  commits?: number;
  summary?: string;
  ciFailed?: boolean;
  partialWork?: boolean;
  rebaseResult?: 'success' | 'conflict' | 'skipped';
  review_comments_posted?: string;
  review_types?: string;
  requirements_tracker_updated?: string;
  needs_remediation?: string;  // ← Added: required for isTaskMergeable passedReview path
};
```

- [ ] **Step 2: Update `codeRoutes.ts`**

Replace the local `taskToApiResponse` function with an import:
```typescript
import { taskToApiResponse } from '../domain/serialization/codeTaskSerializer.js';
```

- [ ] **Step 3: Update `issueGroupRoutes.ts`**

Import from the shared serialization module:
```typescript
import { taskToApiResponse } from '../../domain/serialization/codeTaskSerializer.js';
```

- [ ] **Step 4: Run all code-agent tests to verify no regressions**
- [ ] **Step 5: Commit**

---

## Task 8: Backend Route Registration

**Files:**
- Modify: `apps/code-agent/src/routes/code/index.ts` (add export)
- Modify: `apps/code-agent/src/routes/index.ts` (add registration)

- [ ] **Step 1: Add barrel export in `routes/code/index.ts`**

Add after line 9 (`import githubEventLogRoute from './github-event-log.js';`):

```typescript
import issueGroupRoutes from './issueGroupRoutes.js';
```

Update the export line (line 11):

```typescript
export { githubPREventsRoute, githubPRSummariesRoute, githubEventLogRoute, issueGroupRoutes };
```

- [ ] **Step 2: Register route in `routes/index.ts`**

Add import to line 7:

```typescript
import { githubEventLogRoute, githubPREventsRoute, githubPRSummariesRoute, issueGroupRoutes } from './code/index.js';
```

Add registration after line 22 (`await app.register(githubEventLogRoute, deps);`):

```typescript
  await app.register(issueGroupRoutes, deps);
```

- [ ] **Step 3: Run full test suite for code-agent**

Run: `cd apps/code-agent && npx vitest run`
Expected: All existing tests pass, new tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/code-agent/src/routes/code/index.ts apps/code-agent/src/routes/index.ts
git commit -m "feat(code-agent): register issue-groups route (INT-1173)"
```

---

## Task 9: Frontend Types + API Client

**Files:**
- Create: `apps/web/src/types/issueGroups.ts`
- Create: `apps/web/src/services/issueGroupsApi.ts`

- [ ] **Step 1: Create frontend types**

```typescript
// apps/web/src/types/issueGroups.ts

import type { CodeTask } from './index.js';

export type GroupStatus = 'active' | 'needs-action' | 'done' | 'failed';
export type SortOption = 'linear-id' | 'pr-number' | 'created-time' | 'started-time';
export type StepState = 'completed' | 'running' | 'dispatched' | 'queued' | 'failed' | 'waiting' | 'actionable';

export interface PipelineStepData {
  agentType: string;
  state: StepState;
  label: string;
}

export interface PipelineState {
  steps: PipelineStepData[];
  pr: { url: string; number: string } | null;
  failedAttempts: number;
  archivedCount: number;
}

export interface IssueGroup {
  linearIssueId: string | null;
  linearIssue: CodeTask['linearIssue'] | undefined;
  tasks: CodeTask[];
  pipeline: PipelineState;
  latestTask: CodeTask;
  aggregateStatus: GroupStatus;
  mostRecentDispatchedAt?: string;
}

export interface ListIssueGroupsResponse {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  nextCursor?: string;
}
```

- [ ] **Step 2: Create API client**

```typescript
// apps/web/src/services/issueGroupsApi.ts

import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { ListIssueGroupsResponse, GroupStatus, SortOption } from '@/types/issueGroups';

export async function listIssueGroups(
  accessToken: string,
  options?: {
    groupStatus?: GroupStatus[];
    sortBy?: SortOption;
    limit?: number;
    cursor?: string;
  }
): Promise<ListIssueGroupsResponse> {
  const params = new URLSearchParams();
  if (options?.groupStatus !== undefined && options.groupStatus.length > 0) {
    params.set('groupStatus', options.groupStatus.join(','));
  }
  if (options?.sortBy !== undefined) {
    params.set('sortBy', options.sortBy);
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const query = params.toString();
  const path = query !== '' ? `/code/issue-groups?${query}` : '/code/issue-groups';
  return await apiRequest<ListIssueGroupsResponse>(config.codeAgentUrl, path, accessToken);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/issueGroups.ts apps/web/src/services/issueGroupsApi.ts
git commit -m "feat(web): add issue groups types and API client (INT-1173)"
```

---

## Task 10: Frontend `useIssueGroups` Hook + Tests

**Files:**
- Create: `apps/web/src/hooks/useIssueGroups.ts`
- Create: `apps/web/src/__tests__/hooks/useIssueGroups.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases to cover:
1. Initial load fetches groups and sets state
2. `loadMore()` appends groups using cursor
3. `refresh()` re-fetches with expanded limit when groups > 20
4. `refresh()` does multi-request refill when groups > 100
5. `mergeGroups()` preserves references for unchanged groups
6. Filter/sort changes reset to page 1
7. Polling fires every 30s when `counts.active > 0`
8. Tab visibility change triggers refresh

Mock `listIssueGroups` from `@/services/issueGroupsApi` and `useAuth` from `@/context`. Use `renderHook` from `@testing-library/react`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/hooks/useIssueGroups.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

Port the structure from `apps/web/src/hooks/useCodeTasks.ts`, replacing task-level logic with group-level:

Key differences from `useCodeTasks`:
- Calls `listIssueGroups` instead of `listCodeTasksApi`
- State includes `groups`, `counts`, `totalGroups` instead of `tasks`
- `loadMore()` appends groups: `setGroups(prev => [...prev, ...data.groups])`
- `refresh()` computes `limit: Math.max(groups.length, 20)` for single-request; for >100 groups, does sequential batches of 100
- `mergeGroups()` compares by `linearIssueId ?? latestTask.id`, checks `aggregateStatus` + `latestTask.updatedAt`
- Polling enabled when `counts.active > 0` (not scanning tasks)
- `options` takes `groupStatus` and `sortBy` instead of `status`
- When `options.groupStatus` or `options.sortBy` changes, reset state and re-fetch from page 1

The hook does NOT include `submitTask` or `deleteTask` — those are handled by importing from the existing `codeAgentApi.ts` directly in the page component (same as current `CodeTasksPage` does for `startImplementation`, `retryCodeTask`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/hooks/useIssueGroups.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useIssueGroups.ts apps/web/src/__tests__/hooks/useIssueGroups.test.ts
git commit -m "feat(web): add useIssueGroups hook with group-level pagination (INT-1173)"
```

---

## Task 11: Frontend `CodeTasksPageV3` + Tests

**Files:**
- Create: `apps/web/src/pages/CodeTasksPageV3.tsx`
- Create: `apps/web/src/__tests__/pages/CodeTasksPageV3.test.ts`

- [ ] **Step 1: Write failing tests**

Tests to cover:
1. Renders loading spinner during initial load
2. Renders issue groups after load
3. Filter chip toggles trigger re-fetch (verify `listIssueGroups` called with updated `groupStatus`)
4. Sort button change triggers re-fetch
5. Load More button appears when `hasMore === true`
6. Load More button hidden when `hasMore === false`
7. Empty state with "No code tasks yet"
8. Empty state with "No issues match the selected filters" when filters active
9. Counts in header come from response (not computed locally)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/pages/CodeTasksPageV3.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the page**

Structure from `apps/web/src/pages/CodeTasksPage.tsx` but significantly simplified:

**Key imports to reuse (NOT copy):**
```typescript
import { IssueGroupRow } from '@/components/code-tasks/IssueGroupRow';
import { Button, CodeTaskLogsModal, Layout } from '@/components';
import { useAuth } from '@/context';
import { useTimeTick } from '@/hooks';
import { startImplementation, retryCodeTask } from '@/services/codeAgentApi';
```

**New imports:**
```typescript
import { useIssueGroups } from '@/hooks/useIssueGroups';
import type { GroupStatus, SortOption } from '@/types/issueGroups';
```

**What changes from CodeTasksPage:**
- No `groupByLinearIssue`, `sortIssueGroups`, `ACTIVE_STATUSES` imports
- No `allGroups`, `filteredGroups` useMemo — `groups` comes directly from hook
- No `apiStatuses` computation — hook takes `groupStatus` directly
- `counts` comes from hook response, not local computation
- `timeTick` enabled when `counts.active > 0`
- Filter toggling calls `setActiveFilters` which changes hook options → triggers re-fetch
- Sort changing calls `setActiveSort` which changes hook options → triggers re-fetch
- `PageHeader` uses `counts` and `totalGroups` from response
- localStorage keys: `code-tasks-v3-group-filter`, `code-tasks-v3-sort`
- `GroupStatus` type from `@/types/issueGroups` (no `'archived'` value)

**Inline components** (copied from CodeTasksPage, adapted):
- `PageHeader` — updated to use `totalGroups` and response `counts`
- `StatusPipeline` — same UI, no `'archived'` option
- `SortSelector` — same UI
- `ColumnHeader` — same UI

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/pages/CodeTasksPageV3.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/CodeTasksPageV3.tsx apps/web/src/__tests__/pages/CodeTasksPageV3.test.ts
git commit -m "feat(web): add CodeTasksPageV3 with server-side grouping (INT-1173)"
```

---

## Task 12: Frontend Route Registration

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add lazy import**

At the top of `App.tsx` with the other lazy imports, add:

```typescript
const CodeTasksPageV3 = lazy(() => import('./pages/CodeTasksPageV3.js').then(m => ({ default: m.CodeTasksPageV3 })));
```

- [ ] **Step 2: Add route**

After the `/code-tasks/merge-queue` route (around line 350), add:

```tsx
<Route
  path="/code-tasks-v3"
  element={
    <ProtectedRoute>
      <CodeTasksPageV3 />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Run full web app tests**

Run: `cd apps/web && npx vitest run`
Expected: All existing tests pass, new tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): register /code-tasks-v3 route (INT-1173)"
```

---

## Task 13: Full CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: No build errors

- [ ] **Step 2: Run workspace verification for code-agent**

Run: `pnpm run verify:workspace:tracked -- code-agent`
Expected: All checks pass (lint, type-check, test, coverage)

- [ ] **Step 3: Run workspace verification for web**

Run: `pnpm run verify:workspace:tracked -- web`
Expected: All checks pass

- [ ] **Step 4: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass across all workspaces

- [ ] **Step 5: Final commit (if any fixes needed)**

Fix any CI issues, commit with descriptive message.
