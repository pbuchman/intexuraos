# WhatsApp Message Digests — Task 7 Final Review Remediation Plan

> **For the primary agent:** Execute this plan sequentially with
> `superpowers:test-driven-development` and `superpowers:systematic-debugging`. Subagents remain
> read-only reviewers and may be used again only after the primary agent has completed every task.

**Goal:** Resolve all eleven accepted Important findings from the final Task 7 backend,
test-completeness, and UX reviews before any Fishing migration or Mobile Notifications removal work.

**Architecture:** Preserve the single Message Digest service and the existing public API. Freeze the
configured definition name into each new run, harden the additive WhatsApp template envelope at both
producer and consumer boundaries, let an explicit resume atomically release only an unrecoverable
failed pending window, and move definitive scheduler blockers out of the due queue. Web recovery
records remain account-bound and become input-bound without storing private input. UX fixes are
local to the Message Digest surface and reuse the existing components and state.

## Accepted findings and frozen decisions

- The approved template's first body parameter is the configured Digest name, not the generated
  headline. A required `definitionNameSnapshot` is stored on every newly reserved run. The generated
  headline remains part of the immutable result and stable transport artifact and may use its
  existing 200-character limit.
- A `message_digest_v1` event is valid only with `retainMessageText=false`, a non-empty
  `idempotencyKey`, and `important=true`. Both publisher and WhatsApp consumer reject any malformed
  runtime event before reservation or external effect. Legacy non-template events retain existing
  behavior.
- An unrecoverable failed run keeps its exact pending window while the definition is paused. An
  explicit user Resume is the recovery boundary: in the same owner/revision-fenced transaction it
  clears that failed pending reservation without advancing the checkpoint. The next run therefore
  catches up from the unchanged checkpoint. Normal user pause/resume of queued or processing work
  continues to preserve the pending reservation.
- Scheduler source `not_found`, `source_changed`, or a safe source-identity mismatch moves the
  definition to paused `needs_attention` with a source attention code. Delivery
  `mapping_missing|disconnected|delivery_disabled` moves it to paused `needs_attention` with
  `DELIVERY_SETUP_REQUIRED`. Transport/unavailable/invalid-response failures remain deferred. The
  transition uses the existing owner/revision-fenced `updateDefinition` store operation.
- No WhatsApp sender log may contain a full recipient number or normalized E.164 value. A short
  masked hint is sufficient. Provider request bodies still contain the actual recipient as required
  by the Cloud API and are never logged.
- The list action menu keeps ARIA menu semantics and gains Arrow Up/Down plus Home/End roving focus;
  Escape and Tab retain their current close behavior.
- Resume is disabled only for a known current blocker: active generation work, missing/unavailable
  Private WhatsApp, a source-specific attention code, or delivery readiness that is absent,
  unavailable, or non-ready. The menu shows the reason and the page handler repeats the guard.
  Delivery setup may be retried and Resume becomes available when readiness becomes `ready`.
- Create recovery stores only a SHA-256 digest of a stable normalized input, never the input itself.
  Identical input reuses the ambiguous request ID. Changed input performs no API call, clears the old
  recovery record, and explains that the user must check the list and submit once more to explicitly
  start a new request.
- A server-known erasure always wins over an unrelated or stale session record. Recovery rewrites
  the account-bound record for the currently opened deleting definition and never starts another
  logical DELETE.
- Copy Digest reads the rendered Markdown container's visible text instead of deleting punctuation
  with a second Markdown approximation. Literal `_`, `#`, `>`, autolinks, and code content survive.
- The Run confirmation dialog has a `dvh`-bounded scroll container so all controls remain reachable
  at 200% zoom and in short viewports.

## Global constraints

- Work only on `codex/whatsapp-message-digests`; do not commit, deploy, apply migrations, mutate the
  Meta account, use Chrome, or run `pnpm run ci:tracked` in this plan.
- Add and observe one focused RED assertion before each production behavior change. Implement only
  the smallest GREEN behavior, then refactor with the same focused test green.
- Do not modify user-owned untracked files under `docs/superpowers/specs/`.
- Tests, logs, fixtures, and docs use synthetic identifiers and content only; never persist a phone
  number, Auth0 subject, chat ID, prompt, or message body in a new recovery/logging artifact.
- Existing Mobile Notifications and Fishing Assistant behavior is untouched in this plan.

## Sequential tasks

### Task 1: Freeze the definition name and close the template envelope

**Files:**

- `apps/message-digest-service/src/domain/models/messageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.ts`
- `apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.test.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.ts`
- `apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts`
- affected typed run fixtures
- `packages/whatsapp-pubsub-client/src/whatsappSendPublisher.ts`
- `packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts`
- `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

1. Add RED reservation, scheduler, and document tests requiring `definitionNameSnapshot` to equal
   the configured definition name.
2. Replace the formatter's obsolete 81-character-headline failure test with RED coverage proving an
   80-character configured name and 200-character generated headline format successfully; assert
   template parameter 1 is the configured name while the message artifact retains the headline.
3. Add RED publisher and route matrices for missing/blank idempotency and missing/false
   `important`; assert invalid events produce no mapping/preference read, reservation, outbound
   record, or sender call. Keep an ordinary non-template `retainMessageText=false` case independent.
4. Add the required run snapshot to both manual and scheduled builders and the Firestore schema,
   then make the formatter use it. Update typed synthetic fixtures mechanically.
5. Enforce the template-only idempotency/importance rules in publisher validation and
   `parseMessageDigestPresentation`. Do not change legacy event validation or delivery routing.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/domain/usecases/reserveMessageDigestRun.test.ts apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/infra/notification/formatWhatsAppDigest.test.ts packages/whatsapp-pubsub-client/src/__tests__/whatsappSendPublisher.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts
```

### Task 2: Make terminal recovery and scheduler progression durable

**Files:**

- `apps/message-digest-service/src/domain/ports/messageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts`
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.ts`
- `apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.ts`
- `apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts`

1. Add RED store coverage for unrecoverable failure → explicit resume: the definition becomes active,
   the failed pending reservation is cleared, and checkpoint/continuity/next boundary stay unchanged.
   Preserve the existing queued-work pause/resume test unchanged.
2. Add `releaseFailedPendingWindow?: true` to the internal update patch. In the Firestore transaction,
   read the pending run before writes and clear state only when the pre-update definition is paused
   `needs_attention` and the owned pending run is terminal failed. Increment the state revision in
   the same transaction; otherwise preserve pending work.
3. Have the update use case request that recovery only for explicit paused→active Resume. Add an
   end-to-end focused test proving a later reservation covers the unchanged checkpoint rather than
   returning `RUN_IN_PROGRESS`.
4. Add scheduler RED tests that definitive source/readiness blockers call a revision-fenced paused
   `needs_attention` transition, while transient failures remain deferred. Model more than
   `3 × limit` blockers followed by one healthy definition and prove successive fresh ticks drain
   blockers so the healthy definition is eventually reserved.
5. Add `updateDefinition` to scheduler dependencies and implement the frozen classification. A
   revision conflict is safely deferred; no scheduler mutation may overwrite a concurrent user edit.

Focused gate:

```bash
pnpm exec vitest run apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/domain/usecases/updateMessageDigest.test.ts apps/message-digest-service/src/domain/usecases/tickMessageDigestScheduler.test.ts
```

### Task 3: Remove recipient numbers from sender logs

**Files:**

- `apps/whatsapp-service/src/infra/whatsapp/sender.ts`
- `apps/whatsapp-service/src/__tests__/infra/sender.test.ts`

1. Add RED success, provider-error, timeout, network-error, and truncation assertions that serialize
   every logger call and prove neither the full E.164 value nor its normalized form appears.
2. Replace all sender log fields with one masked recipient hint; remove `normalizedPhone` from logs.
   Do not change request payloads, WAMID handling, error classification, or template selection.

Focused gate:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/infra/sender.test.ts
```

### Task 4: Bind Web create and erasure recovery to the current intent

**Files:**

- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/hooks/__tests__/useMessageDigests.test.ts`
- `apps/web/src/pages/WhatsAppMessageDigestNewPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestEditorPages.test.tsx`

1. Add RED hook tests for an ambiguous create followed by identical input and changed input.
   Identical input reuses the request ID. The first changed-input submission makes zero create call,
   clears the old record, and returns a safe actionable error; the next explicit submission uses a
   fresh ID. Assert storage contains only version/auth subject/request ID/SHA-256 input digest.
2. Upgrade the create record to version 2 and compute a stable Web Crypto SHA-256 over normalized,
   fixed-order input JSON. Reject/remove malformed, legacy, cross-account, and mismatched records.
3. Add RED erasure recovery for stored definition A plus current deleting definition B with a
   server erasure ID. Assert only GET/resume for B, no initial DELETE, and rewritten storage for B.
4. Prefer the server-known current erasure and replace unrelated storage before starting recovery.
   Preserve same-definition retry and account-switch isolation.
5. Add page-level coverage that the changed-input message is visible and a second explicit submit
   starts the new request without losing the edited form.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/hooks/__tests__/useMessageDigests.test.ts apps/web/src/pages/__tests__/MessageDigestEditorPages.test.tsx apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx
```

### Task 5: Make lifecycle actions truthful and keyboard complete

**Files:**

- `apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`

1. Add RED menu tests for Arrow Down/Up wrapping, Home, End, Enter on each enabled action, Escape
   focus return, and disabled-item skipping. Implement roving focus while retaining existing mouse,
   Tab-close, and focus-restoration behavior.
2. Add RED desktop/mobile tests for Resume disabled reasons covering active generation work,
   source missing/unavailable/source attention, delivery status unavailable, and each non-ready
   delivery status. Prove ready delivery re-enables a delivery-setup Resume.
3. Add a pure shared lifecycle-disabled-reason calculation, display the reason adjacent to the
   disabled menu item, and repeat the same guard in the page handler so synthetic clicks produce
   zero PATCH calls.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/components/message-digests/__tests__/MessageDigestActionsMenu.test.tsx apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx
```

### Task 6: Preserve rendered copy and make confirmation reachable at 200% zoom

**Files:**

- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx`

1. Add RED clipboard coverage containing literal `user_name`, `C#`, `a > b`, inline code, and a GFM
   autolink. Mock the rendered container's visible text and require exact headline + visible-summary
   clipboard output.
2. Read `innerText` from a dedicated rendered-summary ref, with `textContent` only as a compatibility
   fallback. Remove the destructive duplicate Markdown regex.
3. Add a RED responsive contract to the detail page that the Run confirmation uses a
   viewport-bounded scroll region and keeps Cancel/Run reachable. Supply a local
   `contentClassName` with `dvh` max height and vertical scrolling; do not change every unrelated
   modal.

Focused gate:

```bash
pnpm exec vitest run apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx apps/web/src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx
```

### Task 7: Converge and repeat read-only review

1. Run focused Message Digest service coverage and the affected publisher/sender/route/Web suites.
2. Run package typechecks and targeted lint for every changed package.
3. Run tracked workspace gates only for `message-digest-service`, `whatsapp-service`, and `web`,
   followed by package exports, Firestore ownership, service wiring, and `git diff --check`.
4. Ask read-only backend/security, test-completeness, and UX reviewers to inspect only this
   remediation. Accept no unresolved Critical or Important finding.
5. Update the active execution GOAL with exact evidence. Explicitly do not claim migration 128,
   Fishing/Mobile removal, Meta template approval, out-of-window production receipt, full CI, commit,
   deployment, or production verification.

No full CI is permitted in this plan.
