# Sentry Cross-Issue Remediation Deduplication Plan

> Execution handoff for an agent starting from clean clones. Treat file paths as
> anchors, not as immutable line numbers. Before editing, re-read the current
> repository rules and verify every baseline assumption below against the latest
> default branches.

## Goal

One failed Code Task dispatch occurrence must create at most one Linear issue and
one Sentry Code Task, even when SentryBox groups its logs into multiple Sentry
issues. A genuinely new dispatch occurrence must remain eligible for a new
remediation.

## Scope

Implement exactly two compatible changes:

1. **IntexuraOS consumer:** correlate signed Sentry deliveries transactionally
   before any Linear or Code Task side effect.
2. **SentryBox producer:** normalize the dispatch-attempt field and include the
   trusted correlation fields in the signed Code Agent webhook payload.

Do not add fuzzy title, stack, HTTP-status, or time-window matching. Do not
change secrets, Worker settings, orchestrator capacity, unrelated Sentry
behavior, or PR-review deduplication. Do not enable a Worker as part of this
plan.

## Confirmed Baseline — Revalidate Before Implementation

The baseline was inspected on 2026-08-20 at:

- `pbuchman/intexuraos` `development`:
  `3efcbe35fafa1f4298457990692c73d6c814da3d`
- `pbuchman/sentrybox` `main`:
  `4ae866742f15ae7348a1997bcb3ae7c05973e4c4`

The observed duplicate pair was SentryBox issues 135 and 136. Both events had:

- environment: `prod`
- task ID: `task_review_3575a69848b633cd68c25a0688a6c6d1`
- trace ID: `7c5f9b88d035451ebea52ef9d653de7b`

They did not contain a dispatch-attempt ID. The task trace ID is stored on the
Code Task and is reused by later claims of that same task, so it is useful
context but is not a safe attempt identity.

At the inspected baseline:

- `taskDispatcherImpl.ts` emits `Worker dispatch request failed`, then
  `drainTaskQueue.ts` emits `Drain dispatch failed with permanent error` for the
  same occurrence.
- SentryBox stores `environment`, `taskId`, and `traceId`, but
  `apps/server/src/webhooks/payload.ts` omits them from the signed webhook.
- Code Agent deduplication in `sentryIssueEventRepository.ts` uses the Sentry
  issue ID as its hard problem key, so two Sentry issue IDs can create two
  remediations.

### Mandatory pre-flight

Before writing tests or code:

1. Start from clean clones of the latest `development` and `main` branches.
2. Read the current `AGENTS.md`, `.claude/CLAUDE.md`, and referenced rules where
   present.
3. Locate the current equivalents with `rg`; do not rely on the line numbers in
   this plan:
   - `processSentryWebhook`
   - `createSentryProblemDedupeKey`
   - `createFirestoreSentryIssueEventRepository`
   - `claimForDispatch`
   - `Worker dispatch request failed`
   - `buildCodeAgentOutboxDraft`
4. Confirm that every successful dispatch claim still produces a unique
   `dispatchToken`, and that no external endpoint accepts it as an
   authentication credential. If a separate trusted attempt ID now exists, use
   that instead.
5. Confirm that SentryBox still normalizes and stores `environment`, `taskId`,
   and `traceId`. Confirm the current automatic-retry and manual-redrive
   semantics before changing their tests.
6. Confirm that Code Agent still creates Linear before Code Task and that the
   existing reservation is lease-token fenced.
7. If trusted correlation or equivalent cross-issue deduplication already
   exists, update the plan to the current architecture instead of duplicating
   it. If the change would require a composite query, migration, secret change,
   or Worker configuration change, stop and redesign around direct document-ID
   access; none is required for the intended solution.

## Correlation Contract

SentryBox adds these optional fields inside the signed `data.event` object:

```json
{
  "environment": "prod",
  "task_id": "task_review_...",
  "dispatch_attempt_id": "<per-claim UUID>",
  "trace_id": "7c5f..."
}
```

Code Agent trusts cross-issue correlation only when environment, task ID, and
dispatch-attempt ID are valid. The trace ID remains diagnostic context. The
occurrence key is:

```text
sha256(
  "sentry-occurrence-v1" + NUL +
  organization + NUL + project + NUL + environment + NUL +
  "code-task.dispatch" + NUL + taskId + NUL + dispatchAttemptId
)
```

Use the existing per-claim `dispatchToken` as `dispatchAttemptId`; do not add a
second persisted identifier and do not include it in the Worker request body.
The next claim receives a different token, so a later failure of the same task
remains distinct. If any required correlation field is absent or invalid,
preserve the existing issue-ID behavior; never fall back to task ID, trace ID,
or text similarity.

## Task 1 — IntexuraOS Consumer And Source Collapse

Work in one IntexuraOS implementation branch and one implementation PR.

### Files to inspect first

- `apps/code-agent/src/domain/models/sentryIssueEvent.ts`
- `apps/code-agent/src/infra/sentry-event-parser.ts`
- `apps/code-agent/src/infra/firestore/sentryIssueEventRepository.ts`
- `apps/code-agent/src/domain/usecases/processSentryWebhook.ts`
- `apps/code-agent/src/domain/services/taskDispatcher.ts`
- `apps/code-agent/src/domain/usecases/drainTaskQueue.ts`
- `apps/code-agent/src/domain/usecases/drainRetryQueue.ts`
- `apps/code-agent/src/infra/services/taskDispatcherImpl.ts`
- their focused tests under `apps/code-agent/src/__tests__/`
- `firestore-collections.json`

### Test first

Add focused failing tests proving:

1. Different Sentry issue/event IDs with the same trusted correlation, both
   sequentially and concurrently, produce one reservation, one Linear call, one
   Code Task create, and one enqueue.
2. Changing dispatch-attempt ID, task ID, environment, organization, or project
   produces a distinct occurrence. Changing trace ID alone does not split one
   trusted dispatch attempt.
3. Missing, blank, oversized, or malformed optional fields preserve current
   issue-level behavior.
4. Lease expiry recovers the same proposed Code Task and Linear identity; a
   stale lease token cannot checkpoint, complete, or fail the new owner.
5. Queue and retry drains pass their claim token internally as
   `dispatchAttemptId`; it reaches structured logs but not the signed Worker
   request body.
6. The lower-level `Worker dispatch request failed` log remains in normal logs
   but is marked `_skipSentry: true`.

Use the two observed events in two forms: keep the historical pair unchanged to
prove issue-level fallback, and create an enriched pair with the same synthetic
valid `dispatchAttemptId` plus `remediationFamily: "code-task.dispatch"` to
prove cross-issue deduplication. Confirm the enriched test fails for the
expected duplicate behavior before implementing.

### Implement

1. Extend the internal `DispatchRequest` with `dispatchAttemptId`. Both queue
   drains pass the successful claim's `dispatchToken`; the dispatcher attaches
   it only to structured logs. Keep `WorkerTaskRequest` and its HMAC body
   unchanged.
2. Emit one canonical boundary-level Sentry error with
   `remediationFamily: "code-task.dispatch"`, `taskId`, and
   `dispatchAttemptId`. Mark the lower-level dispatch warning with
   `_skipSentry: true` while retaining it in normal logs.
3. Extend the normalized Sentry model/parser with optional source environment,
   task ID, dispatch-attempt ID, and trace ID. Validate type, non-blank value,
   and a conservative length bound. Do not parse free text.
4. In the existing `sentry-issue-events` collection, address a correlation
   record directly by the occurrence hash. Extend the repository record type
   only as needed (for example, `correlation`). Do not add a collection, query,
   index, TTL, backfill, or migration.
5. In the existing Firestore transaction, read transition, issue, and trusted
   correlation records before writes. The correlation record owns the lease,
   proposed Code Task ID, Linear ID, final Code Task ID, and terminal tombstone
   for that occurrence. Different Sentry issues with the same occurrence must
   contend on this document and return the same result.
6. When trusted correlation exists, treat the issue document as evidence/alias,
   not as a hard tombstone for every future occurrence in that Sentry issue.
   Without trusted correlation, retain current behavior.
7. Use the correlation key as the Linear idempotency key. Preserve the current
   fenced checkpoint, task-create recovery, enqueue recovery, completion, and
   failure behavior.
8. Update the existing collection description in `firestore-collections.json`
   if its documented purpose no longer describes the new correlation record.

### Verification

During development, run only focused tests. After the implementation stabilizes:

1. Run `pnpm run verify:workspace:tracked -- code-agent` once.
2. Integrate the latest `origin/development`.
3. Run `pnpm run ci:tracked` once on the final tree, immediately before the
   single implementation commit.

Do not start multiple full CI runs. Rerun the full gate only if the source tree
or base SHA changes after the successful run.

## Task 2 — SentryBox Signed Producer

Start only after the compatible IntexuraOS consumer is deployed successfully.
Use one SentryBox branch and one SentryBox PR. This PR is not a duplicate of the
IntexuraOS PR: it produces the signed fields that the first PR consumes.

### Files to inspect first

- `packages/protocol/src/normalize.ts`
- `packages/protocol/src/normalize.test.ts`
- `apps/server/src/storage/event-repository.ts`
- `apps/server/src/webhooks/payload.ts`
- `apps/server/src/webhooks/payload.test.ts`
- `apps/server/src/webhooks/dispatcher.test.ts`
- `docs/reference/sentry-compatibility.md`

### Test first, then implement

1. Add failing normalization and golden tests for exact payload bytes and HMAC
   containing `environment`, optional `task_id`, optional
   `dispatch_attempt_id`, and optional `trace_id`.
2. Prove old events without task/attempt/trace correlation still serialize and
   deliver.
3. Preserve the current delivery semantics exactly: automatic retries reuse the
   stored body, delivery ID, and signature; a manual redrive reuses the body but
   has its own delivery ID and signature.
4. Normalize `dispatchAttemptId` from the structured event field and retain it
   in the existing compressed normalized payload; do not add an indexed SQLite
   column or schema migration.
5. Pass environment, task ID, dispatch-attempt ID, and trace ID into
   `buildCodeAgentOutboxDraft`; do not change secrets.
6. Update the normative compatibility document.

Run focused tests locally. Run the repository's current required full release
gate only once for the final tree; if that gate is exclusively enforced by the
PR workflow, rely on that single workflow and do not duplicate it locally.

## Task 3 — Ordered Production Rollout

1. Merge the IntexuraOS consumer PR to `development` first.
2. Wait for the exact merge SHA's Hetzner deployment to succeed. Verify
   `/deployment.json`, `/api/code/health` including Firestore, and bounded
   `code-agent` logs. Do not enable the Worker.
3. Before merging the producer, run the paired-event acceptance case only in an
   isolated test harness with fake Linear, Code Task, and enqueue side effects.
   Assert two differently fingerprinted events with one dispatch-attempt ID
   produce one of each side effect.
4. Merge the SentryBox producer PR to `main` only after steps 2 and 3 pass.
5. Wait for its verified immutable image and Home Dev deployment. Verify the
   deployed image digest, health, webhook readiness, and no dead-letter growth.
6. Do not create a synthetic production Sentry event or Code Task while the
   Worker is stopped. In production, verify health and logs, then inspect the
   first naturally occurring correlated pair if one appears.
7. Observe correlation/lease errors and duplicate Linear/Code Task counts. A
   single occurrence pointing to multiple Linear or Code Task IDs is a release
   failure.

### Rollback

- Bad IntexuraOS rollout: revert through a new PR to `development`; use the
  standard production deployment. Additive correlation documents are harmless.
- Bad SentryBox rollout: restore the preceding immutable image. The consumer
  continues to accept the old payload.
- Do not edit Firestore directly and do not modify an applied migration; this
  plan intentionally requires neither.

## Endpoint Changes

### Modified

- `POST /webhooks/sentry`: backward-compatible optional signed correlation
  fields and internal cross-issue deduplication semantics.

### Created

- None.

### Removed

- None.

### Unchanged

- Response contract, health endpoints, Worker endpoints, secrets, and Worker
  configuration.

## Done When

- The sanitized 135/136 regression pair and its concurrent variant create
  exactly one Linear issue and one Code Task.
- A different dispatch attempt for the same task remains a distinct occurrence.
- Old signed webhook bodies still work.
- Both repository PRs pass their required gates and deploy in consumer-first
  order.
- Production verification creates no synthetic canary task and does not enable
  a Worker.
