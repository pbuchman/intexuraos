# Merge Conflict Reconciliation Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace push-triggered merge conflict detection with a 1-minute cron that queries stale PR summaries and reconciles their mergeability status.

**Architecture:** Rename + rewire the existing `detectMergeConflictsOnPush` use case. The internal workflow logic (conflict dispatch, comment management, task reuse) is preserved unchanged. Only the trigger mechanism changes: push event → cron query of stale Firestore documents.

**Tech Stack:** TypeScript, Fastify, Firestore, GitHub REST API, `@intexuraos/common-core` Result type.

**Spec:** `docs/superpowers/specs/2026-03-19-merge-conflict-reconciliation-design.md`
**Linear:** INT-1023

---

## Endpoint Changes

### Created
- `POST /internal/merge-conflicts/reconcile` — cron endpoint, internal auth

### Modified
- Push webhook handler (`routes/webhooks/github.ts`) — remove conflict detection call

### Removed
- `mergeConflictDetector` from `ServiceContainer`

### Unchanged
- All other endpoints

---

## File Structure

### Renamed files

| Before                                                             | After                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/domain/usecases/detectMergeConflictsOnPush.ts`                | `src/domain/usecases/reconcileMergeConflicts.ts`                |
| `src/domain/services/mergeConflictDetector.ts`                     | `src/domain/services/mergeConflictReconciler.ts`                |
| `src/__tests__/domain/useCases/detectMergeConflictsOnPush.test.ts` | `src/__tests__/domain/useCases/reconcileMergeConflicts.test.ts` |

### New files

| File                                                          | Responsibility                        |
| ------------------------------------------------------------- | ------------------------------------- |
| `src/routes/merge-conflicts/reconcileRoute.ts`                | Internal auth route for cron endpoint |
| `src/routes/merge-conflicts/index.ts`                         | Barrel export                         |
| `src/__tests__/routes/merge-conflicts/reconcileRoute.test.ts` | Route integration tests               |

### Modified files

| File                                                   | Change                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `src/domain/repositories/gitHubPRSummaryRepository.ts` | Add `findStaleConflictSummaries()` method                        |
| `src/infra/firestore/gitHubPRSummariesRepository.ts`   | Implement `findStaleConflictSummaries()`                         |
| `src/services.ts`                                      | Remove `mergeConflictDetector` from container                    |
| `src/routes/webhooks/github.ts`                        | Remove `mergeConflictDetector.detectOnPush()` call               |
| `src/routes/index.ts`                                  | Register new route                                               |
| `src/__tests__/helpers/mockServices.ts`                | No change needed (mergeConflictDetector is not in mock services) |

All file paths below are relative to `apps/code-agent/`.

---

## Task 1: Add `findStaleConflictSummaries` to Repository

**Files:**
- Modify: `src/domain/repositories/gitHubPRSummaryRepository.ts`
- Modify: `src/infra/firestore/gitHubPRSummariesRepository.ts`
- Test: `src/__tests__/infra/firestore/gitHubPRSummariesRepository.test.ts` (if exists, add tests; otherwise create)

- [ ] **Step 1: Write failing test for findStaleConflictSummaries**

Test cases:
- Returns summaries where `mergeConflictStatus` is `'unknown'`
- Returns summaries where `mergeConflictStatus` is `null`
- Returns summaries where `lastConflictCheckedAt` is older than 5 minutes
- Does NOT return summaries where status is `'clean'` and `lastConflictCheckedAt` is recent
- Deduplicates results from the two queries

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/gitHubPRSummariesRepository.test.ts`

- [ ] **Step 3: Add method to repository interface**

In `src/domain/repositories/gitHubPRSummaryRepository.ts`, add:

```typescript
findStaleConflictSummaries(): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>>;
```

- [ ] **Step 4: Implement in Firestore repository**

In `src/infra/firestore/gitHubPRSummariesRepository.ts`, implement:

```typescript
async findStaleConflictSummaries(): Promise<Result<GitHubPRSummary[], SummaryRepositoryError>> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Query 1: open PRs with unknown or null status
    const unknownSnapshot = await collection
      .where('state', '==', 'open')
      .where('mergeConflictStatus', 'in', ['unknown', null])
      .get();

    // Query 2: open PRs with stale lastConflictCheckedAt (older than 5 min)
    const staleSnapshot = await collection
      .where('state', '==', 'open')
      .where('lastConflictCheckedAt', '<', fiveMinutesAgo)
      .get();

    // Deduplicate by doc ID
    const seen = new Set<string>();
    const results: GitHubPRSummary[] = [];

    for (const doc of unknownSnapshot.docs) {
      seen.add(doc.id);
      results.push(mapDocToSummary(doc));
    }

    for (const doc of staleSnapshot.docs) {
      if (!seen.has(doc.id)) {
        results.push(mapDocToSummary(doc));
      }
    }

    return ok(results);
  } catch (error) {
    logger.error({ error: getErrorMessage(error) }, 'Failed to query stale conflict summaries');
    return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
  }
}
```

Note: Both queries need composite indexes:
- Index 1: `state` ASC + `mergeConflictStatus` ASC
- Index 2: `state` ASC + `lastConflictCheckedAt` ASC

Check if these exist in `apps/code-agent/migrations/`. If not, add migration files.

Also note: Firestore `in` queries with `null` may not match documents where the field is missing entirely. Test this. If `null` doesn't match, split into two separate equality queries: one for `'unknown'` and one explicit check for missing field.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/infra/firestore/gitHubPRSummariesRepository.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/domain/repositories/gitHubPRSummaryRepository.ts
git add src/infra/firestore/gitHubPRSummariesRepository.ts
git add src/__tests__/infra/firestore/gitHubPRSummariesRepository.test.ts
git commit -m "feat(code-agent): add findStaleConflictSummaries to PR summary repository"
```

---

## Task 2: Rename Use Case File

**Files:**
- Rename: `src/domain/usecases/detectMergeConflictsOnPush.ts` → `src/domain/usecases/reconcileMergeConflicts.ts`
- Rename: `src/domain/services/mergeConflictDetector.ts` → `src/domain/services/mergeConflictReconciler.ts`

- [ ] **Step 1: Rename files using git mv**

```bash
cd apps/code-agent
git mv src/domain/usecases/detectMergeConflictsOnPush.ts src/domain/usecases/reconcileMergeConflicts.ts
git mv src/domain/services/mergeConflictDetector.ts src/domain/services/mergeConflictReconciler.ts
```

- [ ] **Step 2: Update the interface in `mergeConflictReconciler.ts`**

Replace:

```typescript
export interface MergeConflictDetector {
  detectOnPush(event: GitHubPREvent, logger: Logger): Promise<void>;
}
```

With:

```typescript
export interface MergeConflictReconciler {
  reconcile(logger: Logger): Promise<ReconcileResult>;
}

export interface ReconcileResult {
  checked: number;
  conflicting: number;
  clean: number;
  stillUnknown: number;
  errors: number;
}
```

- [ ] **Step 3: Update the factory function name in `reconcileMergeConflicts.ts`**

Rename:
- `createDetectMergeConflictsOnPush` → `createMergeConflictReconciler`
- `processOpenSummaryOnPush` → `processOpenSummary`

Update the export and all internal references.

- [ ] **Step 4: Update all import paths across the codebase**

Search for imports of the old paths:

```bash
grep -r "detectMergeConflictsOnPush\|mergeConflictDetector" apps/code-agent/src/ --include="*.ts" -l
```

Update each file's imports to use the new paths and names. Key files:
- `src/services.ts` (import path + creation call)
- `src/routes/webhooks/github.ts` (import + usage — will be removed in Task 4, but fix import for now)
- Any test files that import the use case directly

- [ ] **Step 5: Build to verify all imports resolve**

Run: `pnpm build`

Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/usecases/reconcileMergeConflicts.ts src/domain/services/mergeConflictReconciler.ts src/services.ts src/routes/webhooks/github.ts
git commit -m "refactor(code-agent): rename detectMergeConflictsOnPush to reconcileMergeConflicts"
```

Note: `git mv` stages the rename automatically. Only need to `git add` files with updated imports.

---

## Task 3: Replace Push Entry Point with Cron Entry Point

**Files:**
- Modify: `src/domain/usecases/reconcileMergeConflicts.ts`

- [ ] **Step 1: Remove the `detectOnPush` entry point**

Delete the `detectOnPush` method (the one that parses `refs/heads/{branch}`, extracts the base branch, queries `findOpenByBaseBranch`, and iterates). This is the push-event-specific entry point.

- [ ] **Step 2: Update `processOpenSummary` signature — remove `GitHubPREvent` dependency**

The existing `processOpenSummaryOnPush` takes a `GitHubPREvent` parameter. In the cron context there is no event. Changes:

1. Remove `event: GitHubPREvent` parameter — the function only needs the `GitHubPRSummary`
2. Replace `event.repository` usage with `summary.repository`
3. Replace `event.id` (used for `traceId`/`actionId`) with a synthetic ID: `reconcile_${crypto.randomUUID()}`
4. **Refactor `SummaryUpdateParams` and `buildSummaryUpdateInput`**: These types/functions currently require a `GitHubPREvent`. Change `SummaryUpdateParams` to accept `repository: string` and `eventId: string` directly instead of `event: GitHubPREvent`. In `buildSummaryUpdateInput`, replace `event.repository` → `params.repository`, `event.id` → `params.eventId`, and make `lastActivityAt` optional (do not update it when called from cron — no new activity occurred, only update `lastConflictCheckedAt`).
5. **Refactor `ConflictWorkflowParams`**: The `eventId` field currently comes from the push event. Change the call site in `processOpenSummary` to pass the synthetic `reconcile_${crypto.randomUUID()}` ID.
6. Remove `sleep`, `mergeabilityRetries`, `retryDelayMs` from the deps interface — pass `mergeabilityRetries: 0` directly to `loadPullRequestDetails`

- [ ] **Step 3: Add `reconcile()` entry point**

Add a new public method that:
1. Calls `gitHubPRSummaryRepo.findStaleConflictSummaries()`
2. For each summary, calls the existing `processOpenSummary()` (renamed from `processOpenSummaryOnPush`)
3. Tracks counts: `checked`, `conflicting`, `clean`, `stillUnknown`, `errors`
4. Returns `ReconcileResult`

```typescript
async reconcile(logger: Logger): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, conflicting: 0, clean: 0, stillUnknown: 0, errors: 0 };

  const summariesResult = await gitHubPRSummaryRepo.findStaleConflictSummaries();
  if (!summariesResult.ok) {
    logger.error({ error: summariesResult.error.message }, 'Failed to query stale conflict summaries');
    throw new Error(summariesResult.error.message);
  }

  const summaries = summariesResult.value; // @allow-result-access -- narrowed above
  logger.info({ count: summaries.length }, 'Found stale PR summaries for conflict reconciliation');

  for (const summary of summaries) {
    try {
      const status = await processOpenSummary(summary, logger);
      result.checked++;
      if (status === 'conflicting') result.conflicting++;
      else if (status === 'clean') result.clean++;
      else if (status === 'unknown') result.stillUnknown++;
    } catch (error) {
      result.errors++;
      logger.error(
        { error: getErrorMessage(error), repository: summary.repository, prNumber: summary.pullRequestNumber },
        'Error processing PR summary during reconciliation'
      );
    }
  }

  logger.info(result, 'Merge conflict reconciliation completed');
  return result;
}
```

- [ ] **Step 3: Make `processOpenSummary` return the classified status**

Currently `processOpenSummaryOnPush` returns `void`. Modify it to return the classified `mergeConflictStatus` string so the `reconcile()` method can track counts:

```typescript
async function processOpenSummary(...): Promise<'conflicting' | 'clean' | 'unknown'> {
  // ... existing logic ...
  return status; // the classified status from classifyMergeConflictStatus()
}
```

- [ ] **Step 4: Remove or reduce the retry loop in `loadPullRequestDetails`**

The existing retry loop (2 retries × 500ms) was needed for push-event timing. In the cron context, if GitHub returns `null`, we just mark it `stillUnknown` and recheck next cycle. Set retries to 0 (single check, no delay):

```typescript
const mergeabilityRetries = 0;  // was 2 — cron will recheck next cycle
```

- [ ] **Step 5: Build to verify compilation**

Run: `pnpm build`

- [ ] **Step 6: Commit**

```bash
git add src/domain/usecases/reconcileMergeConflicts.ts
git commit -m "feat(code-agent): replace push entry point with cron reconcile() in merge conflict detector"
```

---

## Task 4: Migrate Tests (must happen before Tasks 5-6 to avoid broken CI)

**Files:**
- Rename: `src/__tests__/domain/useCases/detectMergeConflictsOnPush.test.ts` → `src/__tests__/domain/useCases/reconcileMergeConflicts.test.ts`

- [ ] **Step 1: Rename test file**

```bash
cd apps/code-agent
git mv src/__tests__/domain/useCases/detectMergeConflictsOnPush.test.ts src/__tests__/domain/useCases/reconcileMergeConflicts.test.ts
```

- [ ] **Step 2: Update imports and describe blocks**

Update all imports from `detectMergeConflictsOnPush` → `reconcileMergeConflicts`, `MergeConflictDetector` → `MergeConflictReconciler`, etc.

Update describe block names.

- [ ] **Step 3: Remove push-event-specific tests**

Delete test cases that test:
- Ref parsing (`refs/heads/main` → `main`)
- Non-branch push handling (tag pushes, etc.)
- Branch extraction from push event payload
- The `detectOnPush()` entry point specifically

- [ ] **Step 4: Add cron-specific tests**

Add test cases for the `reconcile()` method:
1. **Queries stale summaries** — verify `findStaleConflictSummaries()` is called
2. **Returns correct counts** — 2 conflicting + 1 clean + 1 unknown → `{ checked: 4, conflicting: 2, clean: 1, stillUnknown: 1, errors: 0 }`
3. **Per-PR error does not block others** — one PR throws, others still processed, error counted
4. **Empty result** — no stale summaries → `{ checked: 0, ... }`
5. **Still unknown updates lastConflictCheckedAt** — verify summary is updated without triggering workflow

- [ ] **Step 5: Keep all workflow tests unchanged**

The following test categories should remain and pass without modification:
- executeConflictWorkflow tests (task dispatch, comment phases)
- resolveConflictWorkflow tests (comment update, field clearing)
- Token resolution cascade tests
- Task reuse tests (reuseConflictTask)
- WhatsApp notification tests

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run apps/code-agent/src/__tests__/domain/useCases/reconcileMergeConflicts.test.ts`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/domain/useCases/
git commit -m "test(code-agent): migrate merge conflict tests from push-triggered to cron-triggered"
```

---

## Task 5: Remove Push Webhook Call Site + Service Container Entry

**Files:**
- Modify: `src/routes/webhooks/github.ts`
- Modify: `src/services.ts`

- [ ] **Step 1: Remove the detectOnPush call from the webhook**

In `src/routes/webhooks/github.ts`, remove the block at lines ~623-628:

```typescript
// DELETE THIS BLOCK:
const { unifiedEvaluator, mergeConflictDetector } = getServices();
if (parsedEvent.eventType === 'push' && mergeConflictDetector !== undefined) {
  void mergeConflictDetector.detectOnPush(savedEvent, logger).catch((detectErr: unknown) => {
    logger.error({ error: getErrorMessage(detectErr) }, 'Unhandled error in merge conflict detector');
  });
}
```

Keep the `unifiedEvaluator` destructuring if it's used elsewhere. Just remove the `mergeConflictDetector` part.

- [ ] **Step 2: Remove from ServiceContainer interface**

In `src/services.ts`, remove from the `ServiceContainer` interface:

```typescript
// DELETE:
mergeConflictDetector?: MergeConflictDetector;
```

- [ ] **Step 3: Remove creation from initServices**

Remove the `createDetectMergeConflictsOnPush(...)` call (lines ~387-403) and the `mergeConflictDetector,` assignment in the container object (line ~513).

Also remove the import:

```typescript
// DELETE:
import { createDetectMergeConflictsOnPush } from './domain/usecases/reconcileMergeConflicts.js';
```

And the interface import:

```typescript
// DELETE:
import type { MergeConflictDetector } from './domain/services/mergeConflictReconciler.js';
```

- [ ] **Step 4: Update webhook route tests**

In `src/__tests__/routes/webhooks/github.test.ts`, remove any references to `mergeConflictDetector`. Search for it:

```bash
grep -n "mergeConflictDetector" apps/code-agent/src/__tests__/routes/webhooks/github.test.ts
```

Remove or update any test cases that assert `mergeConflictDetector.detectOnPush` was called.

- [ ] **Step 5: Build to verify**

Run: `pnpm build`

Expected: No errors. Any remaining references to `mergeConflictDetector` will cause type errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/webhooks/github.ts src/services.ts src/__tests__/routes/webhooks/
git commit -m "refactor(code-agent): remove merge conflict detection from push webhook and service container"
```

---

## Task 6: Add Cron Route

**Files:**
- Create: `src/routes/merge-conflicts/reconcileRoute.ts`
- Create: `src/routes/merge-conflicts/index.ts`
- Create: `src/__tests__/routes/merge-conflicts/reconcileRoute.test.ts`
- Modify: `src/routes/index.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/routes/merge-conflicts/reconcileRoute.test.ts`:

Test cases using `app.inject()`:
1. **Rejects without internal auth** — returns 401
2. **Returns reconciliation results** — mock the use case, verify response shape `{ checked, conflicting, clean, stillUnknown, errors }`
3. **Returns empty results when no stale summaries** — `{ checked: 0, ... }`
4. **Calls `logIncomingRequest`**

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-conflicts/reconcileRoute.test.ts`

- [ ] **Step 3: Implement the route**

Create `src/routes/merge-conflicts/reconcileRoute.ts`:

```typescript
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { createMergeConflictReconciler } from '../../domain/usecases/reconcileMergeConflicts.js';
import { ALLOWED_BOTS } from '../webhooks/github.js';

export const reconcileRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/merge-conflicts/reconcile',
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/merge-conflicts/reconcile',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for merge-conflict reconcile');
        return await reply.fail('UNAUTHORIZED', 'Internal authentication failed');
      }

      const services = getServices();
      const reconciler = createMergeConflictReconciler({
        logger: request.log,
        gitHubPRClient: services.gitHubPRClient,
        gitHubPRSummaryRepo: services.gitHubPRSummaryRepo,
        codeTaskRepo: services.codeTaskRepo,
        userServiceClient: services.userServiceClient,
        gitHubPREventRepo: services.gitHubPREventRepo,
        linearIssueService: services.linearIssueService,
        taskDispatcher: services.taskDispatcher,
        taskEnqueueService: services.taskEnqueueService,
        logLineRepo: services.logLineRepo,
        workerSettingsRepo: services.workerSettingsRepo,
        statusMirrorService: services.statusMirrorService,
        whatsappNotifier: services.whatsappNotifier,
        allowedBots: ALLOWED_BOTS,
        orchestratorSecret: services.orchestratorSecret,
      });

      const result = await reconciler.reconcile(request.log);

      return await reply.ok(result);
    }
  );

  done();
};
```

Note: The deps list is long (13 dependencies) because we're reusing the existing use case. This is intentional — all the workflow logic is preserved.

**Important**: Check whether `orchestratorSecret` is available on `services` or needs to come from config. Verify by reading `services.ts` during implementation.

- [ ] **Step 4: Create barrel export**

Create `src/routes/merge-conflicts/index.ts`:

```typescript
export { reconcileRoute } from './reconcileRoute.js';
```

- [ ] **Step 5: Register in routes/index.ts**

Add import:

```typescript
import { reconcileRoute } from './merge-conflicts/index.js';
```

Add registration in `registerRoutes`:

```typescript
await app.register(reconcileRoute);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run apps/code-agent/src/__tests__/routes/merge-conflicts/reconcileRoute.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/routes/merge-conflicts/
git add src/__tests__/routes/merge-conflicts/
git add src/routes/index.ts
git commit -m "feat(code-agent): add POST /internal/merge-conflicts/reconcile cron route"
```

---

## Task 7: Full CI Verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`

- [ ] **Step 2: Run full tracked CI**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-conflict-reconcile.txt`

Expected: All workspaces pass.

- [ ] **Step 3: If failures, analyze and fix**

Run: `grep -E "error|FAIL" /tmp/ci-output-conflict-reconcile.txt -C3`

Common things to check:
- Any remaining imports of `detectMergeConflictsOnPush` or `mergeConflictDetector`
- Coverage drops due to removed push-event tests (add cron-specific tests to compensate)
- Firestore composite index needed for `findStaleConflictSummaries` query

- [ ] **Step 4: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix(code-agent): fix CI issues from merge conflict reconciliation refactor"
```
