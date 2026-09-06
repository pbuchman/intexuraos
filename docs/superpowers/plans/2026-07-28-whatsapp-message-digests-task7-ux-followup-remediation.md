# WhatsApp Message Digests — Task 7 UX Follow-up Remediation

> **Execution:** Primary agent only. Follow `superpowers:systematic-debugging`,
> `superpowers:test-driven-development`, and `superpowers:executing-plans`. Review agents remain
> read-only.

## Goal

Close the four remaining Important UX review findings without broadening Task 7. Every Run or
pending-run recovery entry point must consume the same fresh source/readiness lifecycle state,
`SOURCE_TOO_LARGE` copy must describe the action actually available for the definition lifecycle,
and a failed conflict reload must preserve the user's form even when the authoritative GET returns
404.

## Root causes and fixed contracts

1. The list attention copy maps `SOURCE_TOO_LARGE` to a fixed “Resume” instruction even when the
   definition is active and the available action is “Run now”. Copy must be derived from status:
   active tells the user to run again after retained-window pressure changes; paused tells the user
   to resume.
2. The shared Run guard sees only the last source/readiness value. During refresh the hooks retain
   that prior healthy value, so actions can re-enable while the UI simultaneously says it is
   checking. The lifecycle context must carry loading/refreshing state and fail closed until both
   checks settle.
3. Automatic and manual pending-run recovery call the recovery API without the shared current-source
   guard. Recovery must wait for lifecycle checks and use exactly the same disabled reason as Run.
4. `refreshWithResult()` mutates the shared definition to not-found before returning `false`. During
   edit-conflict recovery that replaces the form with Not Found. Conflict reload needs a
   non-destructive refresh mode: adopt a successful authoritative definition, but preserve the prior
   definition/form and conflict state on every failed response, including 404.

## Files in scope

- `apps/web/src/components/message-digests/messageDigestLifecycle.ts`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/MessageDigestDetail.tsx`
- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestEditPage.tsx`
- focused tests under `apps/web/src/components/message-digests/__tests__/`,
  `apps/web/src/hooks/__tests__/`, and `apps/web/src/pages/__tests__/`
- this plan and active GOAL evidence

No API/schema, backend, feature flag, deployment, or production state change is in scope.

## Sequential RED → GREEN tasks

### 1. Lifecycle-aware `SOURCE_TOO_LARGE` copy

1. Extend the list test for an active `SOURCE_TOO_LARGE` definition to assert copy that points to
   “Run now” and does not instruct “Resume”.
2. Add/retain a paused variant that tells the user to Resume.
3. Derive the message from definition status while preserving the retained-window explanation and
   existing attention styling/actions.

### 2. Fail closed while source or delivery state refreshes

1. Extend the lifecycle guard tests with source loading/refreshing and delivery
   loading/refreshing cases; each must return a stable “still checking” disabled reason.
2. Add `isLoading`/`isRefreshing` to the shared lifecycle context and thread the hook state through
   list, detail, routed detail, and Run-dialog entry points.
3. Assert Run remains disabled/closed during a refresh even when the retained prior value is
   `active`/`ready`, then re-enables only after the refresh succeeds.

### 3. Guard pending-run recovery

1. Add detail-page tests proving automatic recovery does not call the API while source/readiness is
   loading or blocked.
2. Add a manual “Retry run recovery” test proving the same guard prevents the API call and presents
   the shared reason.
3. Gate both automatic and manual paths with `currentRunDisabledReason`; trigger automatic recovery
   only after checks settle healthy. Do not create a separate recovery rule.

### 4. Preserve the edit form on every failed conflict reload

1. Add a hook/page regression where conflict reload receives an authoritative 404 that would
   normally set `definition=null`/`isNotFound=true`.
2. Assert the existing form values, conflict banner, and retry action remain visible and no Not Found
   page replaces them.
3. Add a non-destructive option/method to the definition hook that parses and adopts only successful
   GET responses. It may expose the error but must leave the last definition and not-found state
   untouched on failure.
4. Use that method only for conflict reload; ordinary initial/detail refresh keeps current 404
   semantics.

### 5. Focused verification and review

Run only affected tests, Web typecheck, scoped ESLint, and `git diff --check`. Request one fresh
read-only UX review. Task 7 closes only when all backend/test/UX reviews have no unresolved Critical
or Important findings. Do not run workspace coverage/full CI, commit, deploy, or begin migration
until this follow-up is closed.
