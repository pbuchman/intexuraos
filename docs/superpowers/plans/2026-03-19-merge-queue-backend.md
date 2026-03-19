# Merge Queue Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a merge queue feature to code-agent that automatically merges PRs to a base branch one-at-a-time via a cron-driven tick loop.

**Architecture:** Hexagonal — domain model + use case → Firestore repository → GitHub PR client port extensions → route handlers. A 1-minute cron calls `/internal/merge-queue/tick` which processes all active watches. JWT-authenticated routes let the web UI create/cancel watches and query PR state from GitHub.

**Tech Stack:** TypeScript, Fastify, Firestore, GitHub REST API, `@intexuraos/common-core` Result type, `@intexuraos/common-http` internal auth.

**Spec:** `docs/superpowers/specs/2026-03-19-merge-queue-design.md`

---

## File Structure

### New files (code-agent)

| File                                                              | Responsibility                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/domain/models/mergeQueueWatch.ts`                            | Domain model interfaces: `MergeQueueWatch`, `MergedPr`, `SkippedPr`, status types    |
| `src/domain/repositories/mergeQueueWatchRepository.ts`            | Repository port interface                                                            |
| `src/domain/usecases/mergeQueueTick.ts`                           | Tick use case — processes one merge cycle for all active watches                     |
| `src/infra/firestore/mergeQueueWatchRepository.ts`                | Firestore implementation of repository                                               |
| `src/routes/merge-queue/mergeQueueRoutes.ts`                      | JWT-authenticated routes: create/cancel watch, list watches, list branches, list PRs |
| `src/routes/merge-queue/mergeQueueTickRoute.ts`                   | Internal auth route: tick endpoint                                                   |
| `src/routes/merge-queue/index.ts`                                 | Re-export barrel                                                                     |
| `src/__tests__/domain/usecases/mergeQueueTick.test.ts`            | Unit tests for tick use case                                                         |
| `src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`       | Route integration tests (app.inject)                                                 |
| `src/__tests__/routes/merge-queue/mergeQueueTickRoute.test.ts`    | Tick route integration tests                                                         |
| `src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts` | Repository unit tests                                                                |

### Modified files (code-agent)

| File                                     | Change                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/domain/ports/gitHubPRClient.ts`     | Add `mergePullRequest`, `getCombinedCheckStatus` methods; add `headSha` to `GitHubPullRequestDetails` |
| `src/infra/http/gitHubPRHttpClient.ts`   | Implement new methods                                                                                 |
| `src/services.ts`                        | Add `mergeQueueWatchRepo` to `ServiceContainer`; create it in `initServices`                          |
| `src/routes/index.ts`                    | Register new route files                                                                              |
| `firestore-collections.json` (repo root) | Add `merge_queue_watches` collection                                                                  |

---

## Task 1: Domain Model

**Files:**
- Create: `apps/code-agent/src/domain/models/mergeQueueWatch.ts`

- [ ] **Step 1: Create domain model**

```typescript
// apps/code-agent/src/domain/models/mergeQueueWatch.ts
import type { Timestamp } from '@google-cloud/firestore';

export type MergeQueueWatchStatus = 'active' | 'drained' | 'cancelled';

export type SkipReason = 'merge_conflict' | 'checks_failing' | 'checks_pending' | 'mergeability_unknown' | 'not_eligible_author';

export interface MergedPr {
  prNumber: number;
  title: string;
  mergedAt: Timestamp;
}

export interface SkippedPr {
  prNumber: number;
  reason: SkipReason;
}

export interface MergeQueueWatch {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: MergeQueueWatchStatus;
  mergedPrs: MergedPr[];
  skippedPrs: SkippedPr[];
  lastError: string | null;
  lastErrorAt: Timestamp | null;
  createdAt: Timestamp;
  lastTickAt: Timestamp | null;
  drainedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/models/mergeQueueWatch.ts
git commit -m "feat(code-agent): add MergeQueueWatch domain model"
```

---

## Task 2: Repository Port

**Files:**
- Create: `apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts`

- [ ] **Step 1: Create repository interface**

```typescript
// apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts
import type { Result } from '@intexuraos/common-core';
import type { MergeQueueWatch, MergedPr, SkippedPr } from '../models/mergeQueueWatch.js';

export interface MergeQueueWatchRepositoryError {
  code: 'FIRESTORE_ERROR' | 'NOT_FOUND' | 'CONFLICT';
  message: string;
}

export interface CreateWatchInput {
  userId: string;
  owner: string;
  repo: string;
  baseBranch: string;
}

export interface UpdateWatchInput {
  lastTickAt?: Date;
  skippedPrs?: SkippedPr[];
  lastError?: string | null;
  lastErrorAt?: Date | null;
  status?: MergeQueueWatch['status'];
  drainedAt?: Date | null;
  cancelledAt?: Date | null;
}

export interface MergeQueueWatchRepository {
  create(input: CreateWatchInput): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>>;
  findById(id: string): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>>;
  findActiveByUserAndBranch(
    userId: string,
    owner: string,
    repo: string,
    baseBranch: string
  ): Promise<Result<MergeQueueWatch | null, MergeQueueWatchRepositoryError>>;
  findAllActive(): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>>;
  findByUserAndRepo(
    userId: string,
    owner: string,
    repo: string
  ): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>>;
  update(id: string, input: UpdateWatchInput): Promise<Result<void, MergeQueueWatchRepositoryError>>;
  appendMergedPr(id: string, mergedPr: MergedPr): Promise<Result<void, MergeQueueWatchRepositoryError>>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/code-agent/src/domain/repositories/mergeQueueWatchRepository.ts
git commit -m "feat(code-agent): add MergeQueueWatchRepository port"
```

---

## Task 3: GitHubPRClient Port Extensions

**Files:**
- Modify: `apps/code-agent/src/domain/ports/gitHubPRClient.ts`
- Test: `apps/code-agent/src/__tests__/infra/http/gitHubPRHttpClient.test.ts` (if exists, update; if not, note that HTTP client tests are done via route-level integration tests)

- [ ] **Step 1: Add `headSha` to `GitHubPullRequestDetails`**

In `apps/code-agent/src/domain/ports/gitHubPRClient.ts`, add `headSha` field:

```typescript
export interface GitHubPullRequestDetails {
  number: number;
  title: string;
  body: string | null;
  authorLogin: string;
  baseBranch: string;
  headBranch: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  headSha: string;  // NEW
}
```

- [ ] **Step 2: Add `mergePullRequest` to `GitHubPRClient` interface**

Append to the `GitHubPRClient` interface:

```typescript
  /**
   * Merge a pull request. Returns 405 if already merged — treat as success.
   */
  mergePullRequest(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
    mergeMethod: 'merge',
    commitTitle?: string
  ): Promise<Result<{ sha: string; merged: boolean }, GitHubPRClientError>>;

  /**
   * Get combined status check state for a commit ref.
   */
  getCombinedCheckStatus(
    token: string,
    owner: string,
    repo: string,
    ref: string
  ): Promise<Result<{ state: 'success' | 'failure' | 'pending' }, GitHubPRClientError>>;
```

- [ ] **Step 3: Commit**

```bash
git add apps/code-agent/src/domain/ports/gitHubPRClient.ts
git commit -m "feat(code-agent): add mergePullRequest and getCombinedCheckStatus to GitHubPRClient port"
```

---

## Task 4: GitHubPRClient HTTP Implementation

**Files:**
- Modify: `apps/code-agent/src/infra/http/gitHubPRHttpClient.ts`

- [ ] **Step 1: Update `getPullRequestDetails` to return `headSha`**

In the `getPullRequestDetails` method, the GitHub API response already includes `head.sha`. Update the response mapping to include it:

```typescript
// Inside getPullRequestDetails response mapping:
return ok({
  number: data.number,
  title: data.title,
  body: data.body,
  authorLogin: data.user.login,
  baseBranch: data.base.ref,
  headBranch: data.head.ref,
  mergeable: data.mergeable,
  mergeableState: data.mergeable_state,
  headSha: data.head.sha,  // NEW — add this field
});
```

Update the `as` type assertion to include `head: { ref: string; sha: string }`.

- [ ] **Step 2: Implement `mergePullRequest`**

Add to the object returned by `createGitHubPRHttpClient`:

```typescript
async mergePullRequest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  mergeMethod: 'merge',
  commitTitle?: string
): Promise<Result<{ sha: string; merged: boolean }, GitHubPRClientError>> {
  try {
    const body: Record<string, string> = { merge_method: mergeMethod };
    if (commitTitle !== undefined) {
      body['commit_title'] = commitTitle;
    }

    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${String(pullNumber)}/merge`,
      {
        method: 'PUT',
        headers: githubHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as { sha: string; merged: boolean };
      return ok({ sha: data.sha, merged: data.merged });
    }

    // 405 = already merged (idempotent)
    if (response.status === 405) {
      return ok({ sha: '', merged: true });
    }

    // 409 = merge conflict at merge time
    if (response.status === 409) {
      return err({ code: 'API_ERROR', message: `PR #${String(pullNumber)} has a merge conflict` });
    }

    return err(mapErrorStatus(response.status, `Failed to merge PR #${String(pullNumber)} in ${owner}/${repo}`));
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
  }
},
```

- [ ] **Step 3: Implement `getCombinedCheckStatus`**

```typescript
async getCombinedCheckStatus(
  token: string,
  owner: string,
  repo: string,
  ref: string
): Promise<Result<{ state: 'success' | 'failure' | 'pending' }, GitHubPRClientError>> {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/status`,
      {
        method: 'GET',
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(config.timeoutMs),
      }
    );

    if (response.ok) {
      const data = (await response.json()) as { state: string };
      const state = data.state === 'success' ? 'success'
        : data.state === 'failure' || data.state === 'error' ? 'failure'
        : 'pending';
      return ok({ state });
    }

    return err(mapErrorStatus(response.status, `Failed to get check status for ${ref} in ${owner}/${repo}`));
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
  }
},
```

- [ ] **Step 4: Update any fake/mock implementations**

Search for `GitHubPRClient` fake implementations in test helpers. Add stub implementations of the two new methods to any fakes so existing tests still compile:

```bash
grep -r "GitHubPRClient" apps/code-agent/src/__tests__/helpers/ --include="*.ts" -l
```

For each file, add:

```typescript
mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
getCombinedCheckStatus: vi.fn().mockResolvedValue(ok({ state: 'success' })),
```

- [ ] **Step 5: Build and verify compilation**

Run: `pnpm build`

Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/infra/http/gitHubPRHttpClient.ts
git add apps/code-agent/src/__tests__/helpers/
git commit -m "feat(code-agent): implement mergePullRequest and getCombinedCheckStatus in HTTP client"
```

---

## Task 5: Firestore Repository Implementation

**Files:**
- Create: `apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts`
- Create: `apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`

- [ ] **Step 1: Write failing tests for the repository**

Create `apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`:

Test cases:
- `create` — creates a watch, returns it with status `active` and empty arrays
- `create` — rejects duplicate active watch for same (userId, owner, repo, baseBranch) with `CONFLICT`
- `findById` — returns watch by ID
- `findById` — returns `NOT_FOUND` for nonexistent ID
- `findActiveByUserAndBranch` — returns the active watch or null
- `findAllActive` — returns only watches with status `active`
- `findByUserAndRepo` — returns all watches for a user+repo combo
- `update` — updates status, lastTickAt, skippedPrs
- `appendMergedPr` — appends to mergedPrs array using Firestore `FieldValue.arrayUnion`

Use the real Firestore emulator or the existing test Firestore setup (check how `eventDecisionRepository.test.ts` sets up its tests — use the same pattern).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`

Expected: All tests fail (module not found).

- [ ] **Step 3: Implement the repository**

Create `apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts`:

Follow the `eventDecisionRepository.ts` pattern:
- Collection name: `merge_queue_watches`
- Use `crypto.randomUUID()` prefixed with `watch_` for IDs
- `create`: Check for existing active watch first (query by userId+owner+repo+baseBranch+status=active), return `CONFLICT` if found. Set status to `active`, empty arrays, null timestamps.
- `findAllActive`: Query `where('status', '==', 'active')`
- `appendMergedPr`: Use `FieldValue.arrayUnion()` for atomic append (safe for concurrent ticks)
- `update`: Use `docRef.update()` with only the provided fields

```typescript
import type { Firestore } from '@google-cloud/firestore';
import { FieldValue } from '@google-cloud/firestore';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  MergeQueueWatchRepository,
  MergeQueueWatchRepositoryError,
  CreateWatchInput,
  UpdateWatchInput,
} from '../../domain/repositories/mergeQueueWatchRepository.js';
import type { MergeQueueWatch, MergedPr } from '../../domain/models/mergeQueueWatch.js';

const COLLECTION = 'merge_queue_watches';

interface MergeQueueWatchRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export function createFirestoreMergeQueueWatchRepository(
  deps: MergeQueueWatchRepositoryDeps
): MergeQueueWatchRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION);

  return {
    // ... implement all methods following eventDecisionRepository pattern
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/infra/firestore/mergeQueueWatchRepository.ts
git add apps/code-agent/src/__tests__/infra/firestore/mergeQueueWatchRepository.test.ts
git commit -m "feat(code-agent): implement Firestore MergeQueueWatchRepository"
```

---

## Task 6: Register in Services + Firestore Collections

**Files:**
- Modify: `apps/code-agent/src/services.ts`
- Modify: `firestore-collections.json`

- [ ] **Step 1: Add to `firestore-collections.json`**

```json
"merge_queue_watches": {
  "owner": "code-agent",
  "description": "Merge queue watch state for automated PR merging"
}
```

- [ ] **Step 2: Add to `ServiceContainer` interface in `services.ts`**

Add to the interface:

```typescript
mergeQueueWatchRepo: MergeQueueWatchRepository;
```

Add the import:

```typescript
import type { MergeQueueWatchRepository } from './domain/repositories/mergeQueueWatchRepository.js';
import { createFirestoreMergeQueueWatchRepository } from './infra/firestore/mergeQueueWatchRepository.js';
```

- [ ] **Step 3: Create in `initServices`**

Add after the other repo creations:

```typescript
const mergeQueueWatchRepo = createFirestoreMergeQueueWatchRepository({ firestore, logger });
```

Add to the container assignment:

```typescript
mergeQueueWatchRepo,
```

- [ ] **Step 4: Update test helpers**

Search for all files that call `setServices()` with a mock container:

```bash
grep -r "setServices(" apps/code-agent/src/__tests__ --include="*.ts" -l
```

Add `mergeQueueWatchRepo` to each mock container. Use a minimal fake:

```typescript
mergeQueueWatchRepo: {
  create: vi.fn(),
  findById: vi.fn(),
  findActiveByUserAndBranch: vi.fn(),
  findAllActive: vi.fn(),
  findByUserAndRepo: vi.fn(),
  update: vi.fn(),
  appendMergedPr: vi.fn(),
},
```

- [ ] **Step 5: Build and verify**

Run: `pnpm build`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add firestore-collections.json
git add apps/code-agent/src/services.ts
git add apps/code-agent/src/__tests__/helpers/
git commit -m "feat(code-agent): register MergeQueueWatchRepository in services and firestore-collections"
```

---

## Task 7: Tick Use Case

**Files:**
- Create: `apps/code-agent/src/domain/usecases/mergeQueueTick.ts`
- Create: `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`:

Test cases (use fake `GitHubPRClient` and fake `MergeQueueWatchRepository`):

1. **No active watches** — returns empty results array
2. **Merges oldest eligible PR** — given 3 eligible PRs (created Mar 14, Mar 16, Mar 18), merges the Mar 14 one
3. **Skips ineligible authors** — PR by `dependabot[bot]` (not in ALLOWED_BOTS) is skipped with `not_eligible_author`
4. **Skips conflicting PR, merges next** — first eligible PR has `mergeable: false`, second has `mergeable: true` + checks pass → merges second
5. **Skips checks-failing PR** — `mergeable: true` but checks `failure` → skip, record `checks_failing`
6. **Skips checks-pending PR** — checks `pending` → skip, record `checks_pending`
7. **Handles `mergeable: null`** — skip, record `mergeability_unknown`
8. **Drains when zero eligible PRs remain** — no open PRs from eligible authors → status set to `drained`
9. **Stays active when skipped PRs exist** — 2 eligible PRs both conflicting → action `skipped_all`, status stays `active`
10. **Token resolution failure** — `userServiceClient` returns error → action `error`, `lastError` set
11. **Already-merged PR (405)** — merge returns 405 → skip to next PR, do not add to `mergedPrs`
12. **Merge conflict at merge time (409)** — merge returns API_ERROR → skip PR, try next
13. **Clears lastError on successful tick** — watch had lastError, tick succeeds → lastError cleared

Deps interface for the use case:

```typescript
interface MergeQueueTickDeps {
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  allowedBots: ReadonlySet<string>;
  logger: Logger;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`

Expected: All tests fail.

- [ ] **Step 3: Implement the use case**

Create `apps/code-agent/src/domain/usecases/mergeQueueTick.ts`:

```typescript
import type { Result } from '@intexuraos/common-core';
import { ok, getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { MergeQueueWatchRepository } from '../repositories/mergeQueueWatchRepository.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { SkippedPr } from '../models/mergeQueueWatch.js';
import { Timestamp } from '@google-cloud/firestore';

export type TickAction = 'merged' | 'skipped_all' | 'drained' | 'error';

export interface TickResult {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  action: TickAction;
  mergedPrNumber?: number;
  remainingPrs: number;
  skipped: SkippedPr[];
}

export interface MergeQueueTickDeps {
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  allowedBots: ReadonlySet<string>;
  logger: Logger;
}

export type MergeQueueTickUseCase = () => Promise<Result<TickResult[]>>;

export function createMergeQueueTickUseCase(deps: MergeQueueTickDeps): MergeQueueTickUseCase {
  const { mergeQueueWatchRepo, gitHubPRClient, userServiceClient, allowedBots, logger } = deps;

  return async (): Promise<Result<TickResult[]>> => {
    // 1. Query all active watches
    // 2. For each watch: resolve token, list PRs, filter eligible, iterate oldest-first
    // 3. For first mergeable: merge, append to mergedPrs, return 'merged'
    // 4. If none mergeable: 'skipped_all' or 'drained'
    // Follow the tick logic from the spec exactly
    // See spec section "Tick Logic (use case)" for the complete algorithm
  };
}
```

Follow the spec's tick logic algorithm exactly. Key implementation details:
- Resolve GitHub username from `userServiceClient` to compare with PR authors
- Sort PRs by `createdAt` ASC, tiebreak by PR number ASC
- For `mergeable: null`, use skip reason `mergeability_unknown`
- On 405 from merge: `sha` will be empty string — skip to next PR without adding to `mergedPrs`
- On API_ERROR from merge (409 conflict): skip PR with `merge_conflict`, continue to next eligible
- Use `appendMergedPr` (atomic Firestore arrayUnion) for the merge record
- Use `update` for skippedPrs, lastTickAt, lastError, status transitions

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts`

Expected: All 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/domain/usecases/mergeQueueTick.ts
git add apps/code-agent/src/__tests__/domain/usecases/mergeQueueTick.test.ts
git commit -m "feat(code-agent): implement MergeQueueTick use case with TDD"
```

---

## Task 8: Tick Route (Internal Auth)

**Files:**
- Create: `apps/code-agent/src/routes/merge-queue/mergeQueueTickRoute.ts`
- Create: `apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueTickRoute.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases using `app.inject()`:
1. **Rejects without internal auth** — returns 401
2. **Returns results for active watches** — mock tick use case, verify response shape
3. **Returns empty results when no active watches** — returns `{ results: [] }`
4. **Calls `logIncomingRequest`** — verify it's called

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueTickRoute.test.ts`

- [ ] **Step 3: Implement the route**

Create `apps/code-agent/src/routes/merge-queue/mergeQueueTickRoute.ts`:

```typescript
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { createMergeQueueTickUseCase } from '../../domain/usecases/mergeQueueTick.js';
import { ALLOWED_BOTS } from '../webhooks/github.js';

export const mergeQueueTickRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/merge-queue/tick',
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-queue/tick',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for merge-queue tick');
        return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      const services = getServices();
      const tick = createMergeQueueTickUseCase({
        mergeQueueWatchRepo: services.mergeQueueWatchRepo,
        gitHubPRClient: services.gitHubPRClient,
        userServiceClient: services.userServiceClient,
        allowedBots: ALLOWED_BOTS,
        logger: request.log,
      });

      const result = await tick();

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({ results: result.value }); // @allow-result-access -- narrowed above
    }
  );

  done();
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueTickRoute.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/mergeQueueTickRoute.ts
git add apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueTickRoute.test.ts
git commit -m "feat(code-agent): add POST /internal/merge-queue/tick route"
```

---

## Task 9: JWT-Authenticated Routes (Watch CRUD + GitHub Proxy)

**Files:**
- Create: `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`
- Create: `apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases using `app.inject()`:

**POST /code/merge-queue/watch:**
1. Creates watch — returns 200 with watchId, status `active`
2. Rejects duplicate — returns 409
3. Rejects without JWT — returns 401

**DELETE /code/merge-queue/watch/:watchId:**
4. Cancels watch — returns 200 with `{ success: true }`
5. Rejects if not owner — returns 403
6. Returns 404 for nonexistent watch

**GET /code/merge-queue/watches:**
7. Returns watches for user+repo

**GET /code/merge-queue/branches:**
8. Returns branches with open PR counts (mock `gitHubPRClient.listOpenPullRequestsByBaseBranch` is not quite right — this endpoint needs all open PRs, not just for one branch; it calls GitHub list PRs API and groups by base branch)

**GET /code/merge-queue/prs:**
9. Returns PRs with mergeability and check status
10. Marks `authorIsEligible` correctly for eligible vs non-eligible authors

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`

- [ ] **Step 3: Implement the routes**

Create `apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts`:

Follow the `github-pr-summaries.ts` pattern for JWT auth. Key details:

- All routes wrapped in `fastify.register()` with `fastify.addHook('onRequest', jwtValidator)`
- Every handler calls `logIncomingRequest()`
- `POST /code/merge-queue/watch`:
  - Extract `userId` from JWT (via `request.user`)
  - Resolve user's GitHub token via `userServiceClient` to verify repo access
  - Call `mergeQueueWatchRepo.create()`
  - Handle `CONFLICT` error → 409
- `DELETE /code/merge-queue/watch/:watchId`:
  - Find watch by ID, check `userId` matches requesting user
  - Set status to `cancelled`, `cancelledAt` to now
- `GET /code/merge-queue/watches`:
  - Query params: `owner`, `repo`
  - Call `mergeQueueWatchRepo.findByUserAndRepo()`
- `GET /code/merge-queue/branches`:
  - Resolve user's GitHub token
  - Call GitHub API: `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100`
  - This needs a new port method OR direct fetch (since it's not branch-specific). **Decision: add a `listAllOpenPullRequests` method to the port** that returns all open PRs, then group by base branch in the route handler. Alternatively, reuse `listOpenPullRequestsByBaseBranch` but that requires knowing branches upfront. **Simpler: add a thin `listAllOpenPullRequests` method.**
  - Group by `baseBranch`, count per branch
- `GET /code/merge-queue/prs`:
  - Use `listOpenPullRequestsByBaseBranch()` to get PR list
  - For each PR, call `getPullRequestDetails()` + `getCombinedCheckStatus()`
  - Use `Promise.all()` to parallelize detail fetches
  - Compute `authorIsEligible` against requesting user's GitHub username + `ALLOWED_BOTS`

- [ ] **Step 4: If needed, add `listAllOpenPullRequests` to the port**

If the branches endpoint needs all open PRs (not filtered by base branch), add to `gitHubPRClient.ts`:

```typescript
listAllOpenPullRequests(
  token: string,
  owner: string,
  repo: string
): Promise<Result<GitHubPullRequestListItem[], GitHubPRClientError>>;
```

And implement in `gitHubPRHttpClient.ts`:

```typescript
async listAllOpenPullRequests(token, owner, repo) {
  // GET /repos/{owner}/{repo}/pulls?state=open&per_page=100&sort=created&direction=asc
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/mergeQueueRoutes.ts
git add apps/code-agent/src/__tests__/routes/merge-queue/mergeQueueRoutes.test.ts
git add apps/code-agent/src/domain/ports/gitHubPRClient.ts
git add apps/code-agent/src/infra/http/gitHubPRHttpClient.ts
git commit -m "feat(code-agent): add merge queue JWT routes (watch CRUD, branches, PRs)"
```

---

## Task 10: Route Registration + Barrel Export

**Files:**
- Create: `apps/code-agent/src/routes/merge-queue/index.ts`
- Modify: `apps/code-agent/src/routes/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// apps/code-agent/src/routes/merge-queue/index.ts
export { mergeQueueRoutes } from './mergeQueueRoutes.js';
export { mergeQueueTickRoute } from './mergeQueueTickRoute.js';
```

- [ ] **Step 2: Register in routes/index.ts**

Add imports:

```typescript
import { mergeQueueRoutes, mergeQueueTickRoute } from './merge-queue/index.js';
```

Add registrations in `registerRoutes`:

```typescript
await app.register(mergeQueueRoutes, deps);
await app.register(mergeQueueTickRoute);
```

- [ ] **Step 3: Build and verify**

Run: `pnpm build`

Expected: No errors.

- [ ] **Step 4: Run full test suite**

Run: `pnpm run verify:workspace:tracked -- code-agent`

Expected: All tests pass. Coverage meets threshold.

- [ ] **Step 5: Commit**

```bash
git add apps/code-agent/src/routes/merge-queue/index.ts
git add apps/code-agent/src/routes/index.ts
git commit -m "feat(code-agent): register merge queue routes"
```

---

## Task 11: Full CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

- [ ] **Step 2: Run full tracked CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-merge-queue.txt`

Expected: All workspaces pass.

- [ ] **Step 3: If failures, analyze and fix**

Run: `grep -E "error|FAIL" /tmp/ci-output-merge-queue.txt -C3`

Fix any issues. Re-run until clean.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(code-agent): fix CI issues from merge queue implementation"
```
