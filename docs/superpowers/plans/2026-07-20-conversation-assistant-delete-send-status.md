# Conversation Assistant Delete And Send Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents may review completed work only.

**Goal:** Add safe single-analysis deletion to Conversation Assistant on Web/PWA and replace the monolithic sending flag with accurate submission, waiting, and streaming phases.

**Architecture:** Add one ownership-scoped deletion use case and repository cascade behind a new authenticated DELETE route. The shared React hook owns deletion state and a four-phase turn state machine; responsive page components expose confirmation and conversation-level progress without separate PWA behavior.

**Tech Stack:** TypeScript, Fastify, Firestore, React 19, React Router, TailwindCSS, Vitest, Testing Library.

## Global Constraints

- No archive, bulk delete, swipe delete, source WhatsApp deletion, parallel turns, or stream cancellation.
- First delete interaction opens confirmation; permanent deletion requires the second explicit action.
- Web and PWA share behavior; interactive targets are at least 44 by 44 pixels.
- Use test-first development and preserve strict TypeScript settings.
- The user turn acknowledgement ends `submitting`; model work is represented by `waiting` and `streaming` in the conversation.
- Subagents perform review only.
- Make one final feature commit after the complete `pnpm run ci:tracked` gate.

---

### Task 1: Backend deletion contract and cascade

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Test: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Test: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`
- Test: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Test support: `apps/whatsapp-service/src/__tests__/fakes.ts`

**Interfaces:**
- Repository produces `deleteSession(input: { sessionId: string; userId: string; deletionToken: string }): Promise<void>` and changes nothing for a missing, not-owned, or different-generation session.
- Repository produces conditional turn persistence so work completing after deletion cannot recreate the session or leave orphan turns.
- Domain produces `deleteConversationAssistantSession(input, deps): Promise<ConversationAssistantResult<{ deleted: true }>>`.
- HTTP produces `DELETE /conversation-assistant/sessions/:sessionId`, requires `x-conversation-assistant-deletion-token`, and returns `{ deleted: true }`.

- [x] Write failing domain tests proving owned, missing, not-owned, and stale-generation deletion all return idempotent success while only the exact owned generation changes.
- [x] Run the focused domain tests and confirm the new tests fail before implementation.
- [x] Add the repository port and ownership- and generation-scoped domain use case.

```ts
export interface DeleteConversationAssistantSessionInput {
  userId: string;
  sessionId: string;
  deletionToken: string;
}

export async function deleteConversationAssistantSession(
  input: DeleteConversationAssistantSessionInput,
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<{ deleted: true }>> {
  await deps.repository.deleteSession(input);
  return ok({ deleted: true });
}
```

- [x] Write repository race and cleanup tests for session, turn, transcript, context, interrupted deletion, recreated generations, stale claims, and payload-bounded transactions.
- [x] Implement deletion markers, bounded queries, per-document transactional revalidation, exact generation fencing, and safe retry cleanup.
- [x] Run the repository and domain tests and confirm they pass.
- [x] Write route and OpenAPI tests for auth, token validation, ownership, success envelope, dependency failure, and contract registration.
- [x] Register the DELETE route with the standard request, auth, error, and response conventions.
- [x] Run the focused backend tests and confirm they pass.

### Task 2: Web deletion API, hook state, and responsive UI

**Files:**
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantListPage.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantSessionPage.tsx`
- Create: `apps/web/src/components/whatsapp/ConversationAssistantDeleteDialog.tsx`
- Test: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Test: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Test: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantSeparatedPages.test.tsx`

**Interfaces:**
- API produces `deleteConversationAssistantSession(accessToken, sessionId, deletionToken): Promise<void>`.
- Hook produces `deletingSessionId`, `deleteSession(sessionId, capturedDeletionToken)`, tombstone reconciliation, and deletion error/reset state.
- Dialog consumes session title, request state, error, cancel, and confirm callbacks.

- [x] Write a failing API-client test proving DELETE uses the encoded path, bearer authentication, and captured generation token.
- [x] Implement the API function and make the test pass.
- [x] Write hook tests for success, duplicate blocking, failure, tombstone reconciliation, stale refreshes, recreated generations, and detail navigation.
- [x] Implement deletion state independently from loading and streaming state.
- [x] Write page tests for list/detail actions, confirmation, cancellation, progress, retry, tombstones, exact-generation snapshots, keyboard access, and touch targets.
- [x] Implement the shared dialog, snapshot actions, non-openable tombstones, and sibling navigation/action controls.
- [x] Run the focused Web deletion tests and confirm they pass.

### Task 3: Accurate streamed-turn phase model

**Files:**
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantSessionPage.tsx`
- Test: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Test: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantSeparatedPages.test.tsx`

**Interfaces:**
- Hook replaces public `sending: boolean` with `turnPhase: 'idle' | 'submitting' | 'waiting' | 'streaming'` and derives duplicate-send protection internally.
- Composer consumes `turnPhase`; textarea disabling and submit disabling are separate decisions.

- [x] Write failing hook tests for all phases, acknowledgement-aware draft handling, terminal stream completeness, reconciliation, and stale-session isolation.
- [x] Implement phase transitions in stream events and every reset/finally path.
- [x] Write page tests proving phase-accurate labels, editable next draft, disabled duplicate submit, and accessible live status.
- [x] Update the composer and timeline with conversation-level thinking and streaming feedback.
- [x] Run the focused stream and page tests and confirm they pass.

### Task 4: Automated verification and two live UX rounds

**Files:**
- Modify only files justified by issues found during the two UX rounds.
- Update relevant tests before each behavioral correction.

- [ ] Run `pnpm run verify:workspace:tracked -- whatsapp-service` and fix every failure.
- [ ] Run `pnpm run verify:workspace:tracked -- web` and fix every failure.
- [ ] Start the local stack only when Chrome verification is ready.
- [ ] In Chrome desktop, use MiniMax and `Test Number (WA)` to create/open an analysis, send a turn through every phase, delete from detail, and delete from the list.
- [ ] In Chrome at PWA viewport size, repeat the overflow, dialog, typing-during-response, and deletion flows.
- [x] UX round 1: add deletion success feedback, explicit WhatsApp-data safety copy, keyboard dismissal/focus restoration, and responsive compact list navigation.
- [x] UX round 2: add mobile metadata prioritization, two-line titles, 48-pixel composer controls, accurate recovery feedback, and repeated live-status announcements.
- [ ] Stop local processes after live verification.

### Task 5: Review, CI, PR, merge, and production

**Files:**
- Review the full branch diff and update only accepted-scope files.

- [ ] Dispatch subagents only for UX and code review; inspect every finding and implement only evidence-backed fixes with tests.
- [ ] Run `pnpm run ci:tracked` and require complete success.
- [ ] Stage intended files and commit once with `feat: add conversation assistant deletion and turn status`.
- [ ] Fetch and rebase on latest `origin/development`; rerun `pnpm run ci:tracked` to complete success.
- [ ] Push the feature branch and open a PR to `development` with the `$commit-push` Linear omission note.
- [ ] Watch all GitHub Actions, resolve failures, enable merge, and verify the exact merge SHA lands in `development`.
- [ ] Watch the production Hetzner deployment for that merge SHA and verify build publication, PM2 online state, nginx validation, and successful workflow conclusion.
