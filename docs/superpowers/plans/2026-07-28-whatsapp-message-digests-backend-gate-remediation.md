# WhatsApp Message Digests — Backend Gate Remediation Plan

> **For the primary agent:** Execute this plan sequentially with
> `superpowers:executing-plans`, `superpowers:test-driven-development`, and
> `superpowers:systematic-debugging`. Subagents are review-only.

**Goal:** Close every Critical and Important finding from the first independent backend review,
then repeat the backend review gate before any Web implementation.

**Architecture:** Preserve the frozen service boundaries. `message-digest-service` remains the
only digest owner, `whatsapp-service` remains the source and outbound-delivery owner, and Mobile
Notifications remains untouched until the later atomic-removal phase. Strengthen the existing
transactional outbox, erasure fencing, idempotency, bounded scheduler, LLM aggregation, and public
request boundary without introducing a feature flag or compatibility path.

**Verification policy:** Every behavior change starts with one focused RED test. Run only affected
tests, typechecks, and local lint while executing this plan. Do not run `pnpm run ci:tracked`; the
execution goal reserves one full tracked-CI run for the final production tree.

## Gate findings and frozen resolutions

1. An in-flight Pub/Sub publish must keep a renewable fenced dispatch claim until it settles. The
   production Pub/Sub topic disables provider retries and applies a bounded RPC deadline shorter
   than one claim interval. The dispatcher heartbeats the durable claim while awaiting the provider
   and records the outcome with a fresh post-publish timestamp. Erasure remains in `quiescing` while
   any run lease or dispatch claim is active.
2. A definition stores one `activeErasureRequestId`. The first DELETE sets it atomically with
   `status=deleting`; a different request ID conflicts, while the original request resumes.
3. `failRun` requires matching owner/fence and an unexpired lease at `failedAt`.
4. Deterministic create and manual-run replays perform owner-safe existing-record lookup before any
   mutable WhatsApp/readiness/token dependency. An exact request digest returns the durable result;
   substitution conflicts. An existing manual run is never republished by the public route.
5. Create requires the requested lifecycle `status: active|paused`. Ready+paused remains paused;
   ready+active becomes active; non-ready always becomes paused/needs-attention and reports
   `delivery_setup_required`. Status participates in the idempotency fingerprint.
6. Delivery reconciliation persists attempts, first-missing time, and next-check time. Fresh
   `missing`/`pending` observations rotate with bounded backoff; stale missing becomes terminal
   failed and stale pending becomes terminal ambiguous. One scheduler tick drains a fixed maximum
   number of pages for dispatch and delivery recovery, so old rows cannot starve later rows.
7. Due-definition cursors carry the original evaluation cutoff. Continuation uses that frozen
   cutoff even when the next request has a later wall clock; completing the scan starts a fresh
   cutoff.
8. The platform language policy follows a language explicitly requested in the definition
   instructions, otherwise the dominant source-window language. Templates continue to request
   Polish in their own editable instructions. Multi-chunk aggregation performs one bounded final
   synthesis (plus at most one repair) instead of concatenating partial outputs.
9. Public Message Digest routes use one encapsulated request hook with `bodyPreviewLength: 0` and a
   stable route template; prompts, IDs, and bodies never enter logs.
10. The WhatsApp owner package must regain a clean OpenAPI contract for the new internal routes.
    The isolated Private Sync test must pass without coverage; if only the coverage run exceeds its
    timeout, record it as verified load sensitivity and do not widen unrelated global timeouts.

## Task 1: Fence dispatch effects and erasure

**Files:**

- Modify `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- Modify `apps/message-digest-service/src/domain/ports/messageDigestPublishers.ts`
- Modify `apps/message-digest-service/src/domain/usecases/dispatchMessageDigestOutbox.ts`
- Modify `apps/message-digest-service/src/domain/usecases/dispatchMessageDigestOutbox.test.ts`
- Modify `apps/message-digest-service/src/domain/models/messageDigestDefinition.ts`
- Modify `apps/message-digest-service/src/domain/models/messageDigestErasure.ts`
- Modify `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- Modify `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- Modify `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- Modify `apps/message-digest-service/src/infra/pubsub/frozenPayloadPublisher.ts`
- Modify `apps/message-digest-service/src/infra/pubsub/frozenPayloadPublisher.test.ts`
- Modify `apps/message-digest-service/src/services.ts`
- Modify `apps/message-digest-service/src/services.test.ts`

**RED tests:**

- A deferred publisher remains unresolved beyond the original claim interval; heartbeat renewals
  keep DELETE in `quiescing`. After publish settles and the fresh outcome is recorded, the original
  erasure request can advance.
- A second erasure request ID for the same deleting definition receives `ERASURE_CONFLICT`; the
  first request remains resumable.
- `failRun` at or after `lease.expiresAt` returns `LEASE_LOST` without mutating the run.
- The production Pub/Sub topic is constructed with batching bounded to one immediate message,
  provider retry disabled, and a fixed RPC timeout shorter than the claim interval.

**GREEN implementation:**

- Add `renewDispatchClaim` with owner/fence/expiry validation and no content projection.
- Add a dispatcher heartbeat loop with an injected wait seam for deterministic tests. Obtain time
  again for every renewal and for `recordDispatchResult`; never reuse claim-start time.
- Add the persisted active erasure request fence and enforce it in the first transaction.
- Add fail-lease expiry validation.
- Configure the concrete Pub/Sub topic deadline; keep invalid payload and acknowledgement-unknown
  outcomes privacy-safe.

**Focused gate:**

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/domain/usecases/dispatchMessageDigestOutbox.test.ts \
  src/infra/pubsub/frozenPayloadPublisher.test.ts \
  src/infra/firestore/firestoreMessageDigestStore.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/message-digest-service lint:local
```

## Task 2: Restore durable idempotency and requested create state

**Files:**

- Modify `apps/message-digest-service/src/domain/usecases/createMessageDigest.ts`
- Modify `apps/message-digest-service/src/domain/usecases/createMessageDigest.test.ts`
- Modify `apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.ts`
- Modify `apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.test.ts`
- Modify `apps/message-digest-service/src/routes/messageDigestSchemas.ts`
- Modify `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- Modify `apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts`

**RED tests:**

- Repeating an exact create after source/readiness later becomes unavailable returns the existing
  definition without calling either mutable dependency; changing any request field conflicts.
- Repeating an exact completed manual run with an expired preparation token returns the existing run
  without token/readiness/context work; a different request ID does not alias it.
- The public run route dispatches only `reserved`, never `existing`.
- Create rejects a missing/unknown status and covers ready-active, ready-paused, and
  non-ready-active downgrade behavior.

**GREEN implementation:**

- Add `getOwnedDefinition` to create dependencies and look up the deterministic definition ID
  before schedule/source/readiness work. Compare the stored create request digest.
- Add `getOwnedRun` to manual-run dependencies and look up the deterministic run ID before token
  validation. Compare owner, definition, trigger, and request digest.
- Add required `status` to domain input, JSON schema, route DTO, fingerprint, and definition
  projection.
- Dispatch the run-request outbox only for a newly reserved run.

**Focused gate:**

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/domain/usecases/createMessageDigest.test.ts \
  src/domain/usecases/reserveMessageDigestRun.test.ts \
  src/__tests__/messageDigestRoutes.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
```

## Task 3: Bound scheduler cursors and delivery reconciliation

**Files:**

- Modify `apps/message-digest-service/src/domain/models/messageDigestRun.ts`
- Modify `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- Modify `apps/message-digest-service/src/domain/usecases/reconcileMessageDigestDelivery.ts`
- Modify `apps/message-digest-service/src/domain/usecases/reconcileMessageDigestDelivery.test.ts`
- Modify `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.ts`
- Modify `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts`
- Modify `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- Modify `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- Modify `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- Modify the future index inventory in
  `docs/superpowers/plans/2026-07-27-whatsapp-message-digests-migration-removal.md`

**RED tests:**

- A due cursor issued at T1 succeeds at T2 and continues against the frozen T1 cutoff.
- More than one recovery page is visited with a fixed hard page cap and stable cutoff.
- Fresh missing/pending receipts persist a later `nextCheckAt` and no terminal lie.
- Missing beyond its deadline becomes failed with `DELIVERY_RECEIPT_MISSING`; pending beyond its
  deadline becomes ambiguous. Updating the row removes it from the head of the immediately-due
  query so later deliveries are reached.

**GREEN implementation:**

- Encode the evaluated-at cutoff in due cursor values and keep a stable fingerprint.
- Add delivery reconciliation metadata and one fenced store method for non-terminal observation.
- Query only `delivery.nextCheckAt <= now`, ordered by next check then run ID.
- Follow recovery cursors for a small constant page count using one scheduler timestamp.

**Focused gate:**

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/domain/usecases/reconcileMessageDigestDelivery.test.ts \
  src/domain/usecases/tickMessageDigestScheduler.test.ts \
  src/infra/firestore/firestoreMessageDigestStore.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
```

## Task 4: Preserve prompt language control and synthesize chunks

**Files:**

- Modify `packages/llm-prompts/src/message-digest/types.ts`
- Modify `packages/llm-prompts/src/message-digest/aggregatePrompt.ts`
- Create `packages/llm-prompts/src/message-digest/synthesisPrompt.ts`
- Modify `packages/llm-prompts/src/message-digest/index.ts`
- Modify `packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts`
- Modify `apps/message-digest-service/src/domain/ports/messageDigestClients.ts`
- Modify `apps/message-digest-service/src/domain/usecases/previewMessageDigest.ts`
- Modify `apps/message-digest-service/src/domain/usecases/previewMessageDigest.test.ts`
- Modify `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.ts`
- Modify `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.test.ts`
- Modify `apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts`
- Modify `apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts`

**RED tests:**

- A custom instruction requesting English is not overridden by a Polish platform setting.
- Fishing and direct templates continue to request Polish through their own instruction text.
- Two chunks cause two chunk calls plus one synthesis call; the final response is the synthesis,
  evidence is constrained to the union of chunk refs, usage includes synthesis, and malformed
  synthesis gets at most one repair.

**GREEN implementation:**

- Replace the hard-coded language with the frozen instruction-first fallback policy in preview and
  worker paths.
- Add a strict bounded synthesis prompt and reuse the same sanitizer/schema/repair discipline.
- Return one coherent final aggregate; remove concatenation of partial headings and summaries.

**Focused gate:**

```bash
pnpm exec vitest run \
  packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/domain/usecases/previewMessageDigest.test.ts \
  src/domain/usecases/processMessageDigestRun.test.ts \
  src/infra/llm/messageDigestAggregator.test.ts
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm --filter @intexuraos/message-digest-service typecheck
```

## Task 5: Restore request/OpenAPI gates

**Files:**

- Modify `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- Modify `apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts`
- Modify the affected WhatsApp internal route response schemas identified by
  `apps/whatsapp-service/src/__tests__/openapi-contract.test.ts`

**RED tests:**

- Public route logs contain a stable route template and method but neither body, prompt, source IDs,
  definition IDs, nor request IDs.
- WhatsApp OpenAPI contains no `Default Response` placeholder for the new digest-source or delivery
  routes.

**GREEN implementation:**

- Register one encapsulated public-route request hook using `logIncomingRequest` and
  `bodyPreviewLength: 0`.
- Add only the missing explicit response contracts on affected WhatsApp routes.

**Focused gate:**

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/__tests__/messageDigestRoutes.test.ts
pnpm --filter @intexuraos/whatsapp-service exec vitest run \
  src/__tests__/openapi-contract.test.ts \
  src/__tests__/privateSyncRoutes.test.ts --fileParallelism=false
pnpm --filter @intexuraos/message-digest-service lint:local
pnpm --filter @intexuraos/whatsapp-service lint:local
```

## Task 6: Repeat the backend gate

Run focused ownership verification only:

```bash
pnpm run verify:workspace:tracked message-digest-service
pnpm run verify:workspace:tracked whatsapp-service
pnpm --filter @intexuraos/internal-clients test
pnpm exec vitest run \
  packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/whatsapp-pubsub-client test
pnpm run verify:package-exports
pnpm run verify:firestore
git diff --check
```

Then request one independent read-only backend review against this plan and the execution goal.
Proceed to the Web plan only when it reports no Critical or Important findings. Record the backend
checkpoint and update the active GOAL progress. Do not commit and do not run full tracked CI.

## Task 7: Reject re-entrant claims and unsafe generated Markdown

The repeated review closed the original nine findings but identified two new Important findings and
one auditability Minor. This task is a required continuation of the same backend gate; Web remains
blocked until it is green and re-reviewed.

**Files:**

- Modify `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.ts`
- Modify `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.test.ts`
- Modify `apps/message-digest-service/src/domain/usecases/dispatchMessageDigestOutbox.ts`
- Modify `apps/message-digest-service/src/domain/usecases/dispatchMessageDigestOutbox.test.ts`
- Modify `apps/message-digest-service/src/infra/llm/messageDigestAggregator.ts`
- Modify `apps/message-digest-service/src/infra/llm/messageDigestAggregator.test.ts`
- Modify `packages/llm-prompts/src/message-digest/aggregatePrompt.ts`
- Modify `packages/llm-prompts/src/message-digest/synthesisPrompt.ts`
- Modify `packages/llm-prompts/src/message-digest/repairPrompt.ts`
- Modify `packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts`

**Frozen resolution — run and dispatch ownership:**

- A successful claim with `disposition=existing` means another invocation already owns the active
  lease/claim, even when both invocations supplied the same owner digest. It is never permission for
  a second execution.
- `processMessageDigestRun` returns `deferred` immediately for an existing run lease before source,
  readiness, history, LLM, completion, or delivery-dispatch work.
- `dispatchMessageDigestOutbox` returns `deferred` immediately for an existing dispatch claim before
  selecting or invoking a publisher, starting a heartbeat, or recording an outcome.
- Pub/Sub then returns its existing retryable 503 for the losing run invocation. After the winner
  terminalizes the run, a later redelivery observes `RUN_TERMINAL` and acknowledges safely. No
  owner/fence is shared by concurrent work and no duplicate LLM cost or provider publication occurs.

**Ownership RED tests:**

- A run lease claim returning `ok=true, disposition=existing` produces `deferred` and invokes none
  of the source/readiness/history/LLM/stage/completion/failure/dispatch dependencies.
- A dispatch claim returning `ok=true, disposition=existing` produces `deferred` and invokes neither
  publisher, no heartbeat renewal, and no dispatch-result write.
- Existing acquired/claimed paths remain green, including terminal replay and claim-loss behavior.

**Frozen resolution — generated Markdown:**

- Generated `summaryMarkdown` and `continuityMemoryMarkdown` permit ordinary text and structural
  Markdown but forbid every Markdown/HTML image and every model-generated Markdown link. Digest CTA
  links remain application-owned and are appended by the WhatsApp formatter, never by the LLM.
- Raw HTML continues to be entity-escaped and unsafe controls/bidirectional overrides continue to be
  removed. After that normalization, any unescaped image opener, inline-link construct,
  reference-link construct, or reference definition makes the aggregate invalid; the existing one
  bounded repair call may correct it. If repair is still unsafe, return `INVALID_AGGREGATE` and
  persist nothing.
- Aggregate, synthesis, and repair prompts explicitly state the no-links/no-images output rule. The
  validation remains authoritative even if the model ignores that instruction.

**Markdown RED tests:**

- An otherwise schema-valid aggregate containing an inline image or a `javascript:` Markdown link
  is rejected and triggers exactly one repair; a safe repaired response succeeds.
- Reference definitions nested under a GFM block quote or list container are rejected together with
  their shortcut references; relative destinations are not an escape from the no-links rule.
- Unsafe Markdown in continuity memory is treated identically.
- An unsafe repair response returns `INVALID_AGGREGATE`; it is never returned for persistence.
- A literal whose opening bracket is escaped, such as `\[label](/relative)`, is not a link and remains
  accepted without spending the one repair; ordinary headings/lists/emphasis and entity-escaped raw
  HTML remain accepted and deterministic.
- All three prompt builders contain the platform rule forbidding model-generated links and images.

**Frozen resolution — prompt audit identity:**

- The existing persisted `promptVersion` string becomes an unambiguous final-generator identity in
  the form `<promptType>@<version>`.
- A valid first response records aggregate or synthesis identity as appropriate. A successful repair
  records the repair identity because that prompt produced the persisted final content. Empty-source
  metadata records the aggregate identity as the configured non-invoked generation contract.
- Usage accounting remains the sum of every provider call; this change does not add a provider call
  or expose prompt bodies.

**Audit RED tests:**

- Single-chunk output records the aggregate identity; repaired single-chunk output records repair.
- Multi-chunk final output records synthesis; repaired synthesis records repair.
- Existing token/cost aggregation assertions remain unchanged.

**GREEN implementation:**

- Branch on the existing claim disposition immediately after each successful claim.
- Make Markdown normalization nullable through a small deterministic unsafe-construct scanner. Scan
  link/image syntax from each unescaped opening bracket to its balanced closing bracket rather than
  rejecting every raw `](` pair, and recognize reference definitions after block-quote/list container
  prefixes. Fail strict parsing before the Zod result is returned.
- Pass prompt type and version into validated generation and project the final generator identity
  into aggregation metadata.
- Add the matching output rule to the three versioned prompts and increment their versions because
  their platform contract changes.

**Focused gate:**

```bash
pnpm --filter @intexuraos/message-digest-service exec vitest run \
  src/domain/usecases/processMessageDigestRun.test.ts \
  src/domain/usecases/dispatchMessageDigestOutbox.test.ts \
  src/infra/llm/messageDigestAggregator.test.ts
pnpm exec vitest run \
  packages/llm-prompts/src/message-digest/__tests__/messageDigestPrompt.test.ts
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/llm-prompts typecheck
pnpm --filter @intexuraos/message-digest-service lint:local
git diff --check
```

## Task 8: Repeat the bounded backend review gate

Run `pnpm run verify:workspace:tracked message-digest-service` once after Task 7. Do not repeat the
already-green WhatsApp workspace because Task 7 does not touch it. Request one final independent
read-only review restricted to Task 7 and its interaction with the previously green backend. Proceed
to the Web plan only with no unresolved Critical or Important finding. Do not commit and do not run
full tracked CI.
