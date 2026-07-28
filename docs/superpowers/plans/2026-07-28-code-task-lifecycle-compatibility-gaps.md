# Code Task Lifecycle Compatibility Gaps Plan

> **Execution:** Follow strict RED → GREEN → refactor in this branch. This is the compatibility follow-up to `2026-07-27-code-task-lifecycle-time.md`.

**Goal:** Close the remaining lifecycle-time compatibility gaps without changing Dispatch Queue or worker authorization behavior: legacy `completed` documents must hydrate to the public status model, completion timestamps must be immutable across metadata writes, archive backfills must preserve the pre-archive lifecycle moment, and issue groups must use their authoritative exact task membership instead of a newest-50 reconstruction.

**Architecture:** Keep the Firestore serializer as the single legacy hydration/write-invariant boundary, with a separate pre-archive completion resolver so archive timestamps cannot hide earlier terminal evidence. For issue groups, use `TaskGroupSummary.taskIds` as authoritative membership. Dedupe all exact IDs for the whole response page, including phantom-check summaries, and hydrate them through a required owner-scoped bulk port implemented with Firestore `getAll()` in fixed-size sequential chunks. Only summaries without `taskIds`, and archived summaries whose exact active membership is intentionally empty, use the existing bounded legacy query. Reconcile aggregate/latest/activity fields from the summary so stale missing task IDs cannot silently change group classification.

**Constraints:**

- Resolve lifecycle time against the raw legacy document before normalizing `status: completed`.
- Normalize legacy `completed` as `planned`, `reviewed`, or `implemented` according to `agentType`; raw `completed` must never reach public API/UI schemas.
- A same-status terminal update never replaces an existing `completedAt`; an explicit valid value may fill a missing one. It never advances `statusChangedAt`.
- Archiving at T2 preserves the resolved pre-archive lifecycle at T1 in `completedAt`; metadata at T3 on an already archived legacy task does the same.
- Exact `taskIds` are deduplicated in first-seen order across displayed and phantom-check summaries, read through `getAll()` chunks of at most 100 documents, and never fall back to the newest-50 query merely because an ID is stale or missing.
- Missing exact IDs are logged; the group still takes authoritative aggregate/latest/activity semantics from its summary.
- No wide per-user task query, new Firestore index, Dispatch Queue behavior, or worker auth change.

## Task 1: Lock common hydration and timestamp invariants

**Files:**

- Modify: `apps/code-agent/src/__tests__/infra/firestore/task-serializer.test.ts`
- Modify: `apps/code-agent/src/__tests__/domain/models/taskLifecycleTime.test.ts`
- Modify: `apps/code-agent/src/domain/models/taskLifecycleTime.ts`
- Modify: `apps/code-agent/src/infra/firestore/task-serializer.ts`

- [x] RED: add table regressions for raw `completed` planning/review/execution hydration and INT-985 lifecycle T1 despite later `updatedAt=T2`.
- [x] RED: prove every same-status terminal write preserves existing `completedAt=T1`, may fill a missing value explicitly, and never writes `statusChangedAt`.
- [x] RED: prove terminal → archived at T2 and archived metadata at T3 fill missing `completedAt` from pre-archive lifecycle T1.
- [x] RED: prove archived `statusChangedAt=T_archive` cannot mask earlier `dispatchStatus.terminalCause.lastSeenAt=T_failure` during metadata or archived→completion restoration.
- [x] GREEN: add a pre-archive completion resolver, normalize status only after raw lifecycle resolution, and enforce completion immutability/lifecycle-derived archive fallback in `buildUpdateData()`.
- [x] Run the focused serializer suite and typecheck.

## Task 2: Lock public detail/list compatibility

**Files:**

- Modify: `apps/code-agent/src/__tests__/routes/codeTasks.test.ts`

- [x] RED: seed the exact INT-985-shaped raw Firestore document and prove both task detail and list return `planned`, lifecycle T1, technical T2, and no raw `completed` value.
- [x] GREEN: rely on the common hydrator; make no route-specific legacy status mapping.
- [x] Run the focused route suite.

## Task 3: Replace newest-50 issue-group reconstruction for current summaries

**Files:**

- Modify: `apps/code-agent/src/domain/repositories/codeTaskRepository.ts`
- Modify: `apps/code-agent/src/infra/firestore/firestoreCodeTaskRepository.ts`
- Modify: `packages/infra-firestore/src/testing/firestoreFake.ts`
- Modify: `apps/code-agent/src/__tests__/infra/repositories/firestoreCodeTaskRepository.test.ts`
- Modify: `apps/code-agent/src/__tests__/routes/code/issueGroups.test.ts`
- Modify: `apps/code-agent/src/routes/code/issueGroupRoutes.ts`
- Create: `apps/code-agent/src/routes/code/issueGroupTaskLoader.ts`
- Create: `apps/code-agent/src/__tests__/routes/code/issueGroupTaskLoader.test.ts`

- [x] RED: add INT-985 group regression for public schema/status/lifecycle semantics.
- [x] RED: add a 52-task group where the oldest-created attempt changes lifecycle last; assert all exact tasks, pipeline, aggregate status, latest task, and last activity remain mutually consistent.
- [x] RED: prove the Firestore bulk repository preserves requested order, filters missing/foreign-owner documents, and chunks more than 100 IDs.
- [x] RED: prove the shared route loader deduplicates exact IDs, invokes the required bulk port once, restores stable order, and logs only missing-ID counts; prove the route feeds it one pool across displayed + phantom-check summaries.
- [x] GREEN: add required `findByIdsForUser` to the repository port and implement it with Firestore `getAll()` in sequential chunks of 100; extend the shared Firestore fake and repository mocks with matching read semantics.
- [x] GREEN: when `summary.taskIds` is present, stable-dedupe IDs globally for the page and use the bulk loader once; preserve summary ID order before domain sorting.
- [x] GREEN: log missing/stale/foreign exact-ID counts without identifiers and do not switch that summary to the recent-50 path.
- [x] GREEN: use the bounded recent-by-issue path only for legacy summaries without `taskIds` or archived summaries with intentionally empty active membership.
- [x] GREEN: reconcile authoritative aggregate, newest-attempt, and lifecycle-activity fields from the summary while deriving the task/pipeline presentation from exact hydrated tasks.
- [x] Run focused group route tests and typecheck.

## Task 4: Verify the branch and commit

- [x] Run all focused compatibility tests.
- [x] Run `pnpm --filter @intexuraos/code-agent test`, typecheck, and lint.
- [x] Run the repository tracked CI command required by project rules.
- [x] Review public schemas and legacy fixtures for any remaining raw `completed` path.
- [ ] Commit only green work as `fix(code-agent): close lifecycle compatibility gaps`.
- [ ] Do not push or deploy from this delegated task.

## Task 5: Independent-review compatibility round

**Query and public schema**

- [ ] RED: prove `GET /tasks?status=planned` returns the retained raw `completed` planning task through full pages and stable cursors, while post-hydration filtering excludes raw `completed` tasks that normalize to another public status.
- [ ] GREEN: widen only completion-compatible persisted status queries to include raw `completed`, then perform a bounded paginated scan until `limit + 1` public-status matches are found.
- [ ] RED/GREEN: constrain the task-detail response schema to the public `TaskStatus` enum.

**Issue-group authority and ordering**

- [ ] RED: prove raw `completed` values in `taskStatusById`/`latestTaskStatus` never leak through `lastActivityStatus`.
- [ ] RED: prove exact summary membership keeps a task under the summary identity even when the task's retained `linearIssueId` disagrees.
- [ ] RED: prove mixed archived/non-archived phantom checks use per-summary visibility, not the displayed archived filter globally.
- [ ] RED: prove summary `mostRecentDispatchedAt: null` clears a derived task value and that PR sorting preserves authoritative summary query order.
- [ ] GREEN: build at most one group per summary, force summary identity, preserve summary repository order, prefer hydrated public statuses, and reconcile nullable dispatched state.

**Timestamp and read compatibility**

- [ ] RED: through the real summary serializer/repository, prove malformed optional timestamps are omitted/null and malformed required timestamps fail instead of becoming `Timestamp.now()`.
- [ ] GREEN: split strict required and safe optional/nullable summary timestamp parsing.
- [ ] RED: prove archived detail and issue-group responses synthesize missing `completedAt` from terminal cause T1 while retaining archive `statusChangedAt` T2.
- [ ] GREEN: share one public completion-time formatter backed by `resolveMissingTaskCompletionTime()`.

**Bounded fallback and telemetry**

- [ ] RED/GREEN: owner-scope legacy issue fallback with a bounded paginated scan over the existing Linear-issue ordering, so foreign tasks cannot consume the first-50 window.
- [ ] RED/GREEN: mark expected missing/drift warnings and bounded exact hydration telemetry with `SKIP_SENTRY`, without task identifiers.
- [ ] RED/GREEN: remove the duplicate route-level error capture when the bulk repository already reports an infrastructure failure.

**Final gate**

- [ ] Run the expanded focused suites, production/test typechecks, lint, full tracked CI without concurrent Vitest processes, and a second independent review.

## Task 5b: Second-review identity and timestamp corrections

- [ ] RED: when an exact member's retained `linearIssueId` disagrees with its summary, keep the synthetic summary identity only inside group/pipeline computation, while public `group.tasks` and `latestTask` retain the task's original `linearIssueId`/`linearIssue`; group identity and group Linear metadata still come from the summary.
- [ ] GREEN: restore original task-level Linear fields after grouped derivation without weakening authoritative summary membership.
- [ ] RED: prove an optional finite JavaScript `Date` outside Firestore's timestamp range is omitted/null without throwing, while the same value in a required timestamp fails deterministically through the real serializer/repository.
- [ ] RED: prove a private timestamp shape with valid `_seconds` but present malformed `_nanoseconds` never defaults nanos to zero; optional values are omitted/null and required values fail deterministically.
- [ ] GREEN: catch `Date` → `Timestamp` range failures and default nanos to zero only when `_nanoseconds` is absent; if present, require a finite integer within Firestore's nanosecond range.

## Task 6: Production observability and reversible lifecycle backfill

**Sentry release and quota controls**

- [ ] RED: prove the shared Sentry release resolver prefers a valid non-placeholder `INTEXURAOS_COMMIT_SHA`, falls back to a valid non-placeholder `K_REVISION`, and omits empty/`unknown` values.
- [ ] RED: prove the shared default tracing policy is exactly `prod|production = 0.1`, every other/undefined environment = `0`, and an explicit override always wins for Node and worker initialization.
- [ ] RED: prove the web Sentry configuration uses the same release SHA and tracing policy through a pure, testable helper and never exposes secrets.
- [ ] GREEN: centralize the shared release and tracing defaults and connect them to Node, worker, and web Sentry initialization.
- [ ] RED/GREEN: pass the already validated 40-character deployment SHA into `reload-pm2.sh` and propagate it as `INTEXURAOS_COMMIT_SHA` to every PM2 application environment.
- [ ] RED: prove the deployment semantic health verifier rejects non-JSON, non-2xx, wrong `status`, wrong `serviceName`, empty checks, any failed check, and a failed/missing Firestore check for both direct and public `/api/code/health`.
- [ ] GREEN: add the tested semantic health verifier and make both direct and public code-agent health contracts mandatory deploy gates; HTTP success alone must not pass.

**Fail-closed production apply contract**

- [ ] RED: prove apply accepts only explicit `--phase=tasks|summaries`, exactly `--limit=200`, page size default/max 200, and a mandatory lowercase 40-hex `--expected-release-sha`; reject apply/all and every missing or malformed gate.
- [ ] RED: prove every apply batch performs deployment D1 → semantic code health H → deployment D2 with exact SHA, no-store, JSON, and canonical document/health contracts, then repeats the same gate immediately after durable journal creation and before the first write.
- [ ] GREEN: inject fetch and clock dependencies, centralize the production gate, and fail closed on every transport, cache, content-type, contract, SHA, or D1/D2 drift failure.

**Owner-fenced maintenance lock**

- [ ] RED: prove a registered, no-index maintenance-lock collection supports one owner/operation, safe same-operation resume, explicit release, and stale-lock diagnosis without automatic takeover.
- [ ] RED: prove resume requires matching operation and journal proof; a foreign, mismatched, or stale lock stops without exposing IDs or PII.
- [ ] GREEN: acquire/update/release the owner-fenced lock transactionally without a new index and thread its proof through apply and rollback.

**Immutable preimage journal and deterministic writes**

- [ ] RED: prove the journal directory is `0700`, journal file is `0600`, creation is exclusive (`wx`), file and directory are fsynced, and the reported SHA-256 verifies the exact immutable bytes.
- [ ] RED: prove stdout/Sentry never receive entries, document IDs, task IDs, issue IDs, or PII; only stable codes, operation ID, journal hash, counts, and cursor are emitted.
- [ ] RED: prove task journal entries contain only touched-field presence/preimage, source proof, and deterministic expected postimage; summary entries contain lossless raw summary/count pre/post/source proof with typed Firestore timestamps preserving nanos.
- [ ] GREEN: derive every postimage from the existing plan/proof before opening the journal, persist the complete immutable batch journal, then rerun the production gate before any Firestore write.

**CAS rollback**

- [ ] RED: prove rollback verifies the journal hash, expected release and health gates, and matching maintenance lock before mutation.
- [ ] RED: prove rollback visits entries in reverse order and applies field-level CAS: expected post → restore preimage, preimage → already reverted, anything else → conflict and stop; never full-document restore or blind overwrite.
- [ ] GREEN: add the rollback CLI and sanitized single-capture technical failure handling with stable reports/cursors.

**Operations and final gate**

- [ ] RED/GREEN: register the maintenance-lock collection in `firestore-collections.json` with no Terraform/PITR changes.
- [ ] Correct `docs/operations/sentry-code-task-automation.md`: Hetzner receives the webhook, while `INTEXURAOS_SENTRY_AUTH_TOKEN` is required by the home-dev orchestrator and injected into workers; document safe systemd environment sync, restart, and verification without rotating the secret or changing runtime now.
- [ ] Write `docs/operations/code-task-lifecycle-backfill.md` with executable dry-run/apply/resume/rollback commands, `0600` report handling, cursor rules, six task-ID examples, stop criteria, and rollback procedure; link it from the Hetzner runbook.
- [ ] Require, after every successful batch and before the next one, copying the journal over SSH to a local `0700` directory/`0600` file and verifying its SHA-256 against the sanitized report; code does not automate this transfer.
- [ ] Run all Task 6 focused RED tests and record the exact failure-to-requirement map before implementation.
- [ ] Run all Task 6 focused suites GREEN, then typecheck/lint and the full tracked CI only after removing the generated `.vitest-reports` directory with no Vitest process running.
- [ ] Do not commit, push, merge, or deploy from this delegated task.
