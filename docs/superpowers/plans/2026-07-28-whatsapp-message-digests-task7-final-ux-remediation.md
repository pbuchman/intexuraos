# WhatsApp Message Digests — Task 7 Final UX Remediation

> **Execution:** Primary agent only, sequential RED → GREEN. Use
> `superpowers:test-driven-development`, `superpowers:systematic-debugging`, and the existing
> frontend design/testing guidance. Review agents remain read-only.

## Goal

Resolve the final read-only UX review findings without changing the product scope: describe
`SOURCE_TOO_LARGE` as a recoverable saved window, use one current source/delivery guard for every Run
entry point, expose source-status retry on detail, and prevent successful mutations or failed reloads
from leaving a silently stale definition on screen.

## Fixed UX contract

- `SOURCE_NOT_FOUND`, `SOURCE_UNAVAILABLE`, and `SOURCE_CHANGED` are source-identity blockers.
- `SOURCE_TOO_LARGE` is not an unavailable conversation. It pauses the definition while retaining
  the exact failed window; Resume is available when current source and delivery checks are healthy.
- List menu state, list action handler, direct detail button, routed `openRun` intent, and retry paths
  all use the same current guard composed from the persisted definition plus current Private
  WhatsApp availability and primary-delivery readiness.
- A failed Private WhatsApp availability check has an explicit, accessible retry on detail.
- A successful PATCH response is authoritative and updates detail immediately. It is not discarded
  in favor of a fallible follow-up GET.
- A revision-conflict reload clears the conflict only after a successful GET. On failure, the stale
  form remains clearly marked, the conflict action remains available, and an explicit error is
  visible.

## Files in scope

- `apps/web/src/components/message-digests/messageDigestLifecycle.ts`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestEditPage.tsx`
- `apps/web/src/hooks/useMessageDigests.ts`
- their focused list/page/hook tests

No backend, schema, navigation hierarchy, recipient selection, schedule, or migration behavior is in
scope.

## Sequential tasks

### 1. RED: recoverable large-window semantics

Add list and detail assertions that an active `SOURCE_TOO_LARGE` definition:

- never renders “Source conversation needs attention” or “Source unavailable”;
- renders concise recovery copy for the retained run window;
- leaves Run available when the current source and delivery observations are healthy.

Keep the existing paused Resume test and assert the shared guard still permits its single PATCH.

### 2. GREEN: one shared Run guard

Export the exact source-attention predicate and a pure `getMessageDigestRunDisabledReason` from the
lifecycle module. It checks deletion, pause, the three source-identity codes, current source
loading/missing/error, and current delivery loading/error/status. It deliberately does not classify
`SOURCE_TOO_LARGE` as source loss.

Use it in desktop/mobile list menus and in detail. Recompute it inside the list `onRun` handler and
the direct detail handler. The routed detail effect waits for a loaded definition plus active source
and ready delivery before preparing. Add synthetic-handler and routed-intent tests proving no
preparation/navigation occurs while the current source check is blocked.

### 3. RED/GREEN: accessible detail source retry

Add a detail test for an unavailable source check. It must render an alert and `Retry source check`,
invoke `source.refresh` once, show busy copy while refreshing, and never call Run/Resume while
blocked. Implement a compact source-status notice adjacent to the delivery path; for a missing
connection it links to WhatsApp settings, and for an unavailable check it exposes retry.

### 4. RED/GREEN: authoritative successful mutation

Extend `useMessageDigestDefinition` with an `adoptDefinition` callback that cancels an older read,
sets the exact PATCH response, and clears stale read errors/not-found state. Add hook coverage for
the authoritative replacement.

Change detail pause/resume to adopt a non-null PATCH response and perform no follow-up GET. A null
response leaves the old definition visible with an explicit mutation error. Update the existing
deferred lifecycle test to prove the returned revision/status renders immediately and
`definition.refresh` is not called.

### 5. RED/GREEN: honest revision-conflict reload

Add `refreshWithResult(): Promise<boolean>` to the definition hook while keeping the existing
`refresh(): Promise<void>` compatibility wrapper. The result is true only when the current request
commits a fresh definition.

On Edit, do not clear command conflict before reload. A failed reload preserves the conflict panel
and stale keyed form, displays the safe GET error, and leaves the retry button enabled. A successful
reload clears conflict and resets dirty state only after the new definition is committed. Cover both
outcomes.

### 6. Focused verification and review

```bash
pnpm --filter @intexuraos/web test -- src/components/message-digests/__tests__/MessageDigestList.test.tsx src/pages/__tests__/MessageDigestDetailPage.test.tsx src/pages/__tests__/MessageDigestEditorPages.test.tsx src/pages/__tests__/MessageDigestsPages.test.tsx src/hooks/__tests__/useMessageDigests.test.ts
pnpm --filter @intexuraos/web typecheck
pnpm exec eslint apps/web/src/components/message-digests/messageDigestLifecycle.ts apps/web/src/components/message-digests/MessageDigestList.tsx apps/web/src/pages/WhatsAppMessageDigestsPage.tsx apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx apps/web/src/pages/WhatsAppMessageDigestEditPage.tsx apps/web/src/hooks/useMessageDigests.ts apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx apps/web/src/pages/__tests__/MessageDigestEditorPages.test.tsx apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx apps/web/src/hooks/__tests__/useMessageDigests.test.ts
git diff --check
```

Request one final read-only UX review after these gates. Do not run the full Web workspace gate or
full repository CI unless the focused evidence reveals a broader regression.
