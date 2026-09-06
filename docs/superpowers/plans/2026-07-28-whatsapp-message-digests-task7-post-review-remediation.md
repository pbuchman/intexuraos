# WhatsApp Message Digests — Task 7 Post-review Remediation Plan

> **For the primary agent:** Execute sequentially with test-driven development and systematic
> debugging. Subagents remain read-only reviewers and are not used for implementation.

**Goal:** Close every Critical/Important finding from the final Task 7 review before starting the
Fishing migration or deleting the legacy Mobile Notifications implementation.

**Architecture:** A Message Digest WhatsApp event carries an explicit, non-secret delivery identity.
Before whatsapp-service reserves an outbound receipt or calls Meta, it must acquire a short durable
authorization lease from message-digest-service. Erasure changes the definition to `deleting`
before cleanup, refuses every later authorization, and waits for an already acquired delivery lease
alongside generation and dispatch leases. The Cloud API request has a 30-second deadline while the
authorization lease is longer; whatsapp-service releases the lease on every resolved path and an
unreleased lease expires safely. Resume validates the complete frozen Private WhatsApp identity.
Web uses one shared lifecycle guard and distinguishes source identity failures from a recoverable
`SOURCE_TOO_LARGE` generation failure.

## Accepted findings and frozen decisions

- A Pub/Sub message published before DELETE must never create a new provider send after deletion has
  quiesced or completed. A read-only status check is insufficient because DELETE may race it; use a
  durable owner/fence authorization lease that erasure observes.
- The authorization identity is `userId + definitionId + runId + idempotencyKey`. The public
  WhatsApp event adds a strict `message_digest_delivery_v1` authorization object containing only
  `definitionId` and `runId`; it contains no token, phone number, prompt, or message content. The
  existing internal-auth token authenticates service-to-service acquire/release calls.
- Message Digest template events require the authorization object and require its run ID to match
  both the URL suffix and `message-digest:<runId>` idempotency key. Ordinary WhatsApp events remain
  unchanged.
- whatsapp-service acquires authorization after mapping/preferences preflight and immediately before
  its outbound receipt reservation. Authorization unavailable/busy returns retryable 503 with zero
  reservation and zero sender calls; erased/missing/mismatched work is acknowledged and dropped.
- The authorization lease is stored only on the owning run document with owner digest, monotonic
  fence, expiry, and renewal timestamp. Existing run documents parse it as `null`. It is never
  projected through the public Message Digest API.
- Erasure's `quiescing` stage waits for active generation leases, dispatch claims, and delivery
  authorization leases. It still deletes the run and its authorization field in the normal run
  stage; no new collection or feature flag is introduced.
- Resume validates `expectedGenerationId` and compares source account, generation, chat ID, and chat
  type with the frozen source. Any mismatch is `SOURCE_CHANGED`; delivery readiness and the write are
  not attempted.
- `SOURCE_NOT_FOUND`, `SOURCE_UNAVAILABLE`, and `SOURCE_CHANGED` block Resume. `SOURCE_TOO_LARGE` is
  a terminal generation failure whose explicit Resume releases the failed pending window and is not
  classified as missing source identity.
- Sender logs never include provider response text or exception messages. They retain only safe
  status/error-class metadata and the masked recipient hint; returned errors also use stable safe
  messages.
- Detail, list, desktop, and mobile use the same lifecycle helper and the same source/readiness
  context. Handler guards repeat the rendered disabled decision.
- Run-retry and deletion dialogs use the same `dvh`-bounded scrolling contract as Run confirmation.
  Delete Cancel/Escape restores focus to the local Delete trigger, or to the detail heading for a
  routed-open flow.

## Global constraints

- Work only on `codex/whatsapp-message-digests`; do not commit, deploy, apply migration 128, mutate
  Meta, use Chrome, or run `pnpm run ci:tracked` in this plan.
- Add and observe one focused RED assertion before each production behavior change. Make the
  smallest GREEN change, then refactor only while the focused test stays green.
- Do not modify or stage user-owned untracked files under `docs/superpowers/specs/`.
- Tests and logs use synthetic IDs and numbers only. No authorization artifact may contain message
  content, prompt text, a phone number, or an Auth0 token.
- Existing Mobile Notifications and Fishing Assistant behavior remains untouched in this plan.

## Sequential tasks

### Task 1: Fence delayed WhatsApp delivery against erasure

**Files:**

- `packages/whatsapp-pubsub-client/src/types.ts`
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts`
- `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts`
- `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- `apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.ts` (new)
- `apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts` (new)
- `apps/message-digest-service/src/routes/internalMessageDigestRoutes.ts`
- `apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/ports/messageDigestDeliveryAuthorization.ts` (new)
- `apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.ts` (new)
- `apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.test.ts` (new)
- `apps/whatsapp-service/src/config.ts`
- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/server.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- affected local/Terraform service URL wiring, Firestore indexes, and configuration tests

1. Add RED publisher/formatter tests requiring a strict delivery identity and rejecting missing,
   extra, malformed, URL-mismatched, or idempotency-mismatched identities.
2. Add RED store tests: acquire succeeds only for the owned completed pending-delivery run under an
   active/paused definition; same owner is idempotent; another live owner is busy; expired lease
   increments the fence; deleting/migrating/missing/mismatched work is denied; release is
   owner/fence guarded.
3. Add RED erasure tests proving an active delivery authorization holds `quiescing`, release/expiry
   permits progress, and no authorization can be acquired after erasure starts.
4. Add the nullable internal run-document authorization lease and store operations. Use one
   transaction for every acquire/release decision and the existing definition erasure state as the
   cancellation fence.
5. Add caller-role-protected internal acquire/release routes with exact schemas, content-free logs,
   service-owned clock/TTL, stable non-enumerating denial, and focused auth/schema tests.
6. Add a private internal HTTP client to whatsapp-service and mandatory service URL wiring. Never
   log request bodies or dynamic identifiers.
7. Add RED consumer tests for authorization unavailable, busy, denied, acquired, duplicate receipt,
   terminal preflight, sender success/failure/throw, and release failure. Assert authorization is
   immediately before receipt reservation; every denied/unavailable case makes zero reservation and
   zero sender calls; every resolved acquired path attempts release.
8. Wrap only the Message Digest template lane in acquire/try/finally/release. Preserve all ordinary
   WhatsApp and Matrix-corpus behavior.
9. Add a frozen boundary scenario: create the exact published event, start erasure, then deliver the
   delayed event. Authorization must deny it and the outbound repository and sender remain untouched.

Focused gates:

```bash
pnpm exec vitest run packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/authorizeMessageDigestDelivery.test.ts apps/message-digest-service/src/__tests__/internalMessageDigestRoutes.test.ts
pnpm exec vitest run apps/whatsapp-service/src/infra/http/messageDigestDeliveryAuthorizationClient.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts apps/whatsapp-service/src/config.test.ts apps/whatsapp-service/src/__tests__/services.test.ts
```

### Task 2: Make Resume preserve source identity and prove continuity

**Files:**

- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- `apps/message-digest-service/src/routes/routeErrors.ts`
- `apps/message-digest-service/src/routes/routeErrors.test.ts`
- affected route tests

1. Add RED Resume tests requiring `expectedGenerationId` and exact equality of source account,
   generation, chat ID, and chat type. A downstream `source_changed` or successful-but-mismatched
   projection returns `SOURCE_CHANGED`, with zero readiness calls and zero store writes.
2. Implement the full identity fence. Preserve source display metadata and revision when identity is
   unchanged; source replacement remains governed by its existing no-runs rule.
3. Add one composed RED→GREEN test using the real Firestore store and public update use case:
   unrecoverable `SOURCE_TOO_LARGE` failure → explicit Resume → prepare/reserve. Assert the pending
   window is released, checkpoint is unchanged, the next reservation starts exactly at that
   checkpoint, and no `RUN_IN_PROGRESS` result occurs.
4. Map `SOURCE_CHANGED` through the stable public error boundary without exposing source IDs.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/routes/routeErrors.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
```

### Task 3: Remove provider-controlled text from sender logs

**Files:**

- `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`

1. Add RED provider-4xx and thrown-network-error cases whose text contains both `+E164` and
   normalized digits plus template content. Serialize every logger call and assert none of those
   values appears.
2. Stop logging raw provider bodies and exception messages. Log safe status, response byte count,
   and error class only; return stable safe error messages so downstream logs cannot reintroduce the
   provider-controlled text.
3. Preserve request payload, timeout, WAMID, error code/httpStatus, and recipient hint behavior.

Focused gate:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/infra/sender.test.ts
```

### Task 4: Unify lifecycle truth across list and detail

**Files:**

- `apps/web/src/components/message-digests/messageDigestLifecycle.ts`
- `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx`

1. Add RED pure/list/detail tests proving only the three source identity/availability attention
   codes block Resume while `SOURCE_TOO_LARGE` with a terminal failed run permits exactly one PATCH.
2. Add RED detail tests for queued/processing work and Private WhatsApp loading/missing/unavailable;
   each displays the shared reason and a synthetic action makes zero PATCH calls.
3. Use `useMessageDigestSourceAvailability` and the shared helper on the detail page. Delete the
   duplicate local lifecycle helper and repeat the same decision inside its handler.
4. Keep Pause available whenever no lifecycle request/deletion is pending and do not broaden Run-now
   behavior in this task.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx
```

### Task 5: Keep recovery dialogs reachable and restore focus

**Files:**

- `apps/web/src/components/message-digests/MessageDigestDeleteDialog.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx`

1. Add RED 200%-zoom/short-viewport contracts for Run retry and both deletion states requiring a
   `dvh` maximum, bounded width, vertical scrolling, and reachable first/last actions.
2. Apply the already proven local modal content class; do not modify the global Modal default.
3. Add RED focus tests for direct Delete Cancel/Escape returning to the Delete trigger and routed
   opening returning to the detail heading. Pass an explicit return-focus ref through the dialog;
   use the heading fallback only when no local trigger initiated the flow.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx
```

### Task 6: Converge and repeat read-only review

1. Run focused coverage for message-digest-service and affected publisher/WhatsApp/Web suites.
2. Run typecheck and targeted lint for each changed package.
3. Run tracked workspace gates only for `message-digest-service`, `whatsapp-service`, and `web`, then
   package exports, Firestore ownership, service wiring, and `git diff --check`.
4. Ask read-only backend/security, test-completeness, and UX reviewers to report only unresolved
   Critical/Important findings. Remediate any accepted finding sequentially under a written addendum.
5. Update the active execution GOAL with exact evidence and explicitly leave migration 128,
   Fishing/Mobile removal, Meta approval, full CI, commit, deployment, and production verification
   unclaimed.

No full repository CI is permitted in this plan.
