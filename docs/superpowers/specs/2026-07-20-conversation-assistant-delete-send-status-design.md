# Conversation Assistant Delete And Send Status Design

## Goal

Give Web and PWA users a safe, consistent way to delete a Conversation Assistant analysis and make the composer describe the real phase of a streamed turn instead of showing `Sending` for the entire model response.

## Scope

- Delete one Conversation Assistant analysis from the list or the open-session header.
- Require explicit confirmation; do not archive and do not delete on the first click.
- Delete the assistant session, turns, transcript chunks, and frozen-context chunks without deleting the source WhatsApp chat or its messages.
- Separate message submission from assistant waiting and streaming states.
- Keep Web and PWA behavior consistent through the shared responsive web application.

## Delete Experience

- Every analysis row has an always-available overflow action with a minimum 44-by-44-pixel touch target. The open-session header exposes the same action next to export.
- `Delete analysis` opens a confirmation dialog naming the analysis and explaining that the action removes the frozen analysis, questions, and answers but leaves the original WhatsApp conversation unchanged.
- The dialog has `Cancel` and destructive `Delete analysis` actions. While the request is in flight, only the destructive action shows `Deleting…` and duplicate submission is blocked.
- Success removes the item from the list. When deletion starts from the detail page, success navigates back to the analysis list. A short success notification confirms completion.
- A failure before deletion starts leaves the analysis visible and keeps the dialog actionable with an inline error. If cleanup stops after deletion starts, the list and detail switch to a non-openable `Deletion interrupted` tombstone whose only analysis action is `Finish deletion`.
- Deleting an absent or not-owned session is a successful no-op. This keeps retries idempotent without exposing whether another user owns the identifier.
- The dialog snapshots the analysis id, title, and deletion token when it opens. A recreated analysis with the same deterministic id therefore cannot replace the generation the user confirmed.

## Send And Response Experience

The frontend uses an explicit phase: `idle`, `submitting`, `waiting`, or `streaming`.

- `submitting`: the request has started but no `user_turn` acknowledgement has arrived. The submit button shows `Sending…`; the draft is preserved.
- `waiting`: the `user_turn` acknowledgement has arrived. The draft clears, the normal user bubble appears, and a conversation-level assistant placeholder shows `Assistant is thinking…`. The button no longer claims the message is sending.
- `streaming`: the first `assistant_delta` has arrived. The placeholder becomes the live assistant bubble and exposes a subtle `Responding…` label while text grows.
- `idle`: the final assistant turn or terminal error has arrived and the stream has closed. No progress copy remains.
- While waiting or streaming, the textarea remains editable so the user can draft the next question, but submitting another turn remains disabled until the current response finishes.
- A failure before `user_turn` preserves the draft and reports that the message was not sent. A failure after `user_turn` keeps the user bubble and renders the persisted assistant error without returning to `Sending…`.

## Backend Deletion

Deletion is authenticated, ownership-scoped, and fenced to one session generation by a server-issued deletion token derived from immutable generation metadata. The repository first writes a deletion marker, then cleans assistant turns, transcript chunks, and context chunks in bounded queries with one revalidation-and-delete transaction per document before removing the session marker. Interrupted cleanup is safe to retry with the same token. A stale token is an idempotent no-op and cannot delete a recreated generation with the same deterministic id. Background preparation and response work use exact generation checks, cannot recreate a deleted session, and cannot remove data belonging to a replacement generation.

## Endpoint Changes

### Created

`DELETE /conversation-assistant/sessions/:sessionId`

- Required header: `x-conversation-assistant-deletion-token`, using the token returned with that exact public session snapshot.
- Success: HTTP 200 envelope with `{ "deleted": true }`.
- Missing or not owned: the same HTTP 200 `{ "deleted": true }` no-op response, without exposing ownership.
- Internal failure: existing Conversation Assistant error envelope.

### Modified

- Public list and detail session DTOs expose `deletionToken` and `deletionPending` while keeping internal generation and deletion-marker fields private.
- Stream completion is accepted only after `done`; an acknowledged user turn additionally requires a persisted `assistant_turn`, including persisted model-error turns.

### Removed

No endpoint is removed.

### Unchanged

- `POST /conversation-assistant/sessions`
- `POST /conversation-assistant/sessions/:sessionId/turns`
- `POST /conversation-assistant/sessions/:sessionId/turns/stream`
- Existing list, detail, context, retry, turns, and export endpoints

## Verification

- Domain, repository, route, API-client, hook, and page tests are written before implementation and prove ownership, cascade cleanup, idempotent UI behavior, responsive action access, confirmation, navigation, and every send phase transition.
- Live Chrome verification uses MiniMax and `Test Number (WA)` on desktop Web and a PWA-sized responsive viewport.
- Two UX review rounds follow the core implementation. Each round must result in at least two implemented UX improvements and a live retest.
- Subagents are used only for review, never implementation.
- Finalization requires `pnpm run ci:tracked`, commit, rebase on `origin/development`, a second successful `pnpm run ci:tracked`, push, PR to `development` without a manual Linear ID, green GitHub Actions, merge, successful Hetzner production deployment, and production verification.

## Non-Goals

- Archiving analyses.
- Bulk deletion.
- Swipe-to-delete.
- Deleting source WhatsApp chats or messages.
- Parallel assistant turns or stream cancellation.
