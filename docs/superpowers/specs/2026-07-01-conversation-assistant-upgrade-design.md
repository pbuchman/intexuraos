# Conversation Assistant Upgrade Design

## Goal

Upgrade WhatsApp Conversation Assistant so it uses each user's OpenRouter key, runs MiniMax with reasoning enabled, preserves full selected context unless the user confirms a very large range, streams answers into the UI, renders assistant markdown, and keeps the timeline scrolled correctly while respecting manual scrolling.

## Source Requirements

The source objective is `/Users/p.buchman/.codex/attachments/ea3ea4a5-70ce-4582-9cc5-10362d11243c/goal-objective.md`.

The referenced screenshot shows assistant markdown displayed as raw text and ISO timestamp citations visible inside the answer.

## Current State Evidence

- `apps/whatsapp-service/src/services.ts` creates the Conversation Assistant LLM client with `openRouterAppApiKey` while marking usage as `ownerType: 'user'`.
- `apps/whatsapp-service/src/domain/conversation-assistant/types.ts` sets `DEFAULT_CONVERSATION_ASSISTANT_MAX_MESSAGES = 2000`.
- `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts` emits transcript lines as `[2026-06-22T10:00:00.000Z] Speaker: text`.
- `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts` calls `generateChat` synchronously and persists the assistant turn only after the whole response returns.
- `apps/web/src/services/conversationAssistantApi.ts` discards `turns` returned by session creation.
- `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx` renders `turn.text` in a plain `<p>`.
- `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx` has no bottom-follow scroll controller for the turns viewport.

## External API Notes

- OpenRouter documents MiniMax M2.7 at `minimax/minimax-m2.7` with a 1M-token context window: https://openrouter.ai/minimax/minimax-m2.7
- OpenRouter documents `reasoning` and `reasoning_effort` request parameters for thinking-token models: https://openrouter.ai/docs/api/reference/parameters
- OpenRouter chat completions support streaming and non-streaming modes: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request

## Functional Specification

### 1. User API Key

Conversation Assistant must not read or use `INTEXURAOS_OPENROUTER_APP_API_KEY`.

The WhatsApp service will create a `UserServiceClient` using `INTEXURAOS_USER_SERVICE_URL` and `INTEXURAOS_INTERNAL_AUTH_TOKEN`. For each model call it will fetch decrypted user LLM keys through `getApiKeys(userId)`, require `openrouter`, and create an OpenRouter LLM client with that user key.

If the user has no OpenRouter key, the assistant turn will fail with a clear persisted assistant error and the streaming endpoint will return a user-facing error event. There will be no platform or Gemini fallback for Conversation Assistant.

### 2. MiniMax With Thinking

The Conversation Assistant model default will be `or:minimax/minimax-m2.7`.

Each Conversation Assistant model call, both sync fallback and streaming, will pass:

```json
{
  "reasoning": {
    "enabled": true
  }
}
```

The existing `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` override can remain, but every default and test fixture that represents production behavior will move to MiniMax. If the env var is overridden, the code still sends `reasoning.enabled = true`.

### 3. Prompt And Timestamp Output

The prompt version will bump from `1.0.0` to `2.0.0` because behavior changes.

The system prompt will instruct the assistant to:

- answer only from the supplied transcript and prior turns;
- adapt its role and tone to the user's stated need, including psychologist, analyst, and lawyer-style analysis when useful;
- distinguish facts, inference, uncertainty, and missing evidence;
- cite timing only as day and month, for example `15 czerwca` or `June 15`;
- not output raw ISO timestamps, bracketed timestamp IDs, or second-level timestamp citations;
- not invent content, intent, media contents, dates, promises, or advice outside the transcript.

Transcript formatting will stop giving the model bracketed ISO prefixes. Each transcript line will use a date label that is precise enough for user citation but not exact to the second:

```text
[22 June] Alice: hello from private chat
[22 June] You: voice transcript
```

Line order remains chronological, so intra-day sequence is preserved by transcript order instead of exact timestamps.

The prompt range header will also avoid raw ISO timestamps. Instead of `Range: 2026-06-01T00:00:00.000Z to 2026-07-01T00:00:00.000Z`, it will use day/month labels such as `Range: 1 June to 1 July`. No built prompt message should contain a raw ISO timestamp pattern.

### 4. Context Size And 5000 Warning

The 2000-message transcript cap will be removed.

For Conversation Assistant, `projectPrivateConversationContext` will include all text and completed-transcription messages passed to it. `omitted.overLimit` will remain for backward-compatible response shape but will not increase for Conversation Assistant because it will not pass a max-message cutoff. Legacy non-assistant callers may still pass an explicit cap if their endpoint contract requires one.

Session creation will no longer accept or apply `maxMessages` in normal frontend flows. Backend compatibility can ignore the field or reject it only if tests show the public API must be stricter. The required behavior is that `maxMessages` cannot cut context to 2000 or 5000.

Before creating a session, the frontend will call a new check endpoint for the selected chat and date range. If `messageCount > 5000`, the UI shows a nontechnical confirmation warning and does not create the session until the user confirms.

Warning copy intent:

```text
This is a very long conversation list. The assistant can try to analyze it, but it may take longer and may fail if the conversation is too large. Are you sure you want to continue?
```

If the user confirms, the session creation proceeds with the full selected range. There is no application-level truncation to 2000.

### 5. Backend Streaming

Add a streaming turn endpoint. The existing non-streaming turn endpoint can remain for compatibility and tests, but the web UI will use streaming.

Streaming flow:

1. Validate auth, session ownership, and non-empty question.
2. Persist the user turn immediately.
3. Emit a `user_turn` stream event.
4. Start OpenRouter streaming chat completion using the user's key, MiniMax model, and `reasoning.enabled = true`.
5. Emit `assistant_delta` events as content arrives.
6. Accumulate the assistant text server-side.
7. On completion, persist one final assistant turn with full text and usage when available.
8. Update the session `updatedAt` and `lastTurnAt`.
9. Emit `assistant_turn`, then `done`.

If the model fails before producing a final answer, persist one assistant error turn, update session timestamps, emit `error`, emit the persisted `assistant_turn`, and then emit `done`. If partial deltas were already streamed, the persisted assistant turn still becomes the final error state so a refresh matches the stream outcome. The UI can then show the persisted error without requiring a manual refresh.

### 6. Frontend Streaming UX

The hook will expose streaming state and a draft assistant message.

For follow-up:

1. Clear the input as soon as send starts.
2. Add the persisted user turn from the stream.
3. Render an assistant draft as deltas arrive.
4. Replace the draft with the final persisted assistant turn.
5. Refresh the session list after `done` so timestamps and ordering match server state.

For first question:

1. Create the session without sending the question in the create-session request.
2. Select the new session immediately.
3. Send the first question through the same streaming turn endpoint.
4. Render the streamed answer in the newly selected session.

The user must see visible progress while the answer is being generated. The send button and composer state should say `Answering` or equivalent during active streaming.

### 7. Markdown Rendering

Assistant turns will render through the existing `MarkdownContent` component.

User turns remain plain text with whitespace preserved. Error metadata remains separate from markdown content.

Markdown rendering must be safe by default: do not enable raw HTML for assistant output unless the existing component default already strips it. The existing `allowHtml` prop should stay false/undefined for this use.

### 8. Timeline Scroll Behavior

The turns container will own bottom-follow state.

Rules:

- When turns are loaded, a user turn is appended, an assistant draft appears, or assistant deltas stream in, scroll to bottom if follow mode is active.
- Sending a message forces follow mode active.
- If the user scrolls up away from the bottom, follow mode pauses.
- If the user scrolls back near the bottom, follow mode resumes.
- While follow mode is active, replacing a draft with the final assistant turn keeps the viewport anchored at the bottom.

Use a small threshold, for example 64 pixels from bottom, to avoid jitter.

## Endpoint Changes

### Created

`POST /conversation-assistant/context/check`

Request:

```json
{
  "chatId": "chat-id",
  "from": "2026-06-01T00:00:00.000Z",
  "to": "2026-07-01T00:00:00.000Z"
}
```

Response:

```json
{
  "messageCount": 5001,
  "warningThreshold": 5000,
  "requiresConfirmation": true
}
```

`POST /conversation-assistant/sessions/:sessionId/turns/stream`

Transport: `text/event-stream`.

Events:

```text
event: user_turn
data: {"turn":{"id":"whatsapp_conv_turn_user","sessionId":"whatsapp_conv_session_1","userId":"user_1","role":"user","text":"Question text","createdAt":"2026-07-01T10:00:00.000Z"}}

event: assistant_delta
data: {"text":"partial text"}

event: assistant_turn
data: {"turn":{"id":"whatsapp_conv_turn_assistant","sessionId":"whatsapp_conv_session_1","userId":"user_1","role":"assistant","text":"Final answer text","createdAt":"2026-07-01T10:00:05.000Z"}}

event: done
data: {}

event: error
data: {"code":"LLM_ERROR","message":"The assistant could not answer because the model call failed."}
```

### Modified

`POST /conversation-assistant/sessions`

- Still creates a frozen transcript session.
- Frontend no longer sends initial `question` through this endpoint.
- Backend can keep `question` for compatibility, but it must use the updated no-2000 context behavior and user-key model path if invoked.
- Response continues to expose public session and `turns`.

`POST /conversation-assistant/sessions/:sessionId/turns`

- May remain as non-streaming compatibility.
- Must use the updated user-key, MiniMax, reasoning, prompt, and no-ISO timestamp behavior.

### Removed

No endpoint is removed.

### Unchanged

`GET /conversation-assistant/sessions`

`GET /conversation-assistant/sessions/:sessionId`

`GET /conversation-assistant/sessions/:sessionId/turns`

## Non-Functional Requirements

- Follow existing Fastify route patterns, including `logIncomingRequest()` and `requireAuth()`.
- Follow existing service DI in `apps/whatsapp-service/src/services.ts`.
- Use TDD: write failing tests first, confirm they fail, then implement.
- Prompt edit requires a semver bump.
- No new app-level OpenRouter key dependency for Conversation Assistant.
- No direct commits to `main` or `development`.
- No git worktrees.
- Full verification requires `pnpm run verify:workspace:tracked -- web`, relevant package/app verifies, `pnpm run verify:package-exports`, and `pnpm run ci:tracked`.

## Validation Against Requirements

| Requirement | Spec Coverage |
| --- | --- |
| Use user key, not app key | Section 1 removes app key and fetches `openrouter` from user-service per call. |
| Change Gemini Thinking to MiniMax with thinking | Section 2 sets `or:minimax/minimax-m2.7` and sends `reasoning.enabled = true`. |
| Do not output exact timestamps | Section 3 changes prompt and transcript labels away from ISO timestamps. |
| Render markdown in UI | Section 7 uses `MarkdownContent` for assistant turns. |
| Remove 2000 cutoff and warn above 5000 | Section 4 removes cap and adds preflight confirmation above 5000. |
| Prompt adapts role/style | Section 3 adds role adaptation with psychologist, analyst, lawyer examples. |
| Streaming response UX | Sections 5 and 6 define streaming endpoint, events, draft replacement, and final refresh. |
| Scroll to bottom with manual override | Section 8 defines follow mode, pause, resume, and draft replacement anchoring. |
| Validate spec against requirements | This table performs one-to-one validation. |
| Prepare plan, subagent review, implementation, PR, checks, WhatsApp report | This spec preserves those as required downstream process steps. |

## Acceptance Evidence

- Backend unit tests prove user-key creation, no app-key use, reasoning option, MiniMax default, no max-message truncation, context-check behavior, and streaming persistence/events.
- Prompt tests prove version `2.0.0`, role adaptation instructions, no ISO timestamp output instruction, day/month citation instruction, and no built prompt message containing raw ISO timestamps.
- Transcript formatting tests prove transcript lines no longer contain full ISO timestamps.
- OpenRouter client tests prove `reasoning` is forwarded and streaming SSE chunks are parsed.
- Route tests prove `context-check` and streaming route auth, validation, success events, persisted error events, and JSON-before-SSE error behavior.
- Web service tests prove context check and stream parser behavior.
- Hook tests prove first-question streaming, follow-up streaming, duplicate-send protection, >5000 confirmation state, and session-list refresh after `done`.
- Page tests prove markdown rendering and scroll-follow behavior.
- Full repo CI proves workspace-wide correctness.

## Assumptions

- "Mini Max" means OpenRouter `minimax/minimax-m2.7`, exposed internally as `or:minimax/minimax-m2.7`.
- "Thinking enabled" means OpenRouter unified `reasoning.enabled = true`.
- The >5000 threshold applies to raw messages in the selected range, since that is what the user chooses and what the repository can count before projection.
- If the confirmed full transcript exceeds provider limits, the system should fail clearly rather than silently truncate, because the explicit requirement forbids hidden context cutting.
