# WhatsApp Message Digests — Pending Recovery Precedence Remediation

**Status:** Complete — 177/177 focused tests, Web typecheck, scoped ESLint, `git diff --check`, and
repeat read-only UX review are green with no Critical or Important finding.

> **Execution:** Primary agent only. Follow `superpowers:systematic-debugging`,
> `superpowers:test-driven-development`, and `superpowers:executing-plans`. Review agents remain
> read-only.

## Goal

Prevent the UI from preparing or displaying a new Message Digest window while an exact persisted
run request still requires recovery. The preview shown to the user must always match the request and
preparation token that confirmation can use.

## Root cause and fixed contract

After a failed automatic recovery, Cancel closes the dialog but intentionally retains the durable
session recovery request. A later “Run now” currently calls `prepareRun`, showing a fresh window,
while `confirmRun` still prioritizes the old stored request/token. This can make the confirmation UI
describe a different window than the one being recovered.

Whenever `pendingRunRecoveryDefinitionId` matches the current definition:

1. direct “Run now” retries `recoverPendingRun` and never calls `prepareRun`;
2. routed `openRun` intent defers to the automatic recovery effect and never calls `prepareRun`;
3. Cancel may close the dialog and clear transient copy, but it does not downgrade pending recovery
   into a new preview flow;
4. after recovery is genuinely cleared by the command hook, ordinary prepare behavior resumes.

Because the browser stores exactly one recovery envelope, a pending request also fences every other
definition. A list action or direct/routed detail for definition B must not prepare or confirm while
definition A is pending. The UI must state why and provide a link to recover A; only A may invoke
recovery until the envelope is cleared.

The command boundary enforces the same invariant independently of its callers. While A is pending,
`prepareRun(A)`, `confirmRun(A)`, every run command for B, and `recoverPendingRun(B)` fail closed
without changing the envelope; only `recoverPendingRun(A)` may reach the API. This prevents a fresh
same-definition preview from being paired with A's older stored token.

Deleting A is also fenced while A needs recovery. Otherwise a transient recovery failure followed
by deletion would leave the global envelope pointing at a definition that can no longer load,
blocking all future runs for the browser session. The list menu, its page-level handler, direct and
routed detail intents, and the detail Delete button must all enforce this fence with a visible
reason. Deleting B while A is pending remains available because it cannot orphan A's envelope.

## Files and RED → GREEN

- `apps/web/src/pages/WhatsAppMessageDigestDetailPage.tsx`
- `apps/web/src/pages/WhatsAppMessageDigestsPage.tsx`
- `apps/web/src/components/message-digests/MessageDigestList.tsx`
- `apps/web/src/components/message-digests/MessageDigestActionsMenu.tsx`
- `apps/web/src/hooks/useMessageDigests.ts`
- `apps/web/src/pages/__tests__/MessageDigestDetailPage.test.tsx`
- `apps/web/src/pages/__tests__/MessageDigestsPages.test.tsx`
- `apps/web/src/components/message-digests/__tests__/MessageDigestList.test.tsx`
- `apps/web/src/hooks/__tests__/useMessageDigests.test.ts`
- this plan and active GOAL evidence

1. Add a regression test: pending recovery fails → dialog opens → Cancel → Run now. Assert recovery
   is called again, preparation is never called, and the recovery dialog returns.
2. Add a routed pending-recovery assertion if needed to prove `openRun` also cannot prepare.
3. Observe RED on the direct sequence.
4. Make both direct and routed Run entry points give pending recovery precedence. Keep the shared
   current-source/readiness guard from the preceding remediation.
5. Add `A pending → Run B` tests for list and routed detail. Assert B is visibly disabled, no prepare
   or recovery is called for B, and a recovery link points to A without exposing private data.
6. Add command-boundary tests proving `prepareRun(B)`, `confirmRun(B)`, and
   `recoverPendingRun(B)` fail closed when the stored envelope belongs to A. They must not call an
   API, remove or overwrite A's request ID/token, or change the pending definition to B. Keep
   malformed and prior-account envelope cleanup unchanged. Make the private envelope writer refuse
   a different-definition overwrite even if a future caller omits the outer guard.
7. Add same-definition command tests proving pending A blocks `prepareRun(A)` and `confirmRun(A)`
   while still allowing `recoverPendingRun(A)` with the stored token.
8. Add list, page-handler, and direct/routed detail deletion tests. Pending A must visibly disable
   Delete A and never open its dialog; Delete B must remain available. Repeat the guard in the page
   handler so a synthetic callback cannot bypass the menu state.
9. Run the complete list/detail/page/hook suites, Web typecheck, scoped ESLint, and `git diff --check`; request
   one final read-only UX review. No migration/full CI may start while this finding is open.
