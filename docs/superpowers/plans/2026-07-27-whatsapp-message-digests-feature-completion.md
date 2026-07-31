# WhatsApp Message Digests — Feature Completion Implementation Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute every
> task in order. Implementation subagents are forbidden; review subagents are read-only and may be
> used only after a bounded artifact is complete.

**Goal:** Extend the proven daily MVP into the complete production behavior: weekdays/weekly
schedules, deterministic catch-up and recovery, safe same-run retries, full lifecycle controls,
complete history UX, and every remaining error/accessibility/responsive state.

**Architecture:** Preserve the MVP model and identifiers. Extend schedule and run state machines in
place; do not build a second path. The scheduler processes the earliest due boundary for a
definition, the same persisted run survives every retry, and the UI renders independent generation
and transport state without optimistic claims.

**Tech stack:** Existing TypeScript/Fastify/Firestore/PubSub/LLM backend and React/Tailwind/Vitest
frontend created by the two MVP plans.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md`, plus the completed MVP
plans. Stop and repair a plan contradiction before code.

## Global execution constraints

- Continue sequentially on `codex/whatsapp-message-digests`; the primary agent writes every test and
  implementation change.
- Start only after the local group/direct MVP gate is complete and its temporary cloud-backed data
  is erased.
- Apply strict focused RED → minimal GREEN → refactor for each behavior.
- Do not add a feature flag, parallel versioned endpoint, compatibility branch, Mobile source,
  recipient choice, model choice, or alternate scheduler.
- Do not commit, deploy, apply the legacy migration, or run `pnpm run ci:tracked` in this plan.
- Use only synthetic identifiers/content in tests. Never log or persist raw LLM/source payloads
  outside their already-approved private application records.
- Browser checks in this plan use only the already-running system Chrome/profile and the authorized
  Google account, under the same restrictions as the MVP Web plan.

## Fixed completion behavior

### Calendar schedules

Expand the schedule union without changing daily records:

```ts
type MessageDigestSchedule =
  | { kind: 'daily'; localTime: string; timeZone: string }
  | { kind: 'weekdays'; localTime: string; timeZone: string }
  | {
      kind: 'weekly';
      weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
      localTime: string;
      timeZone: string;
    };
```

- Daily runs every local calendar day; weekdays skips Saturday/Sunday; weekly runs on one selected
  local weekday.
- DST chooses the real local occurrence. A nonexistent spring-forward wall time advances to the
  first valid instant that day; an ambiguous fall-back wall time uses the earlier occurrence. Tests
  and UI copy use the same documented rule.
- A scheduler tick reserves only the earliest due cadence boundary. After that run completes, the
  next tick may reserve the next missed boundary. It never combines multiple missed periods or skips
  a historical due boundary.
- Pausing preserves checkpoint/history and clears no pending run. Resume revalidates source and
  readiness and computes the first cadence boundary strictly after now; the next run window still
  begins at the preserved checkpoint, so source data has no gap.

### Recovery and retries

- Run lease TTL is 180 seconds and renews at least every 60 seconds during source paging/LLM work.
  Only the current fence may commit.
- One source read may restart from page one once after `SOURCE_CHANGED`. A second relevant mutation
  fails the same run as `source_changed`; append-only events after its watermark never restart it.
- Explicit application limits are 5,000 effective messages and 2,000,000 UTF-8 source bytes per
  run. Crossing either fails the same run as `source_too_large`; no partial aggregate is produced.
- Retryable generation failures keep `pendingWindow` and use
  `POST /message-digests/:definitionId/runs/:runId/retry` with a stable client request ID. Retry uses
  the frozen definition/instruction/window and the same run ID; it never re-reserves or advances the
  boundary.
- A definitive pre-provider delivery `failed` may retry the exact frozen outbound bytes and
  idempotency key after readiness is restored. `ambiguous` never exposes a retry. `sent` is terminal
  transport acceptance.
- Scheduler tick first reconciles pending/unknown outboxes and delivery receipts, then reserves new
  due work. Expired leases are reclaimed with a higher fence. Old workers may read but cannot commit.

### Remaining UI ownership

This plan closes `LIST-06`, complete `LIST-09`, `FORM-05`, full `SCHED-01..02`, `DETAIL-03..05`,
`HIST-01`, `RUN-02..04`, and every remaining state/accessibility variant of all earlier interaction
rows. `LEGACY-01` is tested against a mocked alias contract here and becomes data-backed in the
migration/removal plan.

## File inventory

### Create

- `apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts`
- `apps/message-digest-service/src/domain/usecases/recoverMessageDigestWork.ts`
- `apps/message-digest-service/src/domain/usecases/recoverMessageDigestWork.test.ts`
- `apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx`
- `apps/web/src/components/message-digests/MessageDigestScheduleFields.tsx`
- `apps/web/src/components/message-digests/MessageDigestHistoryFilters.tsx`
- focused tests for each new component

### Modify

- schedule, definition, run, store-port, use-case, Firestore, outbox, aggregation, notification,
  route, config, service, and test files created by the backend MVP plan;
- `packages/llm-prompts/src/message-digest/**` only for proven full-cadence/recovery prompt metadata
  behavior, never template semantics drift;
- `packages/internal-clients/src/whatsapp-service/**` only if safe retry/readiness response typing
  needs an additive field;
- all Message Digest Web types/API/hooks/components/pages/tests created by the MVP Web plan;
- `apps/web/src/App.tsx` only for URL-restored list/history filters or finalized legacy redirect
  routing;
- service docs are deferred until the infrastructure/documentation task in the next plan.

No legacy Mobile, Fishing, Terraform, nginx, production PM2, migration, or old Web digest file is
changed in this plan.

## Sequential TDD tasks

### Task 1: Complete schedule calculation and persistence

1. Extend schedule-domain tests with every weekday, weekend skipping, all seven weekly selections,
   first boundary, next boundary, missed boundaries, pause/resume, Warsaw winter/summer, nonexistent
   spring time, ambiguous autumn time, and invalid values. Observe RED before changing the union.
2. Implement the schedule union/rules and keep existing daily serialization backward-compatible.
   Re-run the schedule test after each calendar rule; expect GREEN.
3. Extend document/store tests for weekdays/weekly codecs, CAS edits, next-run indexing, pause with
   pending work, resume readiness/source revalidation, and checkpoint preservation. Observe RED.
4. Implement the smallest store/use-case changes. Existing runs retain immutable daily snapshots;
   edits affect only future reservations.
5. Extend public route schemas/OpenAPI and route tests. Reject `weekday` for daily/weekdays and require
   it for weekly. Re-run; expect GREEN.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/schedules/messageDigestSchedule.test.ts apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
```

### Task 2: Add deterministic catch-up, lease recovery, and bounded source restart

1. Add scheduler tests for one earliest missed boundary, repeated ticks after completion, blocked
   pending run, paused/deleting/migrating exclusion, page/batch cursor, readiness/source loss, and no
   gap/overlap. Observe RED.
2. Implement catch-up in the existing tick use case; do not add another scheduler.
3. Add recovery tests for expired lease reclaim with a higher fence, renewal while paging/LLM work,
   stale-worker commit rejection, pending run-request republish with byte equality, unknown publish
   acknowledgment, and terminal outbox cleanup. Observe RED.
4. Implement `recoverMessageDigestWork` and call it before new reservations on each tick.
5. Add source tests for one complete restart on relevant `SOURCE_CHANGED`, append-after-watermark
   continuation, second mutation failure, 5,001 messages, and 2,000,001 bytes. Observe RED, implement
   explicit safe failures, and verify no LLM/delivery/checkpoint advance.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts apps/message-digest-service/src/domain/usecases/recoverMessageDigestWork.test.ts apps/message-digest-service/src/domain/usecases/processMessageDigestRun.test.ts apps/message-digest-service/src/infra/pubsub/frozenPayloadPublisher.test.ts
```

### Task 3: Add same-run generation and delivery retry

1. Add use-case tests for retryable generation/source/downstream failure, non-retryable validation and
   source-too-large failures, wrong owner/definition/run, lost reservation, already completed run,
   stable client request ID, simultaneous retry winner, immutable snapshots, and same run ID/window.
   Observe RED.
2. Implement `retryMessageDigestRun` as a state-machine transition over the existing run and pending
   reservation; never call `reserveRun`.
3. Add delivery tests for definitive pre-provider failure after content completion, readiness restored,
   identical outbound `payloadJson`/hash/idempotency key/timestamp, duplicate retry, receipt already
   sent, pending, missing timeout, and ambiguous refusal. Observe RED.
4. Implement delivery-stage resume and reconciliation. Generation stays completed while delivery
   transitions independently.
5. Add public retry route/API tests for auth, client request ID, safe conflicts, and response shape;
   implement the existing endpoint from the execution goal. Re-run; expect GREEN.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts apps/message-digest-service/src/domain/usecases/reconcileMessageDigestDelivery.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts apps/web/src/services/__tests__/messageDigestsApi.test.ts
```

### Task 4: Complete list actions, sorting, pause/resume, and schedule UI

1. Extend Web API/type tests for weekdays/weekly, pause/resume CAS, retry, sortable fields/directions,
   and URL-restored filters. Observe RED.
2. Add schedule-field tests for cadence reveal/hide, weekly day, local time, IANA zone, backend-matched
   next-run preview, DST explanatory copy, ready/missing/retryable readiness, and no recipient control.
   Implement fields and integrate into create/edit.
3. Add list/action tests for accessible sortable headers, announced direction, URL/back restoration,
   View/Edit/Run/Pause/Resume/Delete exact mutation isolation, per-row pending disable, optimistic-free
   refresh, and conflict rollback. Implement the action menu and hook transitions.
4. Add detail tests for atomic pause/resume, changed next run, readiness-blocked resume with visible
   settings action, and source-unavailable behavior. Implement and re-run; expect GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__/MessageDigestScheduleFields.test.tsx src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx src/components/message-digests/__tests__/MessageDigestList.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
```

### Task 5: Complete failed-run actions and full history/run UX

1. Before changing Web, add backend store/use-case/route RED tests for the exact history grammar:
   inclusive local `fromDate`/`toDate` interpreted in the definition time zone, generation status,
   delivery status, `sort=windowStart`, direction, default `windowStart desc, runId desc`, bounded
   limit, and opaque cursor
   bound to the normalized filter/sort fingerprint. Cover invalid ranges/statuses, cursor reuse after
   filter change, owner-safe 404, immutable ordering, and required Firestore index shape. Implement
   the smallest store/use-case/schema changes and rerun those backend tests to GREEN.
2. Add hook tests for retry-run polling without a new run, delivery retry with identical run,
   ambiguous no action, stale polling response suppression, and generation/delivery terminal rules.
   Observe RED and implement.
3. Add history-filter tests for date range, generation status, delivery status, URL restoration,
   clear, no-match, refresh, cursor append, retained error, and immutable ordering. Implement
   `MessageDigestHistoryFilters` and hook query state. Assert every backend processing stage renders
   independently from the coarse generation and delivery statuses.
4. Add run-page tests for `Retry run` only with a retained failed pending window, `Retry delivery`
   only for a definitive safe failure, both confirmations/pending states, ambiguous warning, copy
   instructions/digest success/failure announcements, and Technical details closed/sanitized.
5. Implement pages/components. Copy only visible rendered text; never hidden refs/source metadata.
6. Extend legacy-redirect tests for alias loading, canonical replacement, auth redirect round trip,
   missing alias notice, and zero Mobile Notifications request. Use mocked new-service responses;
   data-backed alias implementation remains in the next plan.

Focused command:

```bash
pnpm exec vitest run apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/queryMessageDigests.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
pnpm --filter @intexuraos/web test -- src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__/MessageDigestHistoryFilters.test.tsx src/components/message-digests/__tests__/MessageDigestRunStatus.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
```

### Task 6: Exhaust every non-happy state and accessibility/responsive contract

1. Create a table in the consolidated page test mapping every execution-goal interaction ID to at
   least one named assertion. Fail the test if an ID is missing; do not leave comments as coverage.
2. Add controlled-response tests for loading, empty, initial error, retained refresh/load-more error,
   stale revision, source change, generation failure, source unavailable, source too large, readiness
   request failure, mapping missing, delivery failed/ambiguous, interrupted erasure, and auth switch.
3. Extend responsive tests at 1280×800, 1440×900, 390×844 and logical 200% zoom constraints: semantic
   table/mobile list, wrapping, no content fixed width overflow, 44px targets, long zone/name/prompt/
   Markdown, dark classes, reduced-motion behavior, keyboard order, visible focus, live regions,
   labels/descriptions, dialog Escape/return, and destructive pending lockout.
4. Implement each missing presentation rule one at a time from observed RED. Do not suppress console
   warnings or weaken assertions.
5. Run the interaction-ID completeness test again; it must enumerate all IDs exactly once or more.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestsPages.test.tsx src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx src/components/message-digests/__tests__ src/hooks/__tests__/useMessageDigests.test.ts
```

### Task 7: Close focused feature-completion gates and reviews

1. Run new-service coverage; add tests for uncovered business branches without exclusions or threshold
   reductions. Run focused WhatsApp/publisher/client regressions that guard source/readiness/delivery.
2. Run Web focused tests, backend/Web typechecks, targeted lint, workspace/export/Firestore/service
   wiring checks, and `git diff --check`.
3. Self-review state transitions, permissions, privacy, schedule math, response labels, and every UX ID.
4. Give the bounded diff to read-only reviewers for backend correctness/security/privacy,
   test-completeness, and UX/accessibility. Review agents do not edit. Resolve every accepted
   Critical/Important finding with a focused RED test and minimal GREEN fix, then repeat affected
   gates.
5. Update the active GOAL progress/checkpoint with safe counts/command outcomes only. Do not commit or
   run full CI.

Commands:

```bash
pnpm --filter @intexuraos/message-digest-service test:coverage
pnpm exec vitest run packages/internal-clients/src/whatsapp-service/__tests__/client.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts
cd apps/whatsapp-service && pnpm exec vitest run src/__tests__/privateDigestSourceRoutes.test.ts src/__tests__/outboundDeliveryRoutes.test.ts src/__tests__/pubsubRoutes.test.ts
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__ src/pages/__tests__/MessageDigestsPages.test.tsx src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx src/__tests__/navigationStructure.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/whatsapp-service typecheck
pnpm --filter @intexuraos/internal-clients typecheck
pnpm --filter @intexuraos/web typecheck
pnpm exec eslint apps/message-digest-service/src apps/web/src/types/messageDigests.ts apps/web/src/services/messageDigestsApi.ts apps/web/src/hooks/useMessageDigests.ts apps/web/src/components/message-digests apps/web/src/pages/WhatsAppMessageDigest*.tsx apps/web/src/pages/MessageDigestLegacyRedirectPage.tsx --max-warnings 0
pnpm run verify:workspace:tracked -- message-digest-service
pnpm run verify:workspace:tracked -- whatsapp-service
pnpm run verify:workspace:tracked -- web
pnpm run verify:package-exports
pnpm run verify:firestore
pnpm run verify:service-wiring
git diff --check
```

## Plan completion gate

This plan is complete only when the MVP remains green, full cadence/recovery/retry behavior works,
every interaction ID has automated proof, and no Critical/Important review finding remains. Continue
to `2026-07-27-whatsapp-message-digests-migration-removal.md`; do not commit, deploy, run migration
apply, or run full CI.
