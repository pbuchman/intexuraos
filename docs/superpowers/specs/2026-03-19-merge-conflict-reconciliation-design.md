# Merge Conflict Reconciliation Cron — Design Spec

**Date:** 2026-03-19
**Service:** code-agent
**Linear:** INT-1023

## Overview

Extract merge conflict detection from the push webhook handler into a standalone 1-minute cron endpoint. The existing `detectMergeConflictsOnPush` use case is renamed to `reconcileMergeConflicts` and rewired: instead of being triggered by push events, it runs on a cron that queries PR summaries with stale or unknown mergeability status.

The internal workflow logic (conflict dispatch, comment management, task reuse) is preserved. The `processOpenSummary` function signature changes to no longer require a `GitHubPREvent` — it derives all needed context from the PR summary document instead. See "Function Signature Changes" section.

## Problem

`detectMergeConflictsOnPush` races against GitHub's async mergeability computation. The 1-second retry budget (2 retries × 500ms) is insufficient during rapid-fire merges. When mergeability resolves to `unknown`, no follow-up is scheduled — the conflict is silently missed.

## Solution

Replace push-triggered detection with a 1-minute cron that queries stale PR summaries and re-checks their mergeability. GitHub has had time to compute between ticks — no retry/race needed.

## Endpoint Changes

### Created

#### `POST /internal/merge-conflicts/reconcile`

Cron endpoint. Internal auth (HMAC-SHA256). Processes one reconciliation cycle for all stale PR summaries.

No request body.

**Response:**

```json
{
  "checked": 3,
  "conflicting": 1,
  "clean": 1,
  "stillUnknown": 1,
  "errors": 0
}
```

### Modified

None.

### Removed

None (the push webhook endpoint itself is unchanged — only the internal conflict detection call is removed from its handler).

### Unchanged

All existing endpoints.

## Query Scope

Each tick queries PR summaries matching ALL of:
- `state` is `'open'` (skip closed/merged PRs), AND
- ANY of:
  - `mergeConflictStatus` is `'unknown'` OR `null`, OR
  - `lastConflictCheckedAt` is older than 5 minutes (catches stale `'conflicting'` or `'clean'` that may have changed)

This keeps GitHub API calls proportional to actual uncertainty, not total open PRs. Closed/merged PRs are excluded to avoid wasteful API calls.

## Tick Logic

```
ReconcileMergeConflicts:
  1. Query stale PR summaries from Firestore (see Query Scope above)
  2. For each summary:
     a. Resolve GitHub access context (same cascade: managed owner → PR author → event history)
     b. Load PR details from GitHub (mergeable, mergeableState) — no retry loop needed,
        GitHub has had time to compute
     c. Classify status: conflicting / clean / unknown
     d. If conflicting → executeConflictWorkflow
        (dispatch code task, manage tracking comment, WhatsApp notification)
     e. If clean + was conflicting → resolveConflictWorkflow
        (update comment to 'resolved', clear tracking fields)
     f. If still unknown → update lastConflictCheckedAt only
        (will be re-checked when it becomes stale again after 5 minutes)
     g. Update PR summary document
  3. Return summary counts: { checked, conflicting, clean, stillUnknown, errors }
```

## Changes to Existing Code

### Rename

| Before                                             | After                                           |
| -------------------------------------------------- | ----------------------------------------------- |
| `domain/usecases/detectMergeConflictsOnPush.ts`    | `domain/usecases/reconcileMergeConflicts.ts`    |
| `domain/services/mergeConflictDetector.ts`         | `domain/services/mergeConflictReconciler.ts`    |
| `processOpenSummaryOnPush()`                       | `processOpenSummary()`                          |
| `detectOnPush()` entry point                       | `reconcile()` entry point                       |
| `MergeConflictDetector` interface                  | `MergeConflictReconciler` interface             |
| `createDetectMergeConflictsOnPush()`               | `createMergeConflictReconciler()`               |
| `__tests__/.../detectMergeConflictsOnPush.test.ts` | `__tests__/.../reconcileMergeConflicts.test.ts` |

### Remove

- `detectOnPush()` method — the push-event entry point that parses `refs/heads/{branch}` and queries by base branch
- The `void mergeConflictDetector.detectOnPush(...)` call in `routes/webhooks/github.ts` (lines 624-628)
- `mergeConflictDetector` from `ServiceContainer` interface and `initServices`
- Push-event-specific test cases (ref parsing, branch extraction, non-branch push handling)

### Add

- `reconcile()` method — new entry point that queries stale summaries from Firestore and calls `processOpenSummary` for each
- `POST /internal/merge-conflicts/reconcile` route with internal auth
- Cloud Scheduler job: `merge-conflict-reconcile`, `* * * * *`
- New Firestore query: `findStaleConflictSummaries()` on `gitHubPRSummaryRepo`

### Unchanged (preserved as-is)

- `executeConflictWorkflow()` / `resolveConflictWorkflow()`
- Token resolution cascade (`resolveGitHubAccessContext`)
- Comment management (phases: starting, queued, resumed, no-worker, failed, resolved)
- Task dispatch/reuse logic (`createConflictTaskWorkflow`, `reuseConflictTask`)
- WhatsApp notifications
- PR summary model and all conflict-related fields

### Updated (not just renamed)

- `processOpenSummary()` — signature changes, see "Function Signature Changes" below
- Deps interface — `sleep`, `mergeabilityRetries`, `retryDelayMs` fields removed (retry loop eliminated)
- Webhook route test file (`__tests__/routes/webhooks/github.test.ts`) — remove any references to `mergeConflictDetector`

## Function Signature Changes

### `processOpenSummary` (formerly `processOpenSummaryOnPush`)

The existing function takes a `GitHubPREvent` parameter. In the cron context, there is no webhook event. Changes:

1. **Remove `event: GitHubPREvent` parameter** — replace with just the `GitHubPRSummary` (already a parameter)
2. **`repository`** — derive from `summary.repository` instead of `event.repository`
3. **`eventId` for tracing** — generate a synthetic trace ID: `reconcile_${crypto.randomUUID()}`. Used in `actionId` and `traceId` for task creation.
4. **`lastActivityAt`** — do NOT update this field during cron reconciliation. No new activity occurred; preserve the existing value from the summary. Only `lastConflictCheckedAt` should be updated.

### `buildSummaryUpdateInput`

- Remove `event.createdAt` usage for `lastActivityAt`
- When called from `reconcile()`, `lastActivityAt` is `undefined` (not updated)
- When called from a push event context (removed), it would have been `event.createdAt`

### Deps interface

Remove fields that only served the retry loop:

```typescript
// REMOVE from deps:
sleep?: (ms: number) => Promise<void>;
mergeabilityRetries?: number;
retryDelayMs?: number;
```

Pass `mergeabilityRetries: 0` to `loadPullRequestDetails` rather than modifying that function, preserving its retry capability for any future caller.

## New Repository Method

Add to `GitHubPRSummaryRepository`:

```typescript
findStaleConflictSummaries(): Promise<Result<GitHubPRSummary[], GitHubPRSummaryRepositoryError>>;
```

Returns PR summaries where:
- `mergeConflictStatus` is `'unknown'` OR `null`, OR
- `lastConflictCheckedAt` is older than 5 minutes ago

Implemented as two separate Firestore queries merged in application code (Firestore does not support OR across different field predicates in a single query):

1. `where('state', '==', 'open').where('mergeConflictStatus', 'in', ['unknown', null])`
2. `where('state', '==', 'open').where('lastConflictCheckedAt', '<', fiveMinutesAgo)`

Each sub-query needs its own composite index:
- Index 1: `state` ASC + `mergeConflictStatus` ASC
- Index 2: `state` ASC + `lastConflictCheckedAt` ASC

Add these as migrations in `apps/code-agent/migrations/`.

Deduplicate results by document ID before returning.

Note: Firestore `in` queries with `null` may not match documents where the field is missing entirely. Test this. If needed, split into two equality queries: one for `'unknown'` and one explicit check for missing field.

## Retry Budget Change

The existing `loadPullRequestDetails` has a retry loop (2 retries × 500ms) for `mergeable: null`. In the cron context, this retry is unnecessary — if mergeability is still `null`, we just mark it as `stillUnknown` and recheck next cycle. The retry loop can be removed or reduced to zero retries (single check).

## Cron Setup

Cloud Scheduler job: `merge-conflict-reconcile`
- Schedule: `* * * * *` (every 1 minute)
- Target: `POST /internal/merge-conflicts/reconcile`
- Auth: HMAC-SHA256 internal auth header (same as existing cron endpoints)

## Infrastructure

Cloud Scheduler job requires Terraform configuration:
- Add to `terraform/environments/dev/main.tf` (same pattern as existing cron jobs like `drain-queue`)
- Add to `ecosystem.config.cjs` for dev environment cron simulation (if applicable — check existing cron patterns)

## Environment Variables

No new env vars. Uses existing `INTEXURAOS_INTERNAL_AUTH_TOKEN` for HMAC validation.

## Error Handling

- **Per-PR errors** (token resolution failure, GitHub API error): logged, skipped, included in response `errors` count. Does not block other PRs in the same tick.
- **Firestore query failure**: return 500, cron retries next tick.
- **Still `unknown` after check**: update `lastConflictCheckedAt` so it ages out of the stale window. Will be rechecked after 5 minutes, not every tick. Prevents hammering GitHub for PRs that stay `null` for extended periods.
- **Concurrent ticks**: If a tick takes longer than 1 minute, the next tick may overlap. The workflows are idempotent — reusable task check prevents duplicate task creation, comment updates are last-writer-wins.

## Testing

- **Migrate** existing `detectMergeConflictsOnPush.test.ts` → `reconcileMergeConflicts.test.ts`
- **Remove** push-event-specific tests: ref parsing, branch extraction, non-branch push, event-triggered entry point
- **Add** cron entry point tests:
  - Queries only stale summaries (not all open PRs)
  - `still unknown` updates `lastConflictCheckedAt` without triggering workflow
  - Returns correct summary counts
  - Skips PRs with no resolvable token (no error propagation)
- **Keep** all workflow tests: conflict dispatch, resolve, comment phases, task reuse, WhatsApp
- **Route test**: `app.inject()` for the internal auth endpoint
