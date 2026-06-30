# WhatsApp Conversation Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web-based WhatsApp Conversation Assistant that lets a user select a private direct WhatsApp chat, freeze a time-bounded text/transcript context, and ask follow-up questions against that context with autosaved sessions.

**Architecture:** `whatsapp-service` owns the WhatsApp Conversation Assistant end to end because the feature analyzes private WhatsApp message context. It owns private message storage access, text/transcription filtering, assistant sessions, autosaved turns, prompt assembly, OpenRouter calls, and authenticated web APIs. Shared LLM packages add a cache-aware OpenRouter chat contract so the stable transcript block can be sent with `session_id` and `cache_control`; the web app consumes only public authenticated WhatsApp Assistant APIs and never receives hidden message-owner fields.

**Tech Stack:** TypeScript strict mode, Fastify, Firestore, React/Vite/Tailwind, `@intexuraos/infra-openrouter`, `@intexuraos/llm-factory`, `@intexuraos/llm-prompts`, OpenRouter Chat Completions, Gemini via OpenRouter, Vitest, `pnpm run ci:tracked`.

**Linear:** [INT-1813](https://linear.app/pbuchman/issue/INT-1813/enable-ai-powered-analysis-of-whatsapp-conversations)
**Plan document:** `docs/plans/INT-1813-whatsapp-conversation-assistant.md`
**External references:** [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [OpenRouter model catalog API](https://openrouter.ai/api/v1/models)

## Ownership Boundary

This is a WhatsApp feature implemented in `whatsapp-service`, not an Intex Agent feature. `whatsapp-service` owns the private WhatsApp storage schema, account ownership checks, message/transcription filtering, media omission rules, assistant sessions, assistant turns, prompt assembly, OpenRouter invocation, and public authenticated Conversation Assistant APIs.

`intex-agent` must not be modified for this MVP. Do not add Conversation Assistant routes, collections, services, prompts, or runtime code under `apps/intex-agent`; existing Intex Agent routes remain unchanged.

## Global Constraints

- MVP supports private WhatsApp direct chats only; group chats must be rejected with `INVALID_REQUEST`.
- Only textual content enters the assistant context: `PrivateWhatsAppMessage.text` and completed `transcription.text` for audio/video messages.
- Images, videos, files, stickers, and media binary/content URLs must not be injected into the prompt; media-only messages are counted as omitted.
- The transcript snapshot is frozen at session creation so continuing a session later uses the same context and preserves prompt-cache stability.
- Users may create multiple assistant sessions for the same contact with different time ranges or different questions.
- Each session autosaves metadata, frozen transcript context, and every user/assistant turn.
- Assistant answers must be factual, critical, and explicitly say when the selected context does not contain enough evidence.
- OpenRouter calls must pass a stable `session_id` no longer than 256 characters and keep the initial stable prompt prefix identical across turns.
- Gemini caching must mark the large transcript content block with `cache_control: { type: 'ephemeral' }`; dynamic user questions must appear after the cached block.
- Use current OpenRouter model `or:google/gemini-3.5-flash`, verified in the OpenRouter model catalog on 2026-06-30, unless the implementation verifies a better current Gemini thinking-capable model before coding.
- All new `PromptBuilder` prompts must include a semver `version` field.
- Every HTTP endpoint must call `logIncomingRequest()`.
- New Firestore collections must be registered in `firestore-collections.json`.
- Firestore migrations are immutable; add new migration files for required composite indexes.
- All new backend/package code must satisfy 100% branch coverage. Any `/* v8 ignore */` exemption must use a valid CLAUDE.md category and name the testing blocker, not merely describe the ignored code.
- Implementation agents must use subagents for the parallel subtasks below.
- Before commit in implementation tasks, `pnpm run ci:tracked` must pass.

---

## Parallel Breakdown

| Subtask | Owner boundary | Independent contract |
| --- | --- | --- |
| Shared LLM package work | `packages/infra-openrouter`, `packages/llm-factory`, `packages/llm-prompts`; `packages/llm-contract` only if shared role/content-block types belong there | Exposes cache-aware chat generation types and `buildWhatsAppConversationAssistantMessages()`. No app code changes are required to verify the package contract. |
| WhatsApp transcript projection | `apps/whatsapp-service` | Adds sanitized transcript projection for a user-owned direct chat and time range. No `intex-agent` or web code changes. |
| WhatsApp assistant runtime | `apps/whatsapp-service` | Creates authenticated session/turn APIs, persists sessions/turns, freezes transcript snapshots, and invokes the cache-aware LLM contract. Can test with fake repositories and fake LLM clients. |
| Web experience | `apps/web` | Adds `/whatsapp/conversation-assistant`, WhatsApp submenu nav entry, session list, chat picker/time-range form, and chat UI against fixed WhatsApp Assistant API DTOs. Can test with mocked service functions. |

No Linear dependencies should be created between subtasks. The contracts in this document are the handoff surface, so each subagent can work independently.

## Endpoint Changes

| Type | Endpoint | Owner | Details |
| --- | --- | --- | --- |
| Created | `POST /whatsapp/conversation-assistant/sessions` | `whatsapp-service` | Authenticated create/freeze context; optional first question starts the first LLM turn. |
| Created | `GET /whatsapp/conversation-assistant/sessions` | `whatsapp-service` | Authenticated list of current user's Conversation Assistant sessions. |
| Created | `GET /whatsapp/conversation-assistant/sessions/:sessionId` | `whatsapp-service` | Authenticated read of one session owned by the current user. |
| Created | `GET /whatsapp/conversation-assistant/sessions/:sessionId/turns` | `whatsapp-service` | Authenticated chronological turn list. |
| Created | `POST /whatsapp/conversation-assistant/sessions/:sessionId/turns` | `whatsapp-service` | Authenticated follow-up question; appends user and assistant turns. |
| Modified | Web route `/whatsapp/conversation-assistant` | `apps/web` | New WhatsApp submenu page. |
| Modified | OpenRouter Chat Completions request body | shared LLM packages | Accepts `messages`, `session_id`, `cache_control`, content blocks, and cache usage metrics. |
| Removed | None | - | No endpoint removal. |
| Unchanged | `GET /private/chats`, `GET /private/chats/:chatId/messages` | `whatsapp-service` | Existing private log API remains read-only and unchanged. |
| Unchanged | Existing Intex Agent routes | `intex-agent` | No Intex Agent files or routes are modified. |

## Shared Contracts

### OpenRouter Chat Contract

Shared package work must produce this application-facing interface:

```typescript
export type LlmChatRole = 'system' | 'developer' | 'user' | 'assistant';

export interface LlmChatTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '1h' };
}

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string | LlmChatTextBlock[];
}

export interface GenerateChatOptions {
  promptType: string;
  sessionId?: string;
  temperature?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  correlation?: {
    sessionId?: string | null;
    requestId?: string | null;
  };
}

export interface GenerateChatResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    cachedTokens?: number;
    cacheWriteTokens?: number;
  };
}
```

`createLlmClient()` must expose `generateChat(messages, options)` alongside the existing `generate(prompt, options)` path. OpenRouter must serialize `sessionId` as top-level `session_id` and preserve content-block `cache_control`.

### WhatsApp Transcript Export Request

```typescript
export interface PrivateConversationContextRequest {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  maxMessages?: number;
}
```

Validation rules:

- `from` and `to` are ISO timestamps; reject `from >= to`.
- `maxMessages` defaults to `2000`, minimum `1`, maximum `5000`.
- The route resolves the user's active private account server-side; callers cannot pass `sourceAccountId`.
- The chat must exist, belong to that account, and have `chatType === 'direct'`.
- The range is inclusive at `from` and exclusive at `to`.

### WhatsApp Transcript Export Response

```typescript
export interface PrivateConversationContextResponse {
  chat: {
    id: string;
    displayName?: string;
    chatType: 'direct';
    firstSeenAt: string;
    lastEventAt: string;
    messageCount: number;
  };
  range: {
    from: string;
    to: string;
  };
  messages: PrivateConversationContextMessage[];
  omitted: {
    mediaOnly: number;
    failedTranscriptions: number;
    pendingTranscriptions: number;
    nonText: number;
    overLimit: number;
  };
  messageCount: number;
  transcriptSha256: string;
}

export interface PrivateConversationContextMessage {
  id: string;
  eventTimestamp: string;
  direction: 'incoming' | 'outgoing';
  speakerLabel: 'You' | string;
  messageType: PrivateWhatsAppMessageType;
  contentKind: 'text' | 'transcription';
  content: string;
}
```

### Conversation Assistant API DTOs

```typescript
export type ConversationAssistantSessionStatus = 'active' | 'archived';

export interface ConversationAssistantSession {
  id: string;
  userId: string;
  chatId: string;
  chatDisplayName?: string;
  status: ConversationAssistantSessionStatus;
  range: { from: string; to: string };
  model: string;
  transcriptSha256: string;
  transcriptMessageCount: number;
  omitted: PrivateConversationContextResponse['omitted'];
  title: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
}

export interface ConversationAssistantTurn {
  id: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  usage?: GenerateChatResult['usage'];
  error?: { code: string; message: string };
}
```

Firestore should persist two new collections owned by `whatsapp-service`:

- `whatsapp_conversation_assistant_sessions`
- `whatsapp_conversation_assistant_turns`

The session document must include the frozen `transcriptText` used for prompts. That field must never be returned in public API responses.

## Prompt Contract

Create `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`.

The prompt builder must return stable message arrays:

```typescript
export const WHATSAPP_CONVERSATION_ASSISTANT_PROMPT = {
  version: '1.0.0',
  promptType: 'whatsapp-conversation-assistant',
} as const;

export function buildWhatsAppConversationAssistantMessages(input: {
  transcriptText: string;
  chatDisplayName?: string;
  range: { from: string; to: string };
  priorTurns: { role: 'user' | 'assistant'; text: string }[];
  question: string;
}): LlmChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text:
            'You are a critical conversation analysis assistant. Answer only from the supplied WhatsApp transcript. Distinguish facts from inference. If evidence is missing, say so directly. Do not invent events, motives, dates, promises, or advice.',
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Conversation: ${input.chatDisplayName ?? 'selected WhatsApp chat'}\nRange: ${input.range.from} to ${input.range.to}\n\nTranscript follows:`,
        },
        {
          type: 'text',
          text: input.transcriptText,
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
    ...input.priorTurns,
    {
      role: 'user',
      content: input.question,
    },
  ];
}
```

Implementation may refine wording, but it must preserve these semantics:

- cached transcript block is stable and appears before all dynamic questions;
- prior turns are appended after the cached transcript block;
- the assistant must cite message dates/times or say evidence is insufficient;
- the assistant must not claim access to omitted media;
- the assistant must not use web search.

## File Structure

### Shared LLM Packages

- Modify `packages/infra-openrouter/src/types.ts` for chat messages, content blocks, `session_id`, and cache usage fields.
- Modify `packages/infra-openrouter/src/client.ts` to add `generateChat()` and preserve `generate()` compatibility.
- Modify `packages/infra-openrouter/src/__tests__/client.test.ts` for `session_id`, `cache_control`, and cache usage parsing.
- Modify `packages/llm-factory/src/llmClientFactory.ts` and `packages/llm-factory/src/openRouterGenerateClient.ts` to expose `generateChat()`.
- Modify `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts` for cache-aware forwarding.
- Modify `packages/llm-contract/src/types.ts` only if shared role/content-block types belong in the contract package.
- Create `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`.
- Create `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`.
- Modify `packages/llm-prompts/src/index.ts` to export the prompt module.

### WhatsApp Service

- Modify `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts` for context DTOs if they live in the domain.
- Create `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`.
- Create `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`.
- Create `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`.
- Create `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`.
- Modify `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppRepository.ts` to add `getChatById()` and `findConversationContextMessages()`.
- Modify `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts` to implement chat lookup and ascending range query.
- Create `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`.
- Modify `apps/whatsapp-service/src/routes/privateReadRoutes.ts` only if shared public serializers are reused.
- Create `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`.
- Modify `apps/whatsapp-service/src/routes/index.ts` to register the new authenticated routes.
- Modify `apps/whatsapp-service/src/services.ts` to wire repository and LLM chat client if the service container owns those dependencies.
- Modify `apps/whatsapp-service/src/config.ts` and `apps/whatsapp-service/src/index.ts` to add `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL`.
- Modify `apps/whatsapp-service/src/__tests__/fakes.ts`.
- Create `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`.
- Create `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`.
- Modify `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts` for range query and chat ownership coverage.
- Create `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`.
- Create `migrations/117_private-whatsapp-conversation-context-index.mjs`.
- Create `migrations/__tests__/117-private-whatsapp-conversation-context-index.test.ts`.
- Create `migrations/118_whatsapp-conversation-assistant-indexes.mjs`.
- Create `migrations/__tests__/118-whatsapp-conversation-assistant-indexes.test.ts`.
- Modify `ecosystem.config.cjs` and `terraform/environments/dev/main.tf` for `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL`.
- Modify `firestore-collections.json`.

### Web App

- Modify `apps/web/src/components/sidebar/navItems.ts` to add WhatsApp item `Conversation Assistant`.
- Modify `apps/web/src/App.tsx` to add lazy route `/whatsapp/conversation-assistant`.
- Modify `apps/web/src/types/index.ts` for session/turn DTOs.
- Create `apps/web/src/services/conversationAssistantApi.ts` or extend `apps/web/src/services/intexAgentApi.ts`.
- Create `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`.
- Create `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`.
- Create `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`.
- Create `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`.
- Create tests in `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`, `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`, and `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`.

---

## Task 1: Shared OpenRouter Cache-Aware Chat Contract

**Files:**
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Modify: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/openRouterGenerateClient.ts`
- Modify: `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts`
- Create: `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`
- Create: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`
- Modify: `packages/llm-prompts/src/index.ts`

**Interfaces:**
- Produces: `LlmChatMessage`, `LlmChatTextBlock`, `GenerateChatOptions`, `GenerateChatResult`
- Produces: `OpenRouterClient.generateChat(messages, options)`
- Produces: `LlmGenerateClient.generateChat(messages, options)`
- Produces: `buildWhatsAppConversationAssistantMessages(input)`

- [ ] **Step 1: Write failing OpenRouter client tests**

Add tests proving `generateChat()` posts `session_id`, preserves content blocks with `cache_control`, and maps `usage.prompt_tokens_details.cached_tokens` and `cache_write_tokens`.

Run:

```bash
pnpm vitest run packages/infra-openrouter/src/__tests__/client.test.ts
```

Expected: FAIL because `generateChat()` and cache usage fields do not exist.

- [ ] **Step 2: Implement OpenRouter chat generation**

Add the shared chat types to `packages/infra-openrouter/src/types.ts`. Implement `generateChat()` in `packages/infra-openrouter/src/client.ts` by reusing the existing timeout, retry, error mapping, usage logging, and OpenRouter headers. The request body must include:

```typescript
const requestBody = {
  model,
  messages,
  temperature: options.temperature ?? 0.2,
  ...(options.sessionId !== undefined ? { session_id: options.sessionId } : {}),
  ...(options.responseFormat !== undefined ? { response_format: options.responseFormat } : {}),
};
```

- [ ] **Step 3: Preserve existing `generate()` behavior**

Keep `generate(prompt, options)` as a wrapper that calls `generateChat([{ role: 'user', content: prompt }], options)` or shares the same lower-level helper. Existing tests for plain prompt generation must remain unchanged.

- [ ] **Step 4: Extend `llm-factory`**

Add optional `generateChat()` to `LlmGenerateClient`, implement it in `createOpenRouterGenerateClient()`, and throw `IntexuraOSError('INVALID_REQUEST', 'Chat message generation is only supported for OpenRouter clients')` for non-OpenRouter factory clients if a caller invokes the optional method.

- [ ] **Step 5: Add prompt builder tests and the Conversation Assistant prompt builder**

Create tests that prove:

- the cached transcript block is placed before prior turns and the current question;
- prior user/assistant turns are appended after the cached transcript block;
- the system message contains the no-invention, evidence-missing, no-web-search, and no-omitted-media instructions;
- `cache_control` is set only on the transcript block;
- the prompt metadata includes semver `version: '1.0.0'`.

Then create `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts` with semver prompt metadata, stable transcript content block, and strict factuality instructions from the Prompt Contract.

- [ ] **Step 6: Verify package tests**

Run:

```bash
pnpm vitest run packages/infra-openrouter/src/__tests__/client.test.ts packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts
```

Expected: PASS.

## Task 2: WhatsApp Private Conversation Transcript Projection

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/infra/firestore/privateWhatsAppRepository.ts`
- Modify: `apps/whatsapp-service/src/__tests__/fakes.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/infra/privateWhatsAppRepository.test.ts`
- Create: `migrations/117_private-whatsapp-conversation-context-index.mjs`
- Create: `migrations/__tests__/117-private-whatsapp-conversation-context-index.test.ts`

**Interfaces:**
- Consumes: `PrivateConversationContextRequest`
- Produces: `PrivateConversationContextResponse`
- Produces repository methods:

```typescript
getChatById(input: {
  sourceAccountId: string;
  chatId: string;
}): Promise<Result<PrivateWhatsAppChat | null, WhatsAppError>>;

findConversationContextMessages(input: {
  sourceAccountId: string;
  chatId: string;
  from: string;
  to: string;
  limit: number;
}): Promise<Result<PrivateWhatsAppMessage[], WhatsAppError>>;
```

- [ ] **Step 1: Write failing transcript projection tests**

Cover text-only transcript output, completed transcription output, pending/failed transcription omission counts, media-only omission counts, non-text omission counts, over-limit counts, stable normalized transcript text, `transcriptSha256`, speaker labels, and no raw Matrix/media fields in the projected response.

Run:

```bash
pnpm vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts
```

Expected: FAIL because the projector does not exist.

- [ ] **Step 2: Add repository methods and tests**

Implement `getChatById()` by document id and source account verification. Implement `findConversationContextMessages()` with:

```typescript
collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
  .where('sourceAccountId', '==', input.sourceAccountId)
  .where('chatId', '==', input.chatId)
  .where('eventTimestamp', '>=', input.from)
  .where('eventTimestamp', '<', input.to)
  .orderBy('eventTimestamp', 'asc')
  .orderBy(FieldPath.documentId(), 'asc')
  .limit(input.limit + 1)
```

Return `limit + 1` internally so the route can report `omitted.overLimit`.

- [ ] **Step 3: Implement transcript projection**

Build a pure projector that emits `PrivateConversationContextMessage[]`:

- include `message.text.trim()` when non-empty;
- include `message.transcription.text.trim()` only when transcription status is `completed`;
- set speaker label to `You` for outgoing messages;
- use sender display/phone/key for incoming speaker labels;
- count pending/failed transcriptions and media-only/non-text omissions;
- compute `transcriptSha256` from the normalized prompt transcript text, not raw message JSON.

- [ ] **Step 4: Expose projector to the WhatsApp assistant runtime**

Keep transcript projection inside `whatsapp-service`; no internal export route or Intex Agent client is required for this MVP. Route-level auth, empty-transcript handling, and HTTP error mapping are covered in Task 3.

- [ ] **Step 5: Add Firestore index migration**

Create `migrations/117_private-whatsapp-conversation-context-index.mjs` for `whatsapp_private_messages` fields:

```javascript
[
  { fieldPath: 'sourceAccountId', order: 'ASCENDING' },
  { fieldPath: 'chatId', order: 'ASCENDING' },
  { fieldPath: 'eventTimestamp', order: 'ASCENDING' },
  { fieldPath: '__name__', order: 'ASCENDING' },
]
```

- [ ] **Step 6: Verify WhatsApp service tests**

Run:

```bash
pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts src/__tests__/infra/privateWhatsAppRepository.test.ts
```

Expected: PASS.

## Task 3: WhatsApp Service Conversation Assistant Runtime

**Files:**
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Create: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Create: `apps/whatsapp-service/src/infra/firestore/conversationAssistantRepository.ts`
- Create: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/routes/index.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/index.ts`
- Modify: `ecosystem.config.cjs`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `firestore-collections.json`
- Create: `migrations/118_whatsapp-conversation-assistant-indexes.mjs`
- Create: `migrations/__tests__/118-whatsapp-conversation-assistant-indexes.test.ts`
- Create: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Create: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Create: `apps/whatsapp-service/src/__tests__/infra/conversationAssistantRepository.test.ts`

**Interfaces:**
- Consumes: WhatsApp private chat/message repositories and transcript projector from Task 2.
- Consumes: `LlmGenerateClient.generateChat(messages, options)`.
- Produces: authenticated Conversation Assistant session/turn APIs.
- Produces Firestore collections `whatsapp_conversation_assistant_sessions` and `whatsapp_conversation_assistant_turns`.

- [ ] **Step 1: Write failing domain tests**

Cover creating a shell session from context when no first question is supplied, creating a session plus first LLM turn when `question` is supplied, freezing normalized transcript text, deriving a title from chat/range/first question, rejecting empty transcript contexts with `EMPTY_TRANSCRIPT`, and building follow-up messages with unchanged transcript prefix.

Run:

```bash
pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: FAIL because domain files do not exist.

- [ ] **Step 2: Implement domain use cases**

Implement:

```typescript
createConversationAssistantSession(input, deps)
sendConversationAssistantTurn(input, deps)
listConversationAssistantSessions(userId, deps)
getConversationAssistantSession({ userId, sessionId }, deps)
listConversationAssistantTurns({ userId, sessionId }, deps)
```

Use ids `whatsapp_conv_session_${randomUUID()}` and `whatsapp_conv_turn_${randomUUID()}`. Pass `session.id` as OpenRouter `sessionId`.

- [ ] **Step 3: Implement Firestore repository**

Store session documents with private fields `transcriptText` and public metadata. Store turns separately. Query sessions by `userId` ordered by `updatedAt desc`; query turns by `sessionId` ordered by `createdAt asc`.

- [ ] **Step 4: Implement routes and HTTP semantics**

Register routes under `/whatsapp/conversation-assistant`. Each route must `requireAuth()`, call `logIncomingRequest()`, reject cross-user access, and never return `transcriptText`.

Route tests must cover this error-code surface:

| Route | Failure | Error code |
| --- | --- | --- |
| `POST /whatsapp/conversation-assistant/sessions` | `from >= to`, invalid ISO timestamps, invalid `maxMessages`, or group chat | `INVALID_REQUEST` |
| `POST /whatsapp/conversation-assistant/sessions` | no active private account, unknown chat, or non-owned chat | `NOT_FOUND` |
| `POST /whatsapp/conversation-assistant/sessions` | zero textual messages after projection | `EMPTY_TRANSCRIPT` |
| `POST /whatsapp/conversation-assistant/sessions` | no `question` field | `201` shell session with zero turns |
| `POST /whatsapp/conversation-assistant/sessions` | LLM failure after supplied first question | persisted user turn plus assistant error turn with `LLM_ERROR` |
| `GET /whatsapp/conversation-assistant/sessions/:sessionId` | session missing or foreign user | `NOT_FOUND` |
| `GET /whatsapp/conversation-assistant/sessions/:sessionId/turns` | session missing or foreign user | `NOT_FOUND` |
| `POST /whatsapp/conversation-assistant/sessions/:sessionId/turns` | empty question | `INVALID_REQUEST` |
| `POST /whatsapp/conversation-assistant/sessions/:sessionId/turns` | session missing or foreign user | `NOT_FOUND` |
| `POST /whatsapp/conversation-assistant/sessions/:sessionId/turns` | LLM failure | persisted user turn plus assistant error turn with `LLM_ERROR` |

- [ ] **Step 5: Wire configuration**

Add required env vars:

- `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL`

Default the model to `or:google/gemini-3.5-flash`, verified in the OpenRouter catalog on 2026-06-30. Wire env vars in `apps/whatsapp-service/src/index.ts`, `ecosystem.config.cjs`, and `terraform/environments/dev/main.tf`.

- [ ] **Step 6: Add Firestore registry and indexes**

Register the two collections in `firestore-collections.json`. Add `migrations/118_whatsapp-conversation-assistant-indexes.mjs` for:

```javascript
[
  {
    collectionGroup: 'whatsapp_conversation_assistant_sessions',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  },
  {
    collectionGroup: 'whatsapp_conversation_assistant_turns',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'sessionId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ],
  },
]
```

- [ ] **Step 7: Verify WhatsApp assistant runtime tests**

Run:

```bash
pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts src/__tests__/conversationAssistantRoutes.test.ts src/__tests__/infra/conversationAssistantRepository.test.ts
```

Expected: PASS.

## Task 4: Web Conversation Assistant Experience

**Files:**
- Modify: `apps/web/src/components/sidebar/navItems.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/services/conversationAssistantApi.ts`
- Create: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Create: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Create: `apps/web/src/components/whatsapp/ConversationAssistantSessionRail.tsx`
- Create: `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`
- Create: `apps/web/src/__tests__/App.conversationAssistantRoute.test.tsx`
- Create: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`
- Create: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Create: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`

**Interfaces:**
- Consumes: existing `listPrivateWhatsAppChats()` from `apps/web/src/services/whatsappApi.ts`.
- Consumes: new `whatsapp-service` Conversation Assistant APIs.
- Produces: route `/#/whatsapp/conversation-assistant`.

- [ ] **Step 1: Write failing API service and route tests**

Test each API function path, method, request body, and WhatsApp service base URL usage. Add an `App.tsx` route-registration test proving `/#/whatsapp/conversation-assistant` resolves to `WhatsAppConversationAssistantPage` using the existing `apps/web/src/__tests__/` route-test patterns.

Run:

```bash
pnpm vitest run apps/web/src/services/__tests__/conversationAssistantApi.test.ts apps/web/src/__tests__/App.conversationAssistantRoute.test.tsx
```

Expected: FAIL because the service file and route do not exist.

- [ ] **Step 2: Implement API service and web types**

Add DTOs from the shared contract to `apps/web/src/types/index.ts`. Implement:

```typescript
listConversationAssistantSessions(accessToken)
createConversationAssistantSession(accessToken, request)
getConversationAssistantSession(accessToken, sessionId)
listConversationAssistantTurns(accessToken, sessionId)
sendConversationAssistantTurn(accessToken, sessionId, request)
```

- [ ] **Step 3: Write hook tests**

Cover initial load, selecting an existing session from `?session=`, creating a new session from selected chat/range/question, sending a follow-up, and preserving existing session selection after refresh.

- [ ] **Step 4: Implement hook**

The hook owns sessions, selected session id, turns, selected private chat, `from`/`to`, draft question, loading states, and error state. It should use the existing private chat list API for the picker and the new `conversationAssistantApi` for assistant state.

- [ ] **Step 5: Implement page UI**

Add a dense operational page, not a landing page:

- left rail: assistant sessions with title, chat label, range, and last turn time;
- setup area: private direct chat picker, `datetime-local` range controls, optional first question, create button;
- main panel: turn timeline with assistant/user bubbles, omitted-message summary, and source range metadata;
- composer: follow-up question input disabled until a session is selected.

- [ ] **Step 6: Add route and nav**

Add lazy route `/whatsapp/conversation-assistant` in `App.tsx`. Add WhatsApp nav item:

```typescript
{ to: '/whatsapp/conversation-assistant', label: 'Conversation Assistant', icon: Bot }
```

The nav item must be added to the `whatsappItems` array in `apps/web/src/components/sidebar/navItems.ts`, not to `intexAgentItems`.

- [ ] **Step 7: Verify web tests**

Run:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/conversationAssistantApi.test.ts src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx src/__tests__/App.conversationAssistantRoute.test.tsx
```

Expected: PASS.

## Final Verification

- [ ] Run package-focused tests listed in Task 1.
- [ ] Run `pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts src/__tests__/infra/privateWhatsAppRepository.test.ts`.
- [ ] Run `pnpm --filter @intexuraos/whatsapp-service test -- src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts src/__tests__/conversationAssistantRoutes.test.ts src/__tests__/infra/conversationAssistantRepository.test.ts`.
- [ ] Run `pnpm vitest run migrations/__tests__/117-private-whatsapp-conversation-context-index.test.ts migrations/__tests__/118-whatsapp-conversation-assistant-indexes.test.ts`.
- [ ] Run web tests listed in Task 4.
- [ ] Run `pnpm run verify:workspace:tracked -- whatsapp-service`.
- [ ] Run `pnpm run verify:workspace:tracked -- web`.
- [ ] Run `pnpm run verify:package-exports`.
- [ ] Run `pnpm run ci:tracked`.

## Acceptance Criteria

- A user can open `/#/whatsapp/conversation-assistant`, pick a private direct chat, choose a time range, create a session, ask a first question, leave the page, return, and continue the saved assistant conversation.
- Multiple sessions can exist for the same chat with different time ranges.
- The assistant context contains only text messages and completed transcriptions from the selected range.
- The assistant gives evidence-bound answers and explicitly says when the transcript does not support an answer.
- OpenRouter requests include top-level `session_id` equal to the assistant session id.
- OpenRouter requests mark the frozen transcript content block with `cache_control: { type: 'ephemeral' }`.
- Follow-up turns preserve the same transcript text and prompt prefix used in the initial call.
- Public API responses never expose `userId`-foreign data, raw Matrix payloads, media URLs, source account IDs, or frozen `transcriptText`.
- `pnpm run ci:tracked` passes before implementation is considered complete.

## Self-Review

- Spec coverage: user-facing submenu, private chat selection, time range selection, multiple autosaved sessions, continuing old sessions, text/transcription-only context, Gemini via OpenRouter, prompt caching, factuality constraints, and no-media MVP are all mapped to tasks.
- Placeholder scan: no implementation task uses placeholder language; exact paths, endpoint names, DTOs, and verification commands are specified.
- Type consistency: DTO names are shared across the package, WhatsApp service, and web task sections.
