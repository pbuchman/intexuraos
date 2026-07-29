# WhatsApp Message Digests — Task 7 Review Remediation Plan

> **For the primary agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and
> `superpowers:test-driven-development` to execute every task in order. The primary agent writes all
> tests and implementation. Subagents are read-only reviewers only after the bounded remediation is
> green.

**Goal:** Close every accepted Important finding from the feature-completion backend,
test-completeness, and UX reviews before migration/removal work begins, including reliable
business-initiated WhatsApp delivery outside the 24-hour customer-service window.

**Architecture:** Keep the single Message Digest implementation and existing run/outbox IDs. Harden
the current state machines and public projection in place. Digest delivery uses the existing
`whatsapp.message.send` transport with an additive, frozen `message_digest_v1` approved-template
contract; all other WhatsApp senders retain their current free-form behavior. No feature flag,
fallback digest path, second endpoint, or Mobile Notifications dependency is introduced.

**Authoritative input:**
`docs/superpowers/plans/2026-07-27-whatsapp-message-digests-execution-goal.md`, the completed MVP and
feature-completion plans, and the three Task 7 read-only review reports summarized in the active
session.

## Evidence and frozen decisions

- Meta's current WhatsApp Business Platform documentation states that free-form messages are
  allowed only inside the rolling 24-hour customer-support window; a business-initiated message
  after that window must be a template message. The official Meta Postman collection also documents
  that templates must be created and approved before sending and that Cloud API sends them with
  `type=template`.
  - <https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object>
  - <https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive>
  - <https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text>
- Scheduled and manual Message Digest delivery always uses one approved Utility template,
  `intexuraos_message_digest_v1`, language `en_US`. It is not selected in the UI and is not a feature
  flag.
- The approved template shell is fixed platform copy. Its body has two text variables: digest name
  and a deterministic bounded plain-text excerpt. Its single URL CTA is `View digest`, with a
  dynamic suffix that resolves to the exact canonical run URL. The full immutable digest remains in
  `message-digest-service` and the Web run page.
- Template parameters are bounded before an outbox is frozen. Invalid/oversized delivery formatting
  fails the same run as `DELIVERY_FORMAT_INVALID`; no silent provider truncation is allowed.
- Digest outbound records retain the WAMID, correlation, timestamps, hashes, and idempotent receipt,
  but not digest text. Existing non-digest senders retain current seven-day reply-context behavior.
- Generation failures keep the exact pending window. Retryable failures stay actionable; an
  unrecoverable generation failure atomically pauses the definition and marks it
  `needs_attention`, as required by the execution goal.
- The scheduler drains at most three due-definition pages per tick and returns the remaining cursor.
  This is the bounded MVP production fix. Definitions successfully reserved leave the due page;
  definitions with terminal source/readiness problems are moved to attention by existing lifecycle
  handling, while transient conflicts are retried on the next tick.
- Public deletion recovery exposes only the active erasure request ID while a definition is
  `deleting`. It never exposes source-account, phone, Auth0, or private-message data.
- An erasure ID alone cannot reproduce the original client idempotency key, which is intentionally
  stored only as a one-way digest. Therefore fresh-session recovery uses an additive owner-safe
  `POST /message-digests/erasures/:erasureRequestId/resume`. It advances only an already-existing
  erasure after owner validation. `GET` remains read-only, initial deletion remains the existing
  idempotent `DELETE`, and no raw request key is exposed or persisted server-side.
- The review observation about migration 128 is accepted but belongs to the already-written
  migration/removal phase. That phase must rename the current narrow migration to the single
  comprehensive `128_message-digest-service-indexes.mjs` and cover all service indexes. No migration
  129 will be created here.

## Global execution constraints

- Continue sequentially on `codex/whatsapp-message-digests`; do not use implementation subagents.
- Before every production change, add a focused failing test and observe RED. Implement only the
  smallest behavior needed for GREEN, then refactor with the same focused suite green.
- Use synthetic IDs and content only. Do not print or persist real phone numbers, account IDs,
  chat IDs, message bodies, access tokens, or template credentials.
- Do not commit, deploy, mutate the Meta template account, apply migrations, or run
  `pnpm run ci:tracked` in this plan. Template creation/approval and real out-of-window receipt are
  final-cutover prerequisites in the production verification phase.
- Do not change Mobile Notifications, Fishing Assistant, legacy migration data, production
  Terraform, or unrelated WhatsApp event behavior in this plan.
- A focused command that unexpectedly selects a full workspace suite must be stopped and replaced
  by direct `pnpm exec vitest run ...` paths.

## Contract changes

### Digest definition and source projection

```ts
interface MessageDigestSource {
  // existing identity fields remain private
  messageCount: number;
  participantCount?: number;
  lastActivityAt?: string;
}

interface PublicMessageDigestDefinition {
  // present only while status === 'deleting'
  erasureRequestId: string | null;
}
```

Safe source snapshot metadata is copied from `validateSource` at create time and included in the
owner-only public source summary. It is display-only and never participates in runtime source
identity. Existing records decode with conservative absent values.

### WhatsApp send event

Extend, do not version or replace, `whatsapp.message.send`:

```ts
type WhatsAppSendPresentation =
  | {
      kind: 'message_digest_v1';
      digestName: string;
      digestExcerpt: string;
      runUrlSuffix: string;
    }
  | undefined;

interface SendMessageEvent {
  // existing fields
  presentation?: WhatsAppSendPresentation;
  retainMessageText?: boolean; // default true; Message Digests set false
}
```

The frozen digest event still carries `message` for a stable human-readable transport artifact, but
`whatsapp-service` sends the template whenever `presentation.kind === 'message_digest_v1'` and never
falls back to free-form delivery. It validates mutual exclusion with reply buttons/free-form CTA,
the exact URL suffix grammar, all parameter bounds, and `retainMessageText === false` before the
idempotency reservation.

### Session recovery

Create and erasure request records use versioned, auth-bound JSON:

```ts
interface StoredMessageDigestCreateRequest {
  version: 1;
  authSubject: string;
  requestId: string;
}

interface StoredMessageDigestErasureRequest {
  version: 1;
  authSubject: string;
  definitionId: string;
  requestId: string;
  erasureRequestId: string | null;
}
```

Malformed, legacy unbound, or cross-subject records are erased and never sent to an API. A deleting
definition's public `erasureRequestId` bootstraps `GET`/resume when session storage is absent.

## Sequential TDD tasks

### Task 1: Align validation and owner-safe source projection

**Files:**

- `apps/message-digest-service/src/domain/models/messageDigestDefinition.ts`
- `apps/message-digest-service/src/domain/usecases/createMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- their existing focused tests
- `apps/web/src/types/messageDigests.ts`
- `apps/web/src/components/message-digests/MessageDigestConversationPicker.tsx`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- their existing focused tests

1. Add backend RED cases proving a trimmed 80-character name succeeds and 81 characters fails for
   create, update, document decoding, route schema, and OpenAPI. Change every 100-character constant
   and schema to 80; rerun to GREEN.
2. Add RED create/document/public-projection tests for the safe source snapshot fields from an
   already-validated group and direct chat. Prove `sourceAccountId`, generation, and raw revision
   remain absent from public JSON. Make metadata optional on decoding only for existing records.
3. Add Web RED tests proving picker selection and the selected-source card show message count,
   participant count when available, and relative last activity; verify absent values render honest
   fallback copy and never expose IDs. Extend the selection/public types and implement to GREEN.
4. Add Web boundary tests for 80/81 characters and update the counter/error copy.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/createMessageDigest.test.ts apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts apps/web/src/components/message-digests/__tests__/MessageDigestConversationPicker.test.tsx apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx apps/web/src/pages/__tests__/MessageDigestEditorPages.test.tsx
```

### Task 2: Make create and deletion recovery account-bound and reload-complete

**Files:**

- `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- `apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts`
- `apps/message-digest-service/src/domain/usecases/eraseMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/eraseMessageDigest.test.ts`
- `apps/web/src/services/messageDigestsApi.ts`
- `apps/web/src/services/__tests__/messageDigestsApi.test.ts`
- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/hooks/__tests__/useMessageDigests.test.ts`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/types/messageDigests.ts`

1. Add Web hook RED tests where account B mounts with account A's create record and erasure record.
   Assert no stale create/delete/get call occurs, the stale record is removed, and a new request ID
   is generated only for B's explicit action. Cover malformed and legacy raw create values.
2. Replace raw create storage with `StoredMessageDigestCreateRequest`; add version/auth validation
   shared in behavior (not necessarily one generic parser) with existing run/retry recovery.
3. Add backend RED route tests: owner receives `erasureRequestId` only for a deleting definition;
   active/paused definitions return `null`; another owner receives 404. Implement the public
   projection without exposing any other erasure internals.
4. Add backend RED tests for owner-safe `POST /message-digests/erasures/:erasureRequestId/resume`.
   The use case reads the existing owner-scoped erasure, forwards its stored definition ID and
   request digest into the existing bounded store transition, returns the same public erasure ID,
   and produces indistinguishable 404 for missing/foreign IDs. It never accepts a definition ID or
   idempotency key from the request. Implement this additive endpoint while keeping `GET` read-only.
5. Add API/hook/page RED tests for a fresh session opening a deleting definition with the public
   erasure ID. It must issue `GET`, call the resume endpoint if instructed, poll to completion, and
   never send a second logical initial `DELETE`. Pass the bootstrap ID into the deletion hook and
   persist an auth-bound record with a newly generated local request ID only for compatibility with
   an explicit initial delete action.
6. Add a detail-page RED assertion that a deleting definition displays `Deleting`, not its stale
   list status. Implement the status precedence and rerun to GREEN.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/eraseMessageDigest.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts apps/web/src/services/__tests__/messageDigestsApi.test.ts apps/web/src/hooks/__tests__/useMessageDigests.test.ts apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx
```

### Task 3: Fix list search and form-error UX

**Files:**

- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts`

1. Add fake-timer RED tests proving the visible search input preserves trailing spaces and a
   multiword phrase while typing, sends no URL/API change before 300 ms, then sends one trimmed,
   whitespace-normalized query. Clearing search restores the exact pre-search sort/direction. Browser
   Back/Forward replaces the raw input immediately without a stale debounce write.
2. Keep raw input locally in the page/list boundary and debounce only the canonical URL state.
   Cancel timers on URL navigation/unmount. Maintain `name asc` while a canonical query is active.
3. Add form RED tests for Preview/attempted validation with N invalid fields. Require a visible
   `role=alert` summary `Fix N fields before saving.` and focus on the first invalid control. The
   summary updates or clears after corrections and never claims save success. Save remains disabled
   while the form is invalid, consistent with the execution goal.
4. Implement the validation-attempt summary with one deterministic error ordering and rerun the
   interaction-coverage contract.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx apps/web/src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts
```

### Task 4: Make history polling durable and test the real `SOURCE_CHANGED` action

**Files:**

- `apps/web/src/pages/WhatsAppMessageDigestHistoryPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts`

1. Add fake-timer RED tests for at least two consecutive 2-second refreshes while a run remains
   active, one final refresh that returns terminal state, stop after terminal/unmount, and no overlap
   while refresh is in flight.
2. Implement a cancellable recursive poll loop keyed by definition/filter identity. Announce state
   through one `aria-live=polite` status region without repeating alerts.
3. Add a real run-page RED test for `safeFailureCode=SOURCE_CHANGED`: Retry is visible, confirmation
   names the same run/window, and the request uses the exact definition ID, run ID, and stable retry
   request ID. No prepare/reserve/new-run API may be called.
4. Update the interaction-coverage mapping so `SOURCE_CHANGED` points to this Web assertion rather
   than only a backend test. Implement only if the page behavior itself is missing.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx apps/web/src/pages/__tests__/MessageDigestInteractionCoverage.test.ts
```

### Task 5: Enforce failed-run lifecycle and bounded scheduler page draining

**Files:**

- `apps/message-digest-service/src/domain/usecases/messageDigestRetryPolicy.ts` (create if sharing
  policy removes duplication)
- `apps/message-digest-service/src/domain/usecases/processMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.ts`
- their existing focused tests

1. Add RED store/use-case tests for retryable versus unrecoverable generation failures. Both retain
   `pendingWindow`; only unrecoverable failure atomically changes definition status to `paused`,
   `listStatus=needs_attention`, and `attentionCode=<safe code>`. Latest run remains failed. Prove a
   stale fence/erasure epoch changes nothing.
2. Centralize the retryability predicate used by process and retry paths, pass explicit
   `pauseDefinition` intent into `failRun`, and implement the transaction. Do not infer policy from a
   free-form code inside Firestore.
3. Add scheduler RED tests for two and three due pages, exact cursor continuation, cumulative counts,
   recovery running once before due scanning, a fourth-page cursor returned, and no repeated
   candidate. Use a constant `MAX_DUE_PAGES=3` and one frozen `now` across the tick.
4. Implement the bounded loop and remove the duplicate checkpoint guard. Preserve the existing
   request cursor as page one, and return the last unconsumed cursor.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/processMessageDigestRun.test.ts apps/message-digest-service/src/domain/usecases/retryMessageDigestRun.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts
```

### Task 6: Add production-safe digest template delivery and content-minimal receipts

**Files:**

- `packages/whatsapp-pubsub-client/src/types.ts`
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts`
- `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/messageSender.ts`
- `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/outboundMessageRepository.ts`
- `apps/whatsapp-service/src/infra/firestore/outboundMessageRepository.ts`
- focused repository tests/fakes

1. Add publisher/formatter RED tests for the exact additive `message_digest_v1` presentation,
   stable byte-for-byte JSON, `retainMessageText=false`, bounded plain-text excerpt, exact encoded run
   suffix, name/excerpt boundary failure, and unchanged legacy free-form event serialization.
2. Implement deterministic Markdown-to-readable-excerpt normalization in the formatter. Preserve
   full content in the run; never put evidence refs or source IDs into template parameters.
3. Add sender RED tests for an exact Graph API `type=template` body using template name
   `intexuraos_message_digest_v1`, language `en_US`, two ordered body text parameters, and one URL
   button parameter. Cover phone normalization, 2xx WAMID, provider 4xx, 5xx, timeout, and thrown
   network ambiguity under the existing result semantics.
4. Add `sendMessageDigestTemplate` to the sender port/fake and implement it through the existing
   request helper. Do not add an automatic free-form fallback.
5. Add Pub/Sub RED tests rejecting malformed/mutually-exclusive template presentations before
   reservation, selecting the template sender, preserving idempotency digest behavior, and leaving
   every existing text/button/CTA branch unchanged.
6. Add privacy RED tests proving a successful digest receipt has no `messageText` field in both
   ordinary outbound storage and idempotent completion, while non-digest events still retain text.
   Construct the outbound record conditionally from `retainMessageText !== false`.
7. Add a RED transient-preflight test: mapping repository failure happens before idempotency
   reservation and a redelivery can acquire immediately. Refactor the route order to read mapping and
   notification preference first, reserve immediately before the terminal-receipt/provider branch,
   then send exactly once. Concurrent valid deliveries must still have a single reservation winner.

Focused gate:

```bash
pnpm exec vitest run packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts apps/whatsapp-service/src/__tests__/infra/sender.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/whatsapp-service/src/__tests__/infra/outboundMessageRepository.test.ts
```

### Task 7: Focused convergence and repeat review

1. Run only the affected Message Digest backend, package-boundary, WhatsApp, and Web suites. Then run
   their four package typechecks and targeted lint. Fix any failure with a new focused RED case.
2. Run service branch coverage once and require at least 95%; do not run full workspace CI.
3. Run:

```bash
pnpm run verify:workspace:tracked message-digest-service
pnpm run verify:workspace:tracked whatsapp-service
pnpm run verify:workspace:tracked web
pnpm run verify:package-exports
pnpm run verify:firestore
pnpm run verify:service-wiring
git diff --check
```

4. Ask read-only subagents for backend/security/privacy, test-completeness, and UX review of the
   bounded remediation. Accept no Critical or Important finding before marking Task 7 complete.
5. Update the active execution Goal checkpoint with exact focused evidence. Do not claim template
   approval, out-of-window real delivery, migration readiness, full CI, deployment, or production
   completion.

## Acceptance gate

- Every accepted Task 7 Important finding has an executable test and green implementation.
- Digest definitions cannot exceed 80 characters; source snapshots show safe useful metadata.
- Cross-account session recovery cannot call an API with another subject's create/delete identity.
- A fresh session can resume a server-known erasure, and deleting UI is truthful.
- Search preserves typing, debounces canonical requests, and restores sort; validation attempts give
  a counted, focused error summary.
- History continues polling until terminal and stops cleanly; `SOURCE_CHANGED` retries the same run.
- Unrecoverable failed runs pause with their exact window retained; scheduler scans three pages.
- Every digest uses an approved-template event and stores no digest content in WhatsApp outbound
  reply-context records; all non-digest send behavior remains backward-compatible.
- Focused coverage/typecheck/lint/workspace gates are green and repeat reviews report 0 Critical and
  0 Important.
- Migration 128 remains intentionally unmodified until the migration/removal plan, where it becomes
  the one comprehensive service-index migration.
