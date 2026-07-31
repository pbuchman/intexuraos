# WhatsApp Message Digests — MVP Web Review Remediation Plan

> **For the primary agent:** execute this plan sequentially with strict focused RED → minimal GREEN
> → refactor. Implementation subagents are forbidden. Review subagents remain read-only.

**Goal:** Close every accepted Critical/Important finding from the independent MVP Web review before
the first real Chrome/WhatsApp MVP gate, while preserving the already-green backend and Web gates.

**Scope:** Seven accepted Important findings: durable manual-run recovery, durable deletion recovery,
immutable run snapshots, complete truthful list projection, lifecycle-safe actions, complete SPA dirty
navigation protection, and URL-restored list state. Also close three adjacent low-cost accessibility/
truthfulness findings: route-heading focus, invalid-form submit disablement, and list `aria-busy`.
Legacy alias lookup remains in the migration/removal plan and paginated picker completion remains in
the already-written feature-completion plan; neither is required to select the known group/direct
conversation during the local MVP gate.

**Architecture:** Keep the existing endpoints and state machines. Add one backward-compatible
`latestRun` projection to each definition document and update it transactionally whenever the latest
run changes visible state. Persist only the owner-bound manual-run recovery envelope in
`sessionStorage`; replay the same idempotency key and encrypted preparation token after reload.
Mount deletion recovery independently of successful definition reads. Use React Router navigation
blocking and URL search params rather than a second navigation or filter store.

**Constraints:**

- No feature flags, compatibility endpoint, Mobile Notifications source, recipient setting, commit,
  deployment, migration apply, or full `pnpm run ci:tracked` in this plan.
- Never put phone numbers, Auth0 IDs, chat IDs, raw WhatsApp text, source account IDs, or preparation
  token contents in fixtures, logs, screenshots, or plan evidence.
- Preserve owner-safe 404 behavior. Recovery records must be scoped to the current auth subject and
  definition and must be cleared on terminal success, stale token, malformed storage, or auth change.
- Execute tasks in order. After each task, run only its focused tests before continuing.

## Contract additions

### Definition latest-run projection

Add the following nullable, backward-compatible persisted/public projection:

```ts
interface MessageDigestLatestRunProjection {
  runId: string;
  startedAt: string;
  generationStatus: MessageDigestGenerationStatus;
  processingStage: MessageDigestProcessingStage;
  deliveryStatus: MessageDigestDeliveryStatus;
}
```

- New definitions store `latestRun: null`; an older document missing the field parses as `null`.
- Reservation writes `queued/not_sent`; lease acquisition and aggregation/repair stage updates write
  the matching processing state; completion/failure and terminal delivery observation update the same
  projection in the transaction that updates the run.
- A projection update is allowed only when `latestRun.runId` matches the mutated run, preventing an
  older worker from changing a newer list row.
- Public definitions expose `{ id, startedAt, generationStatus, processingStage, deliveryStatus }` or
  `null`; no request digest, lease, source identifier, raw payload, or correlation value is exposed.

### Manual-run recovery envelope

Replace the bare session request ID with a versioned envelope:

```ts
interface StoredMessageDigestRunRequest {
  version: 1;
  authSubject: string;
  definitionId: string;
  requestId: string;
  preparationToken: string;
}
```

The envelope is written immediately before the confirm POST. On reload of the same owned detail,
the command hook replays confirm directly with the same request ID/token. Backend durable lookup
returns the existing run before token validation, so a lost response recovers without a second run;
if the first request never arrived, the still-valid token reserves that same deterministic run.

## Sequential TDD tasks

### Task 1: Make backend/public run snapshots and latest-run projection truthful

**Modify:**

- `apps/message-digest-service/src/domain/models/messageDigestDefinition.ts`
- `apps/message-digest-service/src/infra/firestore/messageDigestDocuments.ts`
- `apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.ts`
- `apps/message-digest-service/src/routes/messageDigestRoutes.ts`
- their existing focused fixtures/tests
- `apps/web/src/types/messageDigests.ts`
- `apps/web/src/pages/WhatsAppMessageDigestHistoryPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestRunPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx`

1. Add RED document tests proving missing `latestRun` parses to `null`, malformed projections fail,
   and no private fields are accepted.
2. Add RED Firestore tests proving reserve → reading → aggregating/repairing → completed/failed →
   delivery terminal transitions update only the matching latest projection atomically.
3. Add RED route tests proving public definitions expose the safe latest projection and public runs
   expose immutable `definitionRevision` from the run record.
4. Implement the schema/model/store/route changes and update synthetic fixtures. Re-run to GREEN.
5. Add Web RED tests proving run detail renders `run.definitionRevision`, while every history and run
   timestamp uses `run.schedule.timeZone`, not the current definition zone. Update the Web type and
   pages; re-run to GREEN.

Focused commands:

```bash
pnpm exec vitest run apps/message-digest-service/src/infra/firestore/messageDigestDocuments.test.ts apps/message-digest-service/src/infra/firestore/firestoreMessageDigestStore.test.ts apps/message-digest-service/src/__tests__/messageDigestRoutes.test.ts
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/web typecheck
```

### Task 2: Recover a confirmed manual run after a lost response or reload

**Modify:**

- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/hooks/__tests__/useMessageDigests.test.ts`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`

1. Add hook RED tests for: envelope written before POST; remount with same auth/definition replays the
   same request ID/token; existing-run response clears storage; transient failure retains recovery;
   stale token clears the envelope and requests explicit re-prepare; malformed/wrong-definition/
   wrong-auth records are discarded; auth switch clears storage.
2. Add page RED tests proving recovered success navigates to the existing run exactly once and focuses
   the run heading; recovery failure remains visible and retryable without opening a fresh window.
3. Implement typed storage helpers and `recoverPendingRun(definitionId)`. Invoke recovery once after
   detail ownership loads, before preparing a new run. Preserve double-click suppression.
4. Re-run focused tests to GREEN and verify storage never logs/renders token contents.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/hooks/__tests__/useMessageDigests.test.ts src/pages/__tests__/MessageDigestDetailPage.test.tsx
```

### Task 3: Mount durable erasure recovery even after the definition disappears

**Modify:**

- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestDeleteDialog.tsx` only if its public props need
  a neutral fallback label
- corresponding detail/delete tests

1. Add RED page tests that seed a stored erasure at `definition`, `legacy`, and `completed`, return
   owner-safe definition 404, and prove GET/resume DELETE continues until terminal completion and
   redirects/focuses the list exactly once.
2. Mount one deletion recovery boundary for every non-empty `definitionId` before loading/not-found/
   error branches. A missing definition must never be interpreted as completed erasure.
3. Keep ordinary foreign/missing 404 neutral when no matching recovery envelope exists.
4. Re-run focused tests to GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestDeleteDialog.test.tsx src/pages/__tests__/MessageDigestDetailPage.test.tsx src/hooks/__tests__/useMessageDigests.test.ts
```

### Task 4: Render the complete truthful list and lifecycle-safe actions

**Modify:**

- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- responsive contract test

1. Add RED list tests for all required desktop/mobile fields: instruction-template label, human
   schedule/zone, last-run local time plus independent generation state, and a truthful next-run value.
   Paused shows `Paused`; delivery attention shows `Needs WhatsApp setup`; source attention shows
   `Source unavailable`; deleting shows `Deletion in progress`; no run shows an explained em dash.
2. Add RED action tests proving `Run now` is disabled with a visible reason for paused,
   needs-attention, source-unavailable, and deleting definitions. On detail, deleting also disables
   Edit and repeat Delete; paused disables Run now before any prepare request.
3. Add a RED accessibility test for `aria-busy=true` on the retained table/card region during
   background refresh and `false` afterward.
4. Implement the smallest list/detail/menu changes. Keep semantic cards through narrow/200%-zoom
   layouts, every action at least 44×44, and no recipient control.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestList.test.tsx src/pages/__tests__/MessageDigestDetailPage.test.tsx src/pages/__tests__/MessageDigestResponsiveContracts.test.tsx
```

### Task 5: Store list filter/sort state in the canonical URL

**Modify:**

- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`

1. Add RED tests starting from valid/invalid search params and exercising search, status,
   conversation type, sort, direction, clear, browser Back, and Forward. Assert API options and
   selected controls are restored from the URL without duplicate requests or stale cursors.
2. Implement a pure parser/serializer around `useSearchParams`. Omit defaults, discard unknown
   values, keep search constrained to `sort=name&direction=asc`, and restore the prior explicit sort
   when search clears during the same navigation history.
3. Use replace for debounced/keystroke search normalization and push for discrete status/type/sort
   actions so Back/Forward is useful. Clear filters returns the canonical path without a query.
4. Re-run focused tests to GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/pages/__tests__/MessageDigestsPages.test.tsx src/hooks/__tests__/useMessageDigests.test.ts
```

### Task 6: Block every dirty SPA exit and close adjacent form/focus gaps

**Create:**

- `apps/web/src/hooks/useUnsavedMessageDigestNavigation.ts`
- focused hook test if page tests cannot prove blocker state directly

**Modify:**

- `apps/web/src/pages/WhatsAppMessageDigestNewPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestEditPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestDefinitionForm.tsx`
- editor/form/detail/history tests

1. Add RED router tests for sidebar navigation, browser Back, local Back, and Cancel from dirty and
   clean create/edit forms. Dirty exits show exactly one confirmation; `Keep editing` resets the
   blocker and restores focus; `Discard changes` proceeds to the originally requested destination.
   Successful submit disarms the blocker before redirect.
2. Implement the shared React Router `useBlocker` wrapper plus existing `beforeunload`; do not use a
   global click interceptor or `window.confirm`.
3. Add RED form tests proving the save/create button is disabled for known-invalid name, source,
   instructions, time zone, or schedule and enabled once valid, independently from server validation.
4. Add RED route tests proving detail → history and confirmed run → run detail transfer focus to the
   destination heading. Implement location intent/focus handling.
5. Re-run focused tests to GREEN.

Focused command:

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestDefinitionForm.test.tsx src/pages/__tests__/MessageDigestEditorPages.test.tsx src/pages/__tests__/MessageDigestDetailPage.test.tsx src/pages/__tests__/MessageDigestHistoryAndRunPages.test.tsx
```

### Task 7: Close remediation gates and repeat read-only review

1. Run all Message Digest backend tests affected by the projection and backend typecheck/coverage.
2. Run the complete focused Web digest suite, Web typecheck, targeted ESLint, Prettier check, and
   `git diff --check`.
3. Run `pnpm run verify:workspace:tracked message-digest-service` and
   `pnpm run verify:workspace:tracked web`; do not run full CI.
4. Give only this bounded remediation diff to one read-only reviewer. Resolve accepted
   Critical/Important findings one at a time with a RED test and repeat only affected gates.
5. Update the active execution GOAL with safe test counts and review result, then proceed to the
   already-running system Chrome MVP gate.

Commands:

```bash
pnpm --filter @intexuraos/message-digest-service test:coverage
pnpm --filter @intexuraos/message-digest-service typecheck
pnpm --filter @intexuraos/web test -- src/services/__tests__/messageDigestsApi.test.ts src/hooks/__tests__/useMessageDigests.test.ts src/components/message-digests/__tests__ src/pages/__tests__/MessageDigest*.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx
pnpm --filter @intexuraos/web typecheck
pnpm exec eslint apps/message-digest-service/src apps/web/src/types/messageDigests.ts apps/web/src/hooks/useMessageDigests.ts apps/web/src/hooks/useUnsavedMessageDigestNavigation.ts apps/web/src/components/message-digests apps/web/src/pages/WhatsAppMessageDigest*.tsx --max-warnings 0
pnpm exec prettier --check apps/message-digest-service/src apps/web/src/types/messageDigests.ts apps/web/src/hooks/useMessageDigests.ts apps/web/src/hooks/useUnsavedMessageDigestNavigation.ts apps/web/src/components/message-digests apps/web/src/pages/WhatsAppMessageDigest*.tsx
pnpm run verify:workspace:tracked message-digest-service
pnpm run verify:workspace:tracked web
git diff --check
```

## Completion gate

This remediation is complete only when all seven Important findings have automated regression proof,
the three included adjacent UX gaps are green, both focused workspace gates pass, and a repeat
read-only review reports no Critical/Important finding in this bounded scope. Then—and only then—run
the local MVP through the already-open system Google Chrome and real WhatsApp account.
