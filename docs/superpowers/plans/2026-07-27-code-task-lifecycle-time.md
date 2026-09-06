# Code Task Lifecycle Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Code Tasks lifecycle timestamp, ordering, duration, retention decision, and failure explanation reflect the real status transition rather than a later technical Firestore write, then backfill and verify production without changing the intentional `home-dev` Codex authorization state.

**Architecture:** Add a canonical lifecycle-time resolver and enforce transition timestamps in the code-task Firestore repository. Keep `updatedAt` as the technical mutation clock. Preserve the existing indexed `task_group_summaries.latestTaskUpdatedAt` storage key for rollout safety, but redefine its value as group lifecycle activity and explicitly track newest-attempt identity by creation time. Serialize the canonical contract through existing APIs and render one accessible lifecycle-time presentation across Code Tasks. Use an idempotent dry-run-first production backfill and the existing automatic application deployment pipeline.

**Tech Stack:** TypeScript, Fastify, Firestore, React 19, Vite, Vitest, Testing Library, Pino, GitHub Actions, Hetzner PM2/nginx, GCP Cloud Scheduler, Sentry.

**Spec:** `docs/superpowers/specs/2026-07-27-code-task-lifecycle-time-design.md`

## Global Constraints

- `updatedAt` remains the technical mutation/heartbeat/cache-invalidation clock and is never displayed or used as lifecycle time when a canonical/fallback lifecycle timestamp exists.
- New tasks set `statusChangedAt = createdAt`; same-status and metadata-only writes preserve it; real status transitions update it once.
- `planned`, `implemented`, `reviewed`, `failed`, `interrupted`, and `cancelled` require `completedAt`. `archived` preserves an earlier completion time and only fills it when missing. A transition back to `queued`, `dispatched`, or `running` clears stale completion state.
- Legacy resolution order is: `statusChangedAt`, terminal `completedAt`, terminal dispatch cause `lastSeenAt`, terminal dispatch `lastSeenAt`, status-specific `dispatchedAt`/`queuedAt`, legacy `updatedAt`, defensive `createdAt` fallback.
- Newest task/agent attempt is selected by `createdAt` plus deterministic task-ID tie-breaker. Group activity is selected by canonical lifecycle time. Technical refresh is selected by `updatedAt`. Do not collapse those three concepts.
- Keep Firestore query/index field `task_group_summaries.latestTaskUpdatedAt`; it stores lifecycle activity after this change. No new composite index, endpoint, environment variable, worker setting, or authorization setting is introduced.
- Merge-ready/result evidence keeps its purpose-specific `updatedAt` chronology unless a focused test proves a different causal timestamp is required.
- Keep approved Dispatch Queue variant 1 unchanged: only current queued blockers appear there; terminal failures remain Code Tasks history.
- Do not configure Codex auth on `home-dev`, change worker defaults, or suppress unexpected errors from Sentry.
- Known capability blockers remain structured warnings with `_skipSentry: true`; every actual status transition produces one structured lifecycle log.
- UI shows status verb + exact local time + relative time using semantic `<time>`, exact hover title, and timezone-aware accessible label.
- The primary regression must remain explicit: failure at `T1`, PR metadata write at `T2`, with all lifecycle presentation/sorting/duration still at `T1` and technical refresh at `T2`.
- All behavior changes use strict RED → observed expected failure → minimal GREEN → refactor. Tests must exercise real production behavior and name the break they catch.
- Preserve current seven-day retention and existing scheduler contracts.

## Endpoint Changes

### Modified

- `GET /code/tasks`
- `GET /code/tasks/:taskId`
- existing task-returning routes that reuse `codeTaskSchema`
- `GET /code/issue-groups`

Task payloads add canonical `statusChangedAt`; public task detail/list payloads also add task-level `completedAt`. Issue groups add `lastActivityAt`, `lastActivityStatus`, `lastActivityTaskId`, and `lastModifiedAt`. Existing query value `sortBy=last-updated` remains supported and now means lifecycle activity.

### Created

- None.

### Removed

- None.

### Unchanged

- Dispatch Queue, worker settings/auth, callback/webhook, and scheduler endpoints.

---

## Task 1: Enforce the canonical lifecycle clock in persistence

**Files:**

- Create: `apps/code-agent/src/domain/models/taskLifecycleTime.ts`
- Modify: `apps/code-agent/src/domain/models/codeTask.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`
- Modify: `apps/code-agent/src/infra/firestore/firestoreCodeTaskRepository.ts`
- Test: `apps/code-agent/src/__tests__/domain/models/taskLifecycleTime.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/task-serializer.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`

### 1.1 RED: define resolver and transition invariant tests

- [ ] Add table-driven resolver tests with hand-authored timestamps for every priority branch and source name:
  - `status_changed`
  - `completed`
  - `dispatch_terminal_cause`
  - `dispatch_terminal`
  - `dispatched`
  - `queued`
  - `created`
  - `legacy_updated`
- [ ] Add serializer/repository tests proving:
  - create stores identical `createdAt`, `updatedAt`, and `statusChangedAt` and schema version 2;
  - `running → failed` with explicit `completedAt=T1` stores both lifecycle fields at `T1` even when repository write time is later;
  - terminal transition without `completedAt` uses one captured write timestamp for `statusChangedAt`, `completedAt`, and default `updatedAt`;
  - `failed → failed` metadata/PR write advances only `updatedAt`;
  - `failed → archived` advances `statusChangedAt` but preserves original `completedAt`;
  - `failed → running` advances `statusChangedAt` and deletes stale `completedAt`;
  - all completion terminal statuses get `completedAt`, including `reviewed`;
  - `claimForDispatch()` writes one timestamp to `statusChangedAt`, `dispatchedAt`, and `updatedAt`, and clears stale completion state;
  - one structured transition log is emitted for a transition and none for metadata-only writes.
- [ ] Run:

```bash
pnpm --filter @intexuraos/code-agent exec vitest run \
  src/__tests__/domain/models/taskLifecycleTime.test.ts \
  src/__tests__/infra/firestore/task-serializer.test.ts \
  src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts
```

Expected: FAIL because the field, resolver, repository context, direct-claim timestamps, and transition log do not exist.

### 1.2 GREEN: add lifecycle semantics and repository enforcement

- [ ] Add `statusChangedAt?: Timestamp` to the persisted `CodeTask` compatibility shape.
- [ ] Export centralized active/completion/archival status predicates instead of adding another inconsistent terminal-status set.
- [ ] Implement:

```ts
export type TaskLifecycleTimeSource =
  | 'status_changed'
  | 'completed'
  | 'dispatch_terminal_cause'
  | 'dispatch_terminal'
  | 'dispatched'
  | 'queued'
  | 'legacy_updated'
  | 'created';

export interface ResolvedTaskLifecycleTime {
  at: Timestamp;
  source: TaskLifecycleTimeSource;
}

export function resolveTaskLifecycleTime(task: CodeTaskLifecycleShape): ResolvedTaskLifecycleTime;
```

- [ ] Make `fromFirestoreDoc()` hydrate `statusChangedAt` from the resolver so application code always receives a canonical timestamp while legacy storage remains readable.
- [ ] Change `buildUpdateData()` to accept the existing task plus one injected/captured `now`; compare old/new status and enforce transition/completion rules centrally.
- [ ] On task writes, stamp schema version 2 and `schemaUpdatedAt` without changing unrelated collection schemas.
- [ ] In repository `update()`, pass the already-read task and one captured clock value to the serializer.
- [ ] In `claimForDispatch()`, use one `Timestamp`/`Date` value for every lifecycle field and clear stale `completedAt` in the same transaction.
- [ ] Log `taskId`, `userId`, worker identity, `fromStatus`, `toStatus`, ISO `statusChangedAt`, resolver source, dispatch reason, and error code only for real transitions.
- [ ] Re-run the focused tests until GREEN, then run:

```bash
pnpm --filter @intexuraos/code-agent typecheck
```

- [ ] Refactor only after GREEN; mentally mutate same-status comparison, terminal detection, archive preservation, and direct dispatch timestamps and confirm a named test would fail.
- [ ] Commit with a focused message such as `fix(code-agent): enforce task lifecycle timestamps`.

---

## Task 2: Publish the lifecycle contract through existing APIs

**Files:**

- Modify: `apps/code-agent/src/routes/code/responseFormatters.ts`
- Modify: `apps/code-agent/src/routes/code/schemas.ts`
- Modify: `apps/code-agent/src/routes/code/task-routes.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts`
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts`
- Test: `apps/code-agent/src/__tests__/routes/codeRoutes.branches.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/code/schemas.test.ts`
- Test: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`
- Test: `apps/code-agent/src/__tests__/integration/status-update-e2e.test.ts`

### 2.1 RED: lock the response and schema behavior

- [ ] Add route/formatter tests proving all shared task responses contain required canonical `statusChangedAt` and terminal responses contain `completedAt`.
- [ ] Add a legacy-document test proving API serialization uses the exact terminal dispatch `lastSeenAt`, not later `updatedAt`.
- [ ] Add issue-group serialization tests for `statusChangedAt`, `completedAt`, and full `dispatchStatus` terminal details.
- [ ] Add the `T1/T2` integration fixture: persist failure at `T1`, update PR metadata/`updatedAt` at `T2`, then assert task APIs still report lifecycle `T1` and technical `updatedAt=T2`.
- [ ] Run:

```bash
pnpm --filter @intexuraos/code-agent exec vitest run \
  src/__tests__/routes/codeRoutes.branches.test.ts \
  src/__tests__/routes/code/schemas.test.ts \
  src/__tests__/routes/code/issueGroups.test.ts \
  src/__tests__/integration/status-update-e2e.test.ts
```

Expected: FAIL because public task formatters/schemas omit task-level lifecycle/completion data and issue groups omit lifecycle time/dispatch details.

### 2.2 GREEN: serialize one canonical API shape

- [ ] Add `statusChangedAt` and `completedAt` to the `taskToApiResponse()` input/output and response body.
- [ ] Mark `statusChangedAt` required in the shared Code Task JSON schema; keep `completedAt` optional/nullable for active tasks.
- [ ] Update the separate inline task-detail schema in `task-routes.ts`.
- [ ] Add canonical `statusChangedAt` and full serialized `dispatchStatus` to `SerializedTask` and `taskToSerializedTask()`.
- [ ] Reuse the backend lifecycle resolver; do not duplicate fallback precedence in route files.
- [ ] Re-run focused tests and `pnpm --filter @intexuraos/code-agent typecheck` until GREEN.
- [ ] Commit with a focused message such as `feat(code-agent): expose lifecycle timestamps`.

---

## Task 3: Decouple newest attempt, lifecycle activity, and technical modification in groups

**Files:**

- Modify: `apps/code-agent/src/domain/issueGrouping/types.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/groupByLinearIssue.ts`
- Modify: `apps/code-agent/src/domain/issueGrouping/sortIssueGroups.ts`
- Modify: `apps/code-agent/src/domain/models/taskGroupSummary.ts`
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummary/serializer.ts`
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummary/queries.ts` (documentation/semantic naming only; query field remains unchanged)
- Modify: `apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/codeTaskRepositoryWithGroupUpdates.ts` if archive/recompute correctness requires it
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts`
- Test: `apps/code-agent/src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts`
- Test: `apps/code-agent/src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts`

### 3.1 RED: prove metadata cannot reorder or reclassify a group

- [ ] Add exact group fixtures with:
  - task A created first, task B created later;
  - task A receiving a later PR metadata `updatedAt`;
  - task B remaining `latestTask` by creation time;
  - group `lastActivityAt` remaining the maximum lifecycle transition;
  - group `lastModifiedAt` advancing to the PR metadata write;
  - `lastActivityStatus`/`lastActivityTaskId` identifying the lifecycle event.
- [ ] Add sort tests proving `last-updated` and fallback ordering use lifecycle activity, while `dispatched` remains based on `mostRecentDispatchedAt`.
- [ ] Add summary tests proving:
  - `latestTaskId`/`latestTaskCreatedAt` select newest attempt;
  - persisted `latestTaskUpdatedAt` receives lifecycle activity, not task technical `updatedAt`;
  - metadata-only summary maintenance may update PR/evidence fields but cannot advance lifecycle sort;
  - merge-ready/result evidence still uses its purpose-specific chronology;
  - archive/update of the latest attempt leaves a correct summary rather than a stale representative.
- [ ] Run:

```bash
pnpm --filter @intexuraos/code-agent exec vitest run \
  src/__tests__/domain/issueGrouping/groupByLinearIssue.test.ts \
  src/__tests__/domain/issueGrouping/sortIssueGroups.test.ts \
  src/__tests__/infra/firestore/taskGroupSummary/serializer.test.ts \
  src/__tests__/infra/firestore/taskGroupSummary/queries.test.ts \
  src/__tests__/infra/firestore/taskGroupSummaryFirestoreRepository.test.ts \
  src/__tests__/infra/repositories/codeTaskRepositoryWithGroupUpdates.test.ts
```

Expected: FAIL because every representative and sort key currently overloads `updatedAt`.

### 3.2 GREEN: implement the three-clock group contract

- [ ] Add to `IssueGroup`: `lastActivityAt`, `lastActivityStatus`, `lastActivityTaskId`, and `lastModifiedAt`.
- [ ] Select `latestTask` and one representative per agent type by `createdAt DESC, id DESC`; display tasks chronologically by `createdAt ASC, id ASC`.
- [ ] Compute lifecycle activity by canonical `statusChangedAt` and technical modification by `updatedAt`.
- [ ] Use group `lastActivityAt` in all lifecycle sort fallbacks; leave explicit dispatched sort unchanged.
- [ ] Add `latestTaskId` and `latestTaskCreatedAt` to `TaskGroupSummary`.
- [ ] Redefine/document `latestTaskUpdatedAt` as the retained indexed compatibility field containing latest lifecycle activity. Do not change query field names or create an index migration.
- [ ] Split full and incremental summary computation:
  - attempt identity/status by creation time;
  - lifecycle sort by canonical lifecycle time;
  - review/merge-ready evidence by its existing technical/result event time.
- [ ] Preserve `isImportant` and label state during recompute. For an archive/delete that invalidates the representative, recompute from remaining tasks rather than guessing from incomplete summary state.
- [ ] Re-run focused tests and `pnpm --filter @intexuraos/code-agent typecheck` until GREEN.
- [ ] Commit with a focused message such as `fix(code-agent): separate group lifecycle activity`.

---

## Task 4: Make retention and repair lifecycle-aware

**Files:**

- Modify: `apps/code-agent/src/domain/usecases/archiveStaleGroups.ts`
- Modify: `apps/code-agent/src/domain/usecases/repairArchivedOpenPrGroups.ts`
- Modify: `apps/code-agent/src/routes/internal/schemas.ts`
- Test: `apps/code-agent/src/__tests__/usecases/archiveStaleGroups.test.ts`
- Test: `apps/code-agent/src/__tests__/usecases/repairArchivedOpenPrGroups.test.ts`

### 4.1 RED: prove technical writes cannot extend retention

- [ ] Add a stale-group test where lifecycle activity is older than seven days but PR metadata `updatedAt` is recent; assert the group archives.
- [ ] Add a fresh-lifecycle test where `updatedAt` is old but `statusChangedAt` is within retention; assert the group stays.
- [ ] Add archive assertions proving repository transition semantics preserve prior `completedAt`.
- [ ] Add repair ordering/restore tests proving candidate selection is based on lifecycle/newest attempt and status restoration is a real transition, not an `updatedAt` override.
- [ ] Run:

```bash
pnpm --filter @intexuraos/code-agent exec vitest run \
  src/__tests__/usecases/archiveStaleGroups.test.ts \
  src/__tests__/usecases/repairArchivedOpenPrGroups.test.ts
```

Expected: FAIL because stale archival and repair currently use `updatedAt`.

### 4.2 GREEN: use canonical lifecycle time for retention/repair

- [ ] Replace in-memory staleness calculation with the shared lifecycle resolver; keep current active-task/open-PR guards and seven-day default.
- [ ] Rename structured log fields from `maxUpdatedAt`/`daysSinceUpdate` to lifecycle-accurate names.
- [ ] Correct the internal schema description to say lifecycle/status activity.
- [ ] Use creation/lifecycle semantics in archived-open-PR repair and remove any status-restore reliance on overriding `updatedAt`.
- [ ] Do not change `autoArchiveMergedTasks`; its policy correctly uses `prMergedAt`.
- [ ] Re-run focused tests and code-agent typecheck until GREEN.
- [ ] Commit with a focused message such as `fix(code-agent): base task retention on lifecycle activity`.

---

## Task 5: Build the idempotent lifecycle backfill and audit command

**Files:**

- Create: `apps/code-agent/src/scripts/lib/codeTaskLifecycleBackfill.ts`
- Create: `apps/code-agent/src/scripts/backfillCodeTaskLifecycleTime.ts`
- Modify: `apps/code-agent/src/scripts/backfillGroupSummaries.ts` to reuse production summary computation or the canonical resolver instead of duplicated `updatedAt` ranking
- Modify: `apps/code-agent/package.json`
- Test: `apps/code-agent/src/__tests__/scripts/codeTaskLifecycleBackfill.test.ts`

### 5.1 RED: define dry-run, apply, batching, and idempotency behavior

- [ ] Test with an in-memory Firestore fake or injected repository seam:
  - default mode performs zero writes and reports resolver-source counts;
  - `--apply` writes only missing `statusChangedAt` and missing terminal `completedAt`;
  - existing canonical values are never overwritten;
  - terminal dispatch cause time wins over later PR `updatedAt` for the known regression shape;
  - active tasks never receive `completedAt`;
  - bounded batches resume by document-ID cursor;
  - rerunning apply produces zero task changes;
  - summary recompute writes newest-attempt identity and lifecycle-valued `latestTaskUpdatedAt` while preserving `isImportant`/labels;
  - invalid/implicit project selection refuses apply.
- [ ] Run:

```bash
pnpm --filter @intexuraos/code-agent exec vitest run \
  src/__tests__/scripts/codeTaskLifecycleBackfill.test.ts
```

Expected: FAIL because no lifecycle backfill/audit command exists.

### 5.2 GREEN: implement safe operational tooling

- [ ] Implement pure planning/audit logic separately from the CLI.
- [ ] Make the CLI default to dry-run and require both `--apply` and explicit project `intexuraos-dev-pbuchman` for writes.
- [ ] Require explicit service-account credentials for production Firestore and reject emulator variables in apply mode.
- [ ] Page by document ID, use bounded batches below Firestore limits, await all writes, and emit deterministic totals for scanned/changed/skipped/source/error counts.
- [ ] Recompute affected summaries using the production summary function instead of a second ranking algorithm.
- [ ] Add an npm script with a clear name such as `backfill:lifecycle-time`.
- [ ] Re-run focused tests and code-agent typecheck until GREEN.
- [ ] Commit with a focused message such as `feat(code-agent): add lifecycle timestamp backfill`.

---

## Task 6: Present exact lifecycle time consistently in Code Tasks

**Files:**

- Create: `apps/web/src/components/code-tasks/TaskLifecycleTime.tsx`
- Create: `apps/web/src/utils/taskLifecycle.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/types/issueGroups.ts`
- Modify: `apps/web/src/components/code-tasks/IssueGroupRow.tsx`
- Modify: `apps/web/src/components/code-tasks/IssueTimeline.tsx`
- Modify: `apps/web/src/components/code-tasks/TaskHeader.tsx`
- Modify: `apps/web/src/hooks/useIssueGroups.ts`
- Modify: `apps/web/src/hooks/useCodeTaskLogs.ts`
- Modify: `apps/web/src/pages/CodeTasksPage.tsx`
- Modify: `apps/web/src/pages/CodeTaskViewPage.tsx` only where dispatch failure time/reason presentation needs the shared formatter and `Never started`
- Test: `apps/web/src/utils/__tests__/taskLifecycle.test.ts`
- Test: `apps/web/src/components/code-tasks/__tests__/TaskLifecycleTime.test.tsx`
- Test: `apps/web/src/components/code-tasks/__tests__/IssueGroupRow.test.ts`
- Test: `apps/web/src/components/__tests__/IssueTimeline.test.ts`
- Test: `apps/web/src/components/code-tasks/__tests__/TaskHeader.timeout.test.tsx`
- Test: `apps/web/src/hooks/__tests__/useIssueGroups.test.ts`
- Test: `apps/web/src/hooks/__tests__/useCodeTaskLogs.test.ts`
- Test: `apps/web/src/__tests__/CodeTaskViewPage.test.tsx`
- Regression test: `apps/web/src/__tests__/DispatchQueuePage.test.tsx`

### 6.1 RED: specify visible, semantic, and accessible behavior

- [ ] Add utility tests for every lifecycle status label and duration end rule, including `reviewed` and archived tasks preserving original completion.
- [ ] Add component tests using a fixed clock/timezone proving the rendered value includes status verb, exact local time, and relative time, and has correct `<time dateTime>`, title, and timezone-aware accessible label.
- [ ] Add row tests for both desktop and mobile content using group `lastActivity*`, not `latestTask.updatedAt`.
- [ ] Add timeline/header tests proving failure at `T1` remains `T1` after `updatedAt=T2`, and terminal duration ends at `completedAt=T1`.
- [ ] Add `Never started` and dispatch reason/remediation assertions for a terminal auth failure with no `dispatchedAt`.
- [ ] Change hook tests so lifecycle/group rendering updates use `lastActivityAt`, while metadata/PR refresh uses `lastModifiedAt`; task-detail refresh key includes `statusChangedAt` and `completedAt` without removing technical `updatedAt`.
- [ ] Keep the Dispatch Queue regression test unchanged and passing.
- [ ] Run:

```bash
pnpm --filter @intexuraos/web exec vitest run \
  src/utils/__tests__/taskLifecycle.test.ts \
  src/components/code-tasks/__tests__/TaskLifecycleTime.test.tsx \
  src/components/code-tasks/__tests__/IssueGroupRow.test.ts \
  src/components/__tests__/IssueTimeline.test.ts \
  src/components/code-tasks/__tests__/TaskHeader.timeout.test.tsx \
  src/hooks/__tests__/useIssueGroups.test.ts \
  src/hooks/__tests__/useCodeTaskLogs.test.ts \
  src/__tests__/CodeTaskViewPage.test.tsx \
  src/__tests__/DispatchQueuePage.test.tsx
```

Expected: FAIL because the UI still renders technical `updatedAt`, lacks the shared semantic time component, omits `reviewed` from terminal duration, and labels the sort as Updated.

### 6.2 GREEN: render one lifecycle-time contract

- [ ] Add required `statusChangedAt` and optional `completedAt` to web `CodeTask`; add new group activity/technical fields.
- [ ] Implement status-label and duration helpers with no API fallback duplication; API `statusChangedAt` is authoritative.
- [ ] Implement `TaskLifecycleTime` using existing date-format utilities, resolved browser timezone, semantic `<time>`, exact title, and accessible label.
- [ ] Replace visible `updatedAt` in desktop/mobile group rows, expanded timeline, and task header.
- [ ] Use `lastActivityAt/status` for visible group activity and `lastModifiedAt` for merge/memo reconciliation.
- [ ] Show terminal dispatch diagnostics and `Never started` at task level without reintroducing terminal blockers into Dispatch Queue.
- [ ] Rename the visible `last-updated` sort option to `Activity` while retaining the wire/storage key.
- [ ] Re-run focused tests, web typecheck, and web build until GREEN:

```bash
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web build
```

- [ ] Commit with a focused message such as `fix(web): show real code task lifecycle time`.

---

## Task 7: Cross-surface regression, verification, and operational documentation

**Files:**

- Modify as required by failures: only files already in Tasks 1–6
- Update: `docs/superpowers/specs/2026-07-27-code-task-lifecycle-time-design.md` only if implementation reveals a durable, approved clarification
- Update: `.claude/reference/*.md` only if a new durable project convention was discovered, and link it from `.claude/CLAUDE.md`

- [ ] Run focused code-agent and web suites from Tasks 1–6 together.
- [ ] Run workspace gates:

```bash
pnpm run verify:workspace:tracked -- code-agent
pnpm run verify:workspace:tracked -- web
```

- [ ] Run static Sentry policy verification and confirm expected dispatch blockers still carry `_skipSentry: true`:

```bash
pnpm run verify:sentry-logging
```

- [ ] Run the full repository commit gate with fresh evidence:

```bash
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-code-task-lifecycle-time.txt
```

- [ ] If any command fails, use systematic debugging, fix every failure, rerun the focused failing test, then rerun the entire required gate.
- [ ] Generate a whole-branch review package and run independent architecture/correctness review on the most capable available model. Fix Critical/Important findings once and run a scoped re-review.
- [ ] Confirm final diff contains no worker-auth/default changes, no Dispatch Queue semantic changes, no new index/env var, no secrets, and no placeholder text.

---

## Release, Migration, And Production Verification

These steps are executed by the controller after all implementation tasks and reviews are clean.

### PR and merge

- [ ] Re-read `.claude/CLAUDE.md` and all concrete referenced rules for the commit/publish scope guard.
- [ ] Fetch and merge latest `origin/development` into the feature branch, rerun `pnpm run ci:tracked`, then commit any final merge-resolution changes only after the gate passes.
- [ ] Push `codex/code-task-lifecycle-time` and open a ready PR targeting `development`, using the repository-approved no-fabricated-Linear-ID path and the commit-push note when no real issue ID is available.
- [ ] Wait for all required GitHub checks and review threads. Address every failing check/actionable finding and rerun verification.
- [ ] Squash-merge only when checks and review are clean.

### Application deployment

- [ ] Identify the automatic `deploy.yml` run for the exact merge SHA and watch it to success.
- [ ] Verify `https://intexuraos.cloud/deployment.json` and `https://intexuraos.cloud/api/code/health` report the exact merge SHA/healthy service.
- [ ] Verify Home Dev checkout/process health and confirm its code-agent revision is the intended deployed revision.
- [ ] Confirm `home-dev` Codex auth remains intentionally not configured; do not remediate it.

### Backfill and data verification

- [ ] Run the backfill in default dry-run mode with explicit service-account credentials and emulator variables cleared. Save the structured report.
- [ ] Inspect totals and the six known failed task IDs:
  - `task_488...` for INT-1934 / PR 2406;
  - `task_671...` for INT-1935 / PR 2407;
  - `task_95e...` for INT-1936 / PR 2408;
  - `task_e8d...` for INT-1937 / PR 2409;
  - `task_a5d...` for INT-1938 / Sentry issue 136679270;
  - `task_166001f8-3d65-4397-932d-9c930363e338` for INT-1939 / PR 2410.

  Resolve the abbreviated IDs from the prior verified Firestore evidence before apply; never use a prefix as a write target.
- [ ] Run apply mode against `intexuraos-dev-pbuchman`, then rerun dry-run and require zero pending changes and zero missing canonical fields.
- [ ] Verify all task-group summaries have newest-attempt identity and lifecycle-valued sort key, with user importance/labels preserved.
- [ ] Query the production API/UI and prove each failed task shows its actual dispatch failure time, terminal reason, and `Never started`, unaffected by later PR metadata.

### Scheduler and Sentry verification

- [ ] Verify both production archive schedulers remain enabled, target production, and have successful recent attempts.
- [ ] Record deployment time from `deployment.json`, then inspect all four Sentry projects (`intexuraos-home-dev`, `intexuraos-web-home-dev`, `intexuraos-hetzner`, `intexuraos-web-hetzner`) for new/recurring lifecycle, Firestore, query, and expected-auth groups after that time.
- [ ] Require a quiet observation window with no new expected Codex-auth blocker events and no lifecycle regression issue. Resolve only groups whose behavior is actually reproduced and verified fixed/suppressed.
- [ ] Mark the goal complete only after code, data, application revisions, schedulers, failed-task UX, and Sentry are all verified.
