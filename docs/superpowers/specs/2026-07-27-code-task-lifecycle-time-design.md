# Code Task Lifecycle Time Design

**Status:** Approved for implementation and production rollout

## Problem

Code Tasks currently use `updatedAt` for two unrelated concepts:

- technical document mutation, including heartbeats, callback metadata, PR merge/close metadata, and repair writes;
- the user-visible time at which a task changed lifecycle status.

That coupling makes a terminal failure appear to have happened later than it did. The concrete regression is a task that failed dispatch at `T1`, then received PR metadata at `T2`: Firestore correctly advanced `updatedAt` at `T2`, but Code Tasks displayed and sorted the failure as if it occurred at `T2`. The same value also feeds group pagination, representative-task selection, timeline timestamps, terminal duration, React memoization, and stale-group retention.

The six failed groups investigated on 2026-07-27 share one valid domain cause: the requested Codex worker type had no active Codex authorization on `home-dev`. The tasks never started. That worker capability state is intentional and must remain unchanged. The defect is the lifecycle record and its presentation, not the absence of authentication.

## Product Contract

Code Tasks must answer three separate questions with separate values:

1. **Which attempt is newest?** Use task creation order (`createdAt`, with task ID as a deterministic tie-breaker).
2. **When did user-visible lifecycle activity last happen?** Use a canonical status-transition time (`statusChangedAt`).
3. **Did any technical data change?** Continue using `updatedAt` only for synchronization, cache invalidation, heartbeat/zombie detection, and audit/debugging.

No user-facing label, lifecycle sort, terminal duration, or retention decision may infer lifecycle time from a later technical metadata write when a better lifecycle timestamp exists.

## Data Model And Invariants

### CodeTask

Add `statusChangedAt` to persisted Code Tasks.

- New tasks initialize `statusChangedAt` to the same timestamp as `createdAt` and `updatedAt`.
- A repository update changes `statusChangedAt` only when the persisted `status` changes.
- A metadata-only update, heartbeat, callback-state update, result enrichment, PR merge, or PR close may change `updatedAt` but must preserve `statusChangedAt`.
- Entering `planned`, `implemented`, `reviewed`, `failed`, `interrupted`, `cancelled`, or `archived` ensures `completedAt` exists. Archiving must preserve an earlier `completedAt` rather than replacing the actual execution end.
- A real transition back to `queued`, `dispatched`, or `running` clears a stale `completedAt`; same-status writes never do.
- The transition timestamp uses an explicit lifecycle timestamp when supplied by the transition (`completedAt`, `dispatchedAt`, or `queuedAt` as appropriate); otherwise it uses the repository write time. The repository uses one captured clock value per update so `updatedAt`, inferred `statusChangedAt`, and inferred `completedAt` cannot drift within a write.
- During the compatibility window the persistence type permits an absent `statusChangedAt`, but every hydrated/API task exposes a resolved canonical value. After production backfill, all retained task documents must contain it.

The Firestore repository is the invariant boundary because it reads the existing document before every update. Individual failure paths do not need to remember to stamp terminal times correctly.

### Legacy Resolver

The backend resolves a task's lifecycle timestamp in this order:

1. persisted `statusChangedAt`;
2. `completedAt` for a terminal task;
3. terminal `dispatchStatus.terminalCause.lastSeenAt`;
4. terminal `dispatchStatus.lastSeenAt`;
5. `dispatchedAt` for `dispatched` or `running`;
6. `queuedAt` for `queued`;
7. legacy `updatedAt` as the best remaining approximation for an old transition;
8. `createdAt` only as a defensive fallback for a malformed legacy document with no mutation time.

This order recovers the exact dispatch-failure time for the existing failed tasks instead of assigning the later PR merge write. The resolver returns both the timestamp and the source so migration dry-runs can report fallback quality.

### Task Group Summary

Add explicit summary identity fields:

- `latestTaskId` and `latestTaskCreatedAt` identify the newest attempt;
- the existing indexed Firestore field `latestTaskUpdatedAt` becomes a documented compatibility key whose value is the maximum resolved `statusChangedAt` across displayable tasks, preserving the archive transition when every task is archived;
- existing `updatedAt` remains the summary document's technical mutation time;
- purpose-specific evidence timestamps, such as merge-ready evidence, remain purpose-specific and are not silently redefined.

Summary computation and incremental updates must preserve these distinctions. A later PR merge write cannot change the lifecycle sort key or change which task is the newest attempt. The legacy field name is intentionally retained only because current production indexes and cursors already depend on it; its TypeScript documentation must state that it stores lifecycle activity, not a task's technical `updatedAt`. A future physical rename, if desired, must use a separate two-phase index rollout.

## Grouping And Sorting

The issue-group response exposes:

- `latestTask`: newest attempt by `createdAt`;
- `lastActivityAt`: maximum canonical lifecycle time in the group;
- `lastActivityStatus` and `lastActivityTaskId`: the transition represented by that time;
- `lastModifiedAt`: maximum technical `updatedAt`, used only for frontend reconciliation/memoization;
- existing `mostRecentDispatchedAt`: unchanged and still used by the explicit dispatched sort.

Pipeline representatives and aggregate failure semantics select the newest attempt per agent type by creation order, not by incidental metadata writes. `last-updated` remains an API-compatible sort key, but its UI label becomes **Activity** and its behavior orders by `lastActivityAt` and the lifecycle-valued summary compatibility key.

Merge-ready evidence keeps its own causal timestamp rules. The implementation must audit those comparisons rather than globally replacing every `updatedAt` occurrence.

## Endpoint Changes

### Modified

- `GET /code/tasks`
- `GET /code/tasks/:taskId`
- task-returning create/retry/active-task responses that use the shared Code Task schema
- `GET /code/issue-groups`

Every serialized task adds canonical `statusChangedAt`; task detail/list responses also expose `completedAt`. Issue groups add `lastActivityAt`, `lastActivityStatus`, `lastActivityTaskId`, and `lastModifiedAt`.

The existing sort query value `last-updated` remains accepted for backward compatibility and now means lifecycle activity.

### Created

None.

### Removed

None.

### Unchanged

- Dispatch Queue endpoints and fields;
- worker settings and authorization endpoints;
- scheduler endpoint contracts;
- callback and webhook endpoint contracts.

## Code Tasks UX

Use one presentation component/contract for lifecycle timestamps in desktop rows, mobile rows, expanded timelines, and task headers.

- Show the lifecycle verb and absolute local time followed by relative time, for example `Failed Jul 27, 2026, 2:28 PM · 7m ago`.
- Render semantic `<time dateTime="...">` markup.
- Put the exact date/time and browser timezone in the accessible label and hover title.
- Use status-specific verbs: `Queued`, `Dispatched`, `Running`, `Planned`, `Implemented`, `Reviewed`, `Failed`, `Interrupted`, `Cancelled`, and `Archived`.
- A terminal dispatch failure shows its task-level reason/remediation and explicitly indicates `Never started` when neither `dispatchedAt` nor a running transition exists.
- Timeline duration ends at `completedAt`; for archived tasks it keeps the original completion time. Active tasks continue to use the current clock.
- The visible sort label changes from `Updated` to `Activity`; the wire value remains compatible.

The approved Dispatch Queue variant 1 remains unchanged: only blockers affecting tasks still queued for automatic retry appear there. Terminal failures remain task history in Code Tasks.

## Retention

Failed task history remains visible and is not invalidated merely because the queue is empty. Existing seven-day archive policies remain in force.

`archiveStaleGroups` evaluates the newest lifecycle activity in a group, not technical `updatedAt`. Open PR and active-task guards remain unchanged. Archiving creates a new `statusChangedAt` for the archive transition but preserves the execution `completedAt`.

The production schedulers for stale-group and merged-task archival must remain enabled and be verified after deployment.

## Logging And Sentry

Every real status transition emits one structured log containing:

- `taskId`, `userId`, `workerType`, and `workerLocation`;
- `fromStatus`, `toStatus`, and `statusChangedAt`;
- transition source and, when available, dispatch reason or error code.

Metadata-only updates do not emit lifecycle-transition logs. Known worker capability blockers, including intentionally unavailable Codex authorization, remain structured domain warnings with `_skipSentry: true`. Unexpected persistence, contract, network, migration, and internal failures continue to reach Sentry.

Production verification compares Sentry event volume before and after deployment and confirms that expected auth blockers do not create new Sentry events while an unexpected-error probe remains capturable through the existing Sentry plumbing.

## Migration And Rollout

The rollout is additive and idempotent:

1. Keep the existing indexed `latestTaskUpdatedAt` query shape so no document can disappear while an index or new field is missing.
2. Deploy additive lifecycle readers/writers, API fields, summary semantics, and UI through the normal application pipeline.
3. Run a read-only backfill dry-run using explicit service-account credentials. Report counts by resolver source, terminal tasks missing `completedAt`, summaries to update, and the six known failed task IDs.
4. Apply the task backfill in bounded batches. Set only missing `statusChangedAt`/`completedAt`; never rewrite an existing canonical value.
5. Recompute all affected `task_group_summaries` with `latestTaskId`, `latestTaskCreatedAt`, and lifecycle-valued `latestTaskUpdatedAt`, preserving user flags and label state.
6. Confirm no older local/Home Dev code-agent process can keep writing the legacy shape, then verify document counts and exact timestamps and re-query the production API/UI.
7. Keep legacy fallback reads for one release so rollback remains safe. The prior application ignores additive task/summary fields and continues using the same indexes.

The backfill command defaults to dry-run, requires an explicit apply flag for writes, validates the target project, uses bounded batches, and produces deterministic structured totals. The shared retained GCP project is production data despite its legacy `-dev-pbuchman` suffix.

## Test Strategy

All behavior changes follow strict red-green-refactor.

The primary regression fixture is:

- task fails at `T1` with terminal dispatch status;
- later PR metadata updates `updatedAt` at `T2` where `T2 > T1`;
- status, group activity, sort order, timeline timestamp, and duration still use `T1`;
- frontend reconciliation may use `T2` only as `lastModifiedAt` to refresh PR metadata.

Additional coverage proves:

- create and every status transition maintain repository invariants;
- repeated same-status and metadata-only writes preserve `statusChangedAt` and `completedAt`;
- all terminal statuses, including `reviewed` and `archived`, stop duration correctly;
- every legacy fallback branch is deterministic;
- group representative selection, aggregate status, pagination, and sort are independent of metadata writes;
- stale archival uses lifecycle activity;
- public task and issue-group schemas serialize the new fields;
- desktop, mobile, timeline, and task header render exact, relative, semantic, and accessible time;
- Dispatch Queue variant 1 and expected-blocker Sentry suppression remain unchanged;
- migration dry-run/apply is idempotent and never overwrites canonical timestamps.

## Production Acceptance

The work is complete only when:

1. full repository CI passes on the final rebased branch;
2. independent code review has no unresolved load-bearing findings;
3. the PR is merged into `development` and the production deployment is healthy;
4. the lifecycle migration and summary backfill complete with verified counts;
5. each of the six investigated failed Code Tasks shows its real dispatch-failure time and `Never started`, unaffected by its later PR merge timestamp;
6. `home-dev` still intentionally reports Codex auth as not configured and no auth setting was changed;
7. both archive schedulers remain enabled and successful;
8. no new expected-auth blocker noise appears in Sentry, and no new regression group appears after deployment.

## Non-Goals

- Installing, refreshing, or enabling Codex/Claude authentication on `home-dev`.
- Changing default worker types or routing policy.
- Showing terminal failures as active Dispatch Queue blockers.
- Replacing `updatedAt` for heartbeat, zombie detection, cache invalidation, or technical audit.
- Deleting failed task history immediately.
- Suppressing unexpected operational or programming failures from Sentry.
