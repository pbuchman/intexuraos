# Conversation Assistant Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade WhatsApp Conversation Assistant to use user OpenRouter keys, MiniMax M2.7 with reasoning, full context with a >5000 warning, streaming answers, markdown rendering, and bottom-follow timeline scrolling.

**Architecture:** Add reasoning and streaming to the shared OpenRouter generate client, then consume it from the WhatsApp Conversation Assistant domain. The backend owns user-key resolution, transcript freezing, context checks, turn persistence, and SSE events. The web app owns preflight confirmation, stream parsing, draft answer replacement, markdown rendering, and scroll follow state.

**Tech Stack:** TypeScript, Fastify, React 19, Vitest, nock, OpenRouter chat completions, Server-Sent Events.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-07-01-conversation-assistant-upgrade-design.md`.
- Conversation Assistant model default: `or:minimax/minimax-m2.7`.
- OpenRouter raw model id: `minimax/minimax-m2.7`.
- Reasoning option for all Conversation Assistant calls: `{ enabled: true }`.
- Large-context warning threshold: `5000` raw messages.
- Do not use `INTEXURAOS_OPENROUTER_APP_API_KEY` for Conversation Assistant.
- Use `INTEXURAOS_USER_SERVICE_URL` plus `INTEXURAOS_INTERNAL_AUTH_TOKEN` to fetch each user's `openrouter` key.
- Do not silently truncate the transcript to `2000` or `5000` messages.
- Prompt version must become `2.0.0`.
- Assistant markdown renders through `MarkdownContent` with raw HTML disabled.
- Backend route handlers must call `logIncomingRequest()` and `requireAuth()`.
- TDD is mandatory: write failing tests, run them red, implement, run them green.
- No git worktrees.
- No direct commits to `main` or `development`.
- Because this repo's commit gate requires full `pnpm run ci:tracked` before commit, subagents must not create commits per task. The controller creates the final commit only after full verification passes.
- Existing unrelated dirty files in `apps/web/src/components/sidebar*` must not be staged or modified by Conversation Assistant tasks.
- Final verification includes `pnpm run verify:workspace:tracked web`, `pnpm run verify:workspace:tracked whatsapp-service`, `pnpm run verify:package-exports`, and `pnpm run ci:tracked`.

---

## File Map

### Shared LLM Contract And OpenRouter

- Modify: `packages/llm-contract/src/types.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/index.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Modify: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/index.ts`
- Modify: `packages/llm-factory/src/openRouterGenerateClient.ts`
- Modify: `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts`

### Prompt And Transcript

- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`

### WhatsApp Service Domain, Routes, Config

- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/server.ts`
- Modify: `apps/whatsapp-service/src/index.ts`
- Modify: `apps/whatsapp-service/src/__tests__/config.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/testUtils.ts`
- Modify: `apps/whatsapp-service/src/__tests__/openapi-contract.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

### Web App

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`

### Runtime Defaults

- Modify: `ecosystem.config.cjs`
- Modify: `ecosystem.config.prod.cjs`
- Modify: `terraform/environments/dev/main.tf`

## Endpoint Changes

### Created

- `POST /conversation-assistant/context/check`
- `POST /conversation-assistant/sessions/:sessionId/turns/stream`

### Modified

- `POST /conversation-assistant/sessions`
- `POST /conversation-assistant/sessions/:sessionId/turns`

### Removed

- None.

### Unchanged

- `GET /conversation-assistant/sessions`
- `GET /conversation-assistant/sessions/:sessionId`
- `GET /conversation-assistant/sessions/:sessionId/turns`

## Task 1: Add OpenRouter Reasoning And Chat Streaming Support

**Files:**
- Modify: `packages/llm-contract/src/types.ts`
- Modify: `packages/llm-contract/src/index.ts`
- Modify: `packages/infra-openrouter/src/types.ts`
- Modify: `packages/infra-openrouter/src/index.ts`
- Modify: `packages/infra-openrouter/src/client.ts`
- Modify: `packages/infra-openrouter/src/__tests__/client.test.ts`
- Modify: `packages/llm-factory/src/llmClientFactory.ts`
- Modify: `packages/llm-factory/src/index.ts`
- Modify: `packages/llm-factory/src/openRouterGenerateClient.ts`
- Modify: `packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts`

**Interfaces:**
- Produce: `GenerateChatReasoningOptions = { enabled?: boolean; effort?: 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none'; maxTokens?: number; exclude?: boolean }`.
- Produce: `GenerateChatOptions.reasoning?: GenerateChatReasoningOptions`.
- Produce: `GenerateChatStreamEvent = { type: 'delta'; text: string } | { type: 'usage'; usage: GenerateChatResult['usage'] }`.
- Produce: `LlmGenerateClient.generateChatStream?(messages, options, onEvent)`.
- Consume: existing `createOpenRouterClient(config)` and usage logging.

- [ ] **Step 1: Write failing OpenRouter request-body tests**

Add tests under `describe('generateChat')` in `packages/infra-openrouter/src/__tests__/client.test.ts`:

```typescript
it('forwards reasoning options to OpenRouter chat completions', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  nock('https://openrouter.ai')
    .post('/api/v1/chat/completions', (body) => {
      capturedBody = body as Record<string, unknown>;
      return true;
    })
    .reply(200, {
      id: 'cmpl-1',
      model: 'minimax/minimax-m2.7',
      created: 1,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.001 },
    });

  const client = createOpenRouterClient(makeConfig({ model: 'minimax/minimax-m2.7' }));
  const result = await client.generateChat([{ role: 'user', content: 'hello' }], {
    promptType: 'whatsapp-conversation-assistant',
    reasoning: { enabled: true },
  });

  expect(result.ok).toBe(true);
  expect(capturedBody?.['reasoning']).toEqual({ enabled: true });
});
```

- [ ] **Step 2: Write failing streaming parser tests**

Add a helper in `packages/infra-openrouter/src/__tests__/client.test.ts`:

```typescript
function openRouterSse(chunks: string[]): string {
  return chunks.map((chunk) => `data: ${chunk}\n\n`).join('');
}
```

Add test:

```typescript
it('streams chat completion deltas and final usage', async () => {
  nock('https://openrouter.ai')
    .post('/api/v1/chat/completions', (body) => {
      const typed = body as Record<string, unknown>;
      return typed['stream'] === true && JSON.stringify(typed['reasoning']) === '{"enabled":true}';
    })
    .reply(
      200,
      openRouterSse([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
        JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.001 } }),
        '[DONE]',
      ]),
      { 'Content-Type': 'text/event-stream' }
    );

  const client = createOpenRouterClient(makeConfig({ model: 'minimax/minimax-m2.7' }));
  const events: unknown[] = [];
  const result = await client.generateChatStream(
    [{ role: 'user', content: 'hello' }],
    { promptType: 'whatsapp-conversation-assistant', reasoning: { enabled: true } },
    (event) => {
      events.push(event);
    }
  );

  expect(result.ok).toBe(true);
  expect(events).toContainEqual({ type: 'delta', text: 'Hel' });
  expect(events).toContainEqual({ type: 'delta', text: 'lo' });
  expect(events).toContainEqual({
    type: 'usage',
    usage: expect.objectContaining({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }),
  });
  if (result.ok) expect(result.value.content).toBe('Hello');
  if (result.ok) expect(result.value.usage.totalTokens).toBe(5);
});
```

Add a streaming parser test that ignores SSE comment frames and incomplete blank-line-separated chunks:

```typescript
it('ignores streaming comments and buffers incomplete SSE frames', async () => {
  const body = ': keep-alive\n\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
  nock('https://openrouter.ai')
    .post('/api/v1/chat/completions')
    .reply(200, body, { 'Content-Type': 'text/event-stream' });

  const client = createOpenRouterClient(makeConfig({ model: 'minimax/minimax-m2.7' }));
  const result = await client.generateChatStream(
    [{ role: 'user', content: 'hello' }],
    { promptType: 'whatsapp-conversation-assistant', reasoning: { enabled: true } },
    () => {}
  );

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.content).toBe('Hi');
});
```

Add a provider error chunk test:

```typescript
it('maps streaming provider error chunks to API errors', async () => {
  nock('https://openrouter.ai')
    .post('/api/v1/chat/completions')
    .reply(
      200,
      openRouterSse([JSON.stringify({ error: { message: 'provider failed' } })]),
      { 'Content-Type': 'text/event-stream' }
    );

  const client = createOpenRouterClient(makeConfig({ model: 'minimax/minimax-m2.7' }));
  const result = await client.generateChatStream(
    [{ role: 'user', content: 'hello' }],
    { promptType: 'whatsapp-conversation-assistant', reasoning: { enabled: true } },
    () => {}
  );

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toContain('provider failed');
});
```

- [ ] **Step 3: Run tests red**

Run:

```bash
pnpm exec vitest run packages/infra-openrouter/src/__tests__/client.test.ts packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts
```

Expected: FAIL because `reasoning`, `generateChatStream`, and stream parsing do not exist.

- [ ] **Step 4: Implement contract types**

In `packages/llm-contract/src/types.ts`, add reasoning and streaming types near `GenerateChatOptions`:

```typescript
export type GenerateChatReasoningEffort = 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

export interface GenerateChatReasoningOptions {
  enabled?: boolean;
  effort?: GenerateChatReasoningEffort;
  maxTokens?: number;
  exclude?: boolean;
}

export type GenerateChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: GenerateChatResult['usage'] };
```

Add `reasoning?: GenerateChatReasoningOptions` to `GenerateChatOptions`.

In `LlmGenerateClient`, add:

```typescript
generateChatStream?(
  messages: LlmChatMessage[],
  options: GenerateChatOptions,
  onEvent: (event: GenerateChatStreamEvent) => void
): Promise<Result<GenerateChatResult, LLMError>>;
```

Export `GenerateChatReasoningEffort`, `GenerateChatReasoningOptions`, and `GenerateChatStreamEvent` from:

- `packages/llm-contract/src/index.ts`
- `packages/infra-openrouter/src/index.ts`
- `packages/llm-factory/src/index.ts`

- [ ] **Step 5: Implement OpenRouter reasoning serialization**

In `packages/infra-openrouter/src/client.ts`, add a helper:

```typescript
function toOpenRouterReasoning(
  reasoning: GenerateChatOptions['reasoning']
): Record<string, unknown> | undefined {
  if (reasoning === undefined) return undefined;
  return {
    ...(reasoning.enabled !== undefined && { enabled: reasoning.enabled }),
    ...(reasoning.effort !== undefined && { effort: reasoning.effort }),
    ...(reasoning.maxTokens !== undefined && { max_tokens: reasoning.maxTokens }),
    ...(reasoning.exclude !== undefined && { exclude: reasoning.exclude }),
  };
}
```

Use it in the non-streaming request body:

```typescript
...(toOpenRouterReasoning(options.reasoning) !== undefined && {
  reasoning: toOpenRouterReasoning(options.reasoning),
}),
```

- [ ] **Step 6: Implement OpenRouter streaming**

In `OpenRouterClient`, add `generateChatStream`.

Implement a stream processor modeled on `packages/infra-perplexity/src/client.ts`:

```typescript
interface OpenRouterStreamChunk {
  choices?: { delta?: { content?: string }; error?: { message?: string } }[];
  usage?: OpenRouterUsage;
  error?: { message?: string };
}
```

Parse `data:` lines, ignore blank lines, ignore comment lines beginning with `:`, ignore `[DONE]`, accumulate `choices[0].delta.content`, call `onEvent({ type: 'delta', text })`, capture usage with `onEvent({ type: 'usage', usage })`, and return `ok({ content, usage })`. If OpenRouter sends an error chunk, throw an `OpenRouterApiError(500, message)` so existing error mapping and usage logging are used.

- [ ] **Step 7: Forward streaming through llm-factory**

In `packages/llm-factory/src/openRouterGenerateClient.ts`, add:

```typescript
async generateChatStream(messages, options, onEvent) {
  return await orClient.generateChatStream(messages, options, onEvent);
}
```

In `withUnsupportedGenerateChat`, add a rejecting `generateChatStream` for non-OpenRouter clients with message `Chat message streaming is only supported for OpenRouter clients`.

- [ ] **Step 8: Run tests green**

Run:

```bash
pnpm exec vitest run packages/infra-openrouter/src/__tests__/client.test.ts packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts
```

Expected: PASS.

## Task 2: Update Prompt, Transcript Dates, And Remove Context Truncation

**Files:**
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/conversationAssistantPrompt.ts`
- Modify: `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`

**Interfaces:**
- Produce: `projectPrivateConversationContext(input)` treats `maxMessages` as optional; when omitted, no cap is applied.
- Produce: transcript text with `[22 June] Speaker: content` date labels.
- Consume: `WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.version = '2.0.0'`.

- [ ] **Step 1: Write failing prompt tests**

In `packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts`, assert:

```typescript
expect(WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.version).toBe('2.0.0');
expect(systemText).toContain('psychologist');
expect(systemText).toContain('analyst');
expect(systemText).toContain('lawyer');
expect(systemText).toContain('Do not output raw ISO timestamps');
expect(systemText).toContain('day and month');
```

Add a full prompt test that builds messages with ISO input range values and asserts no built message content exposes an ISO timestamp:

```typescript
const messages = buildWhatsAppConversationAssistantMessages({
  transcriptText: '[22 June] Alice: hello',
  range: {
    from: '2026-06-22T09:00:00.000Z',
    to: '2026-06-22T11:00:00.000Z',
  },
  priorTurns: [],
  question: 'What happened?',
});
expect(JSON.stringify(messages)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
expect(JSON.stringify(messages)).toContain('22 June');
```

- [ ] **Step 2: Write failing transcript tests**

In `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`, change expected transcript hash input to:

```typescript
const expectedTranscript = [
  '[22 June] Alice: hello from private chat',
  '[22 June] You: voice transcript',
].join('\n');
```

Add assertion:

```typescript
expect(expectedTranscript).not.toContain('T10:00:00');
```

Replace the over-limit test with:

```typescript
it('does not truncate projected text messages by a max-message cap', () => {
  const result = projectPrivateConversationContext({
    chat,
    range: { from: '2026-06-22T09:00:00.000Z', to: '2026-06-22T11:00:00.000Z' },
    messages: [
      message({ id: 'message-1', text: 'first' }),
      message({ id: 'message-2', matrixEventId: '$event-2', text: 'second' }),
      message({ id: 'message-3', matrixEventId: '$event-3', text: 'third' }),
    ],
  });

  expect(result.messages.map((item) => item.content)).toEqual(['first', 'second', 'third']);
  expect(result.omitted.overLimit).toBe(0);
});
```

- [ ] **Step 3: Run tests red**

Run:

```bash
pnpm exec vitest run packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts
```

Expected: FAIL because prompt is version `1.0.0`, transcript has ISO timestamps, and context still requires `maxMessages`.

- [ ] **Step 4: Implement prompt update**

In `conversationAssistantPrompt.ts`, set version to `2.0.0` and replace the system text with instructions that include the exact role adaptation and timestamp rules from the spec.

Format the prompt range header with day/month labels, not ISO input values:

```typescript
function formatPromptDateLabel(value: string): string {
  const date = new Date(value);
  const month = ENGLISH_MONTHS[date.getUTCMonth()] ?? 'Unknown';
  return `${String(date.getUTCDate())} ${month}`;
}
```

Use `Range: ${formatPromptDateLabel(input.range.from)} to ${formatPromptDateLabel(input.range.to)}`.

- [ ] **Step 5: Implement transcript date labels**

In `transcriptFormatting.ts`, add:

```typescript
const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function formatTranscriptDateLabel(value: string): string {
  const date = new Date(value);
  const month = ENGLISH_MONTHS[date.getUTCMonth()] ?? 'Unknown';
  return `${String(date.getUTCDate())} ${month}`;
}
```

Use it in `buildPrivateConversationTranscriptText`.

- [ ] **Step 6: Remove max-message cap from projection**

Make `maxMessages` optional in `ProjectPrivateConversationContextInput`. Apply the over-limit branch only when `input.maxMessages !== undefined`; when omitted, include every projected text/transcription message and keep `omitted.overLimit: 0`.

In `types.ts`, remove exported default/min/max constants or leave only `CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD = 5000`.

In `sessionUseCases.ts`, stop importing and validating max-message constants. Do not pass `maxMessages` to `projectPrivateConversationContext`.

- [ ] **Step 7: Run tests green**

Run:

```bash
pnpm exec vitest run packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: PASS.

## Task 3: Add User-Key LLM Wiring And MiniMax Defaults

**Files:**
- Modify: `apps/whatsapp-service/src/services.ts`
- Modify: `apps/whatsapp-service/src/config.ts`
- Modify: `apps/whatsapp-service/src/server.ts`
- Modify: `apps/whatsapp-service/src/index.ts`
- Modify: `apps/whatsapp-service/src/__tests__/config.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/testUtils.ts`
- Modify: `apps/whatsapp-service/src/__tests__/openapi-contract.test.ts`
- Modify: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`
- Modify: `ecosystem.config.cjs`
- Modify: `ecosystem.config.prod.cjs`
- Modify: `terraform/environments/dev/main.tf`

**Interfaces:**
- Produce: `ServiceConfig.userServiceUrl: string`.
- Produce: async `ConversationAssistantLlmClientFactory.createLlmClientForUser(userId): Promise<Result<LlmGenerateClient, ConversationAssistantError>>`.
- Consume: `createUserServiceClient`.

- [ ] **Step 1: Write failing service wiring tests**

In `apps/whatsapp-service/src/__tests__/config.test.ts`, update required env setup so `INTEXURAOS_USER_SERVICE_URL` is required and `INTEXURAOS_OPENROUTER_APP_API_KEY` is not required by whatsapp-service config.

Add expectation:

```typescript
expect(config.conversationAssistantModel).toBe('or:minimax/minimax-m2.7');
```

In a new or existing services test area, assert the Conversation Assistant factory fetches `openrouter` from user service and passes that key into `createLlmClient`.

Add a poison-key assertion: leave the app key unset or set it to `poison-app-key`, have user-service return `user-openrouter-key`, and assert the LLM client receives only `user-openrouter-key`.

Add no-key and user-service-failure tests: when user-service returns no `openrouter` key or returns an error, creating/sending a Conversation Assistant turn persists an assistant error turn and never falls back to an app key or Gemini.

Add or update server/config integration coverage proving `buildServer()` passes `userServiceUrl` to services and no longer passes or reads `openRouterAppApiKey`.

Add production PM2 config coverage for `ecosystem.config.prod.cjs`: WhatsApp service defaults to MiniMax, WhatsApp service no longer receives the OpenRouter app key, and services that still need the app key continue to receive it.

- [ ] **Step 2: Run tests red**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/config.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: FAIL because config still requires app key and the factory is sync.

- [ ] **Step 3: Update config schema and required env**

In `apps/whatsapp-service/src/config.ts`:

- add `userServiceUrl: z.string().url()`;
- remove `openRouterAppApiKey`;
- default `conversationAssistantModel` to `or:minimax/minimax-m2.7`;
- add `INTEXURAOS_USER_SERVICE_URL` to `loadConfig()` input and `validateConfigEnv()`;
- remove `INTEXURAOS_OPENROUTER_APP_API_KEY` from `loadConfig()` input and `validateConfigEnv()`;
- keep `INTEXURAOS_CONVERSATION_ASSISTANT_MODEL` in required/configured env.

In `apps/whatsapp-service/src/index.ts`, remove `INTEXURAOS_OPENROUTER_APP_API_KEY` from `REQUIRED_ENV` if no other whatsapp-service path uses it. Keep `INTEXURAOS_USER_SERVICE_URL`.

- [ ] **Step 4: Update service wiring**

In `services.ts`, import `createUserServiceClient` and `NoopUsageSink` only if required by the constructor. Build a user service client once:

```typescript
const userServiceClient = createUserServiceClient({
  baseUrl: config.userServiceUrl,
  internalAuthToken: config.internalAuthToken,
  logger: createAppLogger({ name: 'whatsapp-conversation-assistant-user-service' }),
  usageSink,
});
```

In `createLlmClientForUser`, fetch `keys = await userServiceClient.getApiKeys(userId)`, require `keys.value.openrouter`, and return:

```typescript
return ok(
  createLlmClient({
    apiKey: keys.value.openrouter,
    model: config.conversationAssistantModel as never,
    userId,
    logger: createAppLogger({ name: 'whatsapp-conversation-assistant-llm' }),
    usageSink,
    ownerType: 'user',
  })
);
```

In `apps/whatsapp-service/src/server.ts`, pass `userServiceUrl: config.userServiceUrl` into `serviceConfig` and remove `openRouterAppApiKey`.

- [ ] **Step 5: Update domain call sites for async factory**

In `sessionUseCases.ts`, await the factory result before calling `generateChat` or `generateChatStream`. If it returns an error, persist an assistant error turn with the returned message.

- [ ] **Step 6: Update runtime defaults**

In `ecosystem.config.cjs`, change the conversation assistant fallback to:

```javascript
process.env.INTEXURAOS_CONVERSATION_ASSISTANT_MODEL ?? 'or:minimax/minimax-m2.7'
```

Remove `INTEXURAOS_OPENROUTER_APP_API_KEY` only from the whatsapp-service mapping if it is not used by other services.

In `ecosystem.config.prod.cjs`:

- change the Conversation Assistant fallback to `or:minimax/minimax-m2.7`;
- remove `INTEXURAOS_OPENROUTER_APP_API_KEY` only from the WhatsApp service secret/env injection;
- keep `INTEXURAOS_OPENROUTER_APP_API_KEY` for services that still use the app key outside Conversation Assistant.

In `terraform/environments/dev/main.tf`, set:

```hcl
INTEXURAOS_CONVERSATION_ASSISTANT_MODEL = "or:minimax/minimax-m2.7"
```

Do not remove the shared OpenRouter app key secret from Terraform if other services still use it.

- [ ] **Step 7: Run tests green**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/config.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts apps/whatsapp-service/src/__tests__/openapi-contract.test.ts apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts
```

Expected: PASS.

## Task 4: Add Context Check And Streaming Domain Use Cases

**Files:**
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/types.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/ports.ts`
- Modify: `apps/whatsapp-service/src/domain/conversation-assistant/sessionUseCases.ts`
- Modify: `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts`

**Interfaces:**
- Produce: `checkConversationAssistantContext(input, deps)`.
- Produce: `streamConversationAssistantTurn(input, deps, onEvent)`.
- Consume: Task 1 `generateChatStream`.
- Consume: Task 3 async user-key factory.

- [ ] **Step 1: Write failing context-check tests**

Add a test that seeds a direct chat and stubs `findConversationContextMessages` to return `totalCount: 5001`. Assert:

```typescript
const result = await checkConversationAssistantContext({ userId: USER_ID, chatId: CHAT_ID, from, to }, deps);
expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.value).toEqual({
    messageCount: 5001,
    warningThreshold: 5000,
    requiresConfirmation: true,
  });
}
```

Add ownership and group-chat rejection tests matching create-session behavior.

Add a create-session pagination test proving more than 5000 selected messages are read across pages and projected without truncating to 2000 or 5000.

- [ ] **Step 2: Write failing streaming use-case tests**

Extend `FakeLlmGenerateClient` to support `generateChatStream`.

Add a test:

```typescript
const events: unknown[] = [];
const result = await streamConversationAssistantTurn(
  { userId: USER_ID, sessionId: created.value.session.id, question: 'Stream this' },
  deps,
  (event) => {
    events.push(event);
  }
);

expect(result.ok).toBe(true);
expect(events.map((event) => (event as { type: string }).type)).toEqual([
  'user_turn',
  'assistant_delta',
  'assistant_turn',
  'done',
]);
expect(conversationRepository.getAllTurns().map((turn) => turn.role)).toEqual(['user', 'assistant']);
```

Add app-level option assertions:

```typescript
expect(llmClient.chatCalls[0]?.options.reasoning).toEqual({ enabled: true });
expect(llmClient.streamChatCalls[0]?.options.reasoning).toEqual({ enabled: true });
```

Add streaming failure tests:

- no user OpenRouter key: event order is `user_turn`, `error`, `assistant_turn`, `done`, one assistant error turn is persisted, and no fallback key is used;
- user-service failure: same event order and persisted assistant error turn;
- LLM error before deltas: same event order and persisted assistant error turn;
- LLM error after partial deltas: partial draft deltas are emitted, then `error`, persisted `assistant_turn`, and `done`; the persisted assistant turn has `error.code = 'LLM_ERROR'`;
- session `updatedAt` and `lastTurnAt` are updated for both success and persisted error turns.

- [ ] **Step 3: Run tests red**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: FAIL because new use cases and streaming fake methods do not exist.

- [ ] **Step 4: Add context-check types**

In `types.ts`:

```typescript
export const CONVERSATION_ASSISTANT_LARGE_CONTEXT_WARNING_THRESHOLD = 5000;

export interface CheckConversationAssistantContextInput {
  userId: string;
  chatId: string;
  from: string;
  to: string;
}

export interface CheckConversationAssistantContextResult {
  messageCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
}
```

- [ ] **Step 5: Add streaming event types**

In `types.ts`:

```typescript
export type ConversationAssistantStreamEvent =
  | { type: 'user_turn'; turn: ConversationAssistantTurn }
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_turn'; turn: ConversationAssistantTurn }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };
```

- [ ] **Step 6: Extract shared validation/loading helpers**

In `sessionUseCases.ts`, extract direct-chat range loading into helpers:

```typescript
async function loadOwnedDirectChatForRange(
  input: CheckConversationAssistantContextInput,
  deps: ConversationAssistantDeps
): Promise<
  ConversationAssistantResult<{
    sourceAccountId: string;
    chat: PrivateWhatsAppChat;
  }>
>;

async function loadAllConversationMessages(
  input: {
    sourceAccountId: string;
    chatId: string;
    from: string;
    to: string;
  },
  deps: ConversationAssistantDeps
): Promise<ConversationAssistantResult<PrivateWhatsAppMessage[]>>;
```

The helper must preserve existing errors: `NOT_FOUND`, `INVALID_REQUEST`, `PERSISTENCE_ERROR`, `EMPTY_TRANSCRIPT`.

- [ ] **Step 7: Implement context check**

Call `findConversationContextMessages` once with `limit: 1`. Use `messagesResult.value.totalCount` as the raw count. Return threshold and `requiresConfirmation`.

- [ ] **Step 8: Implement streaming turn**

Use the same prompt construction as `appendQuestionAndAssistantTurn`, but call `generateChatStream` with:

```typescript
{
  promptType: WHATSAPP_CONVERSATION_ASSISTANT_PROMPT.promptType,
  sessionId: session.id,
  temperature: 0.2,
  reasoning: { enabled: true },
  correlation: { sessionId: session.id },
}
```

Emit events in the order specified in the test. Persist the final assistant turn exactly once.

For non-streaming compatibility, call `generateChat` with the same `reasoning: { enabled: true }` option.

For streaming failures, persist exactly one assistant error turn, update session timestamps, emit `error`, emit the persisted `assistant_turn`, and always emit `done` before returning success from the route-level stream lifecycle.

- [ ] **Step 9: Run tests green**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts
```

Expected: PASS.

## Task 5: Add Context Check And Streaming Routes

**Files:**
- Modify: `apps/whatsapp-service/src/routes/conversationAssistantRoutes.ts`
- Modify: `apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts`

**Interfaces:**
- Consume: `checkConversationAssistantContext`.
- Consume: `streamConversationAssistantTurn`.
- Produce: `text/event-stream` Fastify responses with `event:` and `data:` frames.

- [ ] **Step 1: Write failing route tests**

In `conversationAssistantRoutes.test.ts`, add tests for:

- `POST /conversation-assistant/context/check` returns `requiresConfirmation: true` for `5001`.
- `POST /conversation-assistant/context/check` returns `400` for invalid date body.
- `POST /conversation-assistant/sessions/:sessionId/turns/stream` returns `content-type` containing `text/event-stream`.
- Streaming body contains `event: user_turn`, `event: assistant_delta`, `event: assistant_turn`, and `event: done`.
- Streaming route returns auth/session ownership failures consistently with non-stream route.
- Context-check response uses the normal `{ success: true, data: { messageCount: 5001, warningThreshold: 5000, requiresConfirmation: true } }` envelope.
- Streaming route validation/auth/session errors before SSE headers remain normal JSON failures.
- Model/user-key errors after SSE starts are emitted as `event: error`, then `event: assistant_turn`, then `event: done`.

- [ ] **Step 2: Run tests red**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement SSE helper**

In `conversationAssistantRoutes.ts`, add:

```typescript
function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
```

Use `reply.raw.write(formatSseEvent('done', {}))` style writes after setting status and headers:

```typescript
reply.hijack();
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
});
```

- [ ] **Step 4: Implement `context-check` route**

Follow existing create-session route validation shape. Body properties are `chatId`, `from`, `to`, all required strings.

- [ ] **Step 5: Implement stream route**

Follow existing send-turn route validation shape. Body property is `question`.

Perform auth, validation, dependency lookup, and owned-session validation before `reply.hijack()` whenever those failures can still be returned as JSON. After `reply.hijack()` and SSE headers are written, failures must be sent as SSE events.

Map domain events to SSE:

```typescript
onEvent((event) => {
  if (event.type === 'assistant_delta') reply.raw.write(formatSseEvent('assistant_delta', { text: event.text }));
  if (event.type === 'user_turn') reply.raw.write(formatSseEvent('user_turn', { turn: event.turn }));
  if (event.type === 'assistant_turn') reply.raw.write(formatSseEvent('assistant_turn', { turn: event.turn }));
  if (event.type === 'error') reply.raw.write(formatSseEvent('error', { code: event.code, message: event.message }));
  if (event.type === 'done') reply.raw.write(formatSseEvent('done', {}));
});
```

End the raw response in `finally` if it has not ended.

- [ ] **Step 6: Run tests green**

Run:

```bash
pnpm exec vitest run apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts
```

Expected: PASS.

## Task 6: Add Web API Streaming, Preflight, And Hook State

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/conversationAssistantApi.ts`
- Modify: `apps/web/src/services/__tests__/conversationAssistantApi.test.ts`
- Modify: `apps/web/src/hooks/useWhatsAppConversationAssistant.ts`
- Modify: `apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx`

**Interfaces:**
- Produce: `checkConversationAssistantContext(accessToken, request)`.
- Produce: `streamConversationAssistantTurn(accessToken, sessionId, request, handlers)`.
- Produce: hook fields `contextWarning`, `streamingAnswer`, and `confirmLargeContextAndCreateSession`.

- [ ] **Step 1: Write failing web API tests**

In `conversationAssistantApi.test.ts`, mock `globalThis.fetch` for the stream endpoint. Add tests for context check and SSE parsing:

```typescript
expect(await checkConversationAssistantContext(TOKEN, request)).toEqual({
  messageCount: 5001,
  warningThreshold: 5000,
  requiresConfirmation: true,
});
```

For streaming, use a `ReadableStream` that emits:

```text
event: user_turn
data: {"turn":{"id":"user-turn","role":"user","text":"Question"}}

event: assistant_delta
data: {"text":"Hel"}

event: assistant_delta
data: {"text":"lo"}

event: assistant_turn
data: {"turn":{"id":"assistant-turn","role":"assistant","text":"Hello"}}

event: done
data: {}
```

Assert handler calls and final result.

Add a split-chunk parser test where the `event:` line and `data:` line arrive in separate `ReadableStream` chunks. Assert the same typed event is emitted once.

Add an `error` event parser test:

```text
event: error
data: {"code":"LLM_ERROR","message":"Model failed"}

event: done
data: {}
```

Assert the error handler receives `{ code: 'LLM_ERROR', message: 'Model failed' }` and the stream completes without throwing a JSON parse error.

- [ ] **Step 2: Write failing hook tests**

In `useWhatsAppConversationAssistant.test.tsx`, add:

- create session calls `checkConversationAssistantContext` before session creation;
- when context check returns `requiresConfirmation: false`, session creation proceeds immediately;
- when check returns `requiresConfirmation: true`, no session is created and `contextWarning` is set;
- changing chat, from, or to clears the existing `contextWarning`;
- confirming a warning uses the exact pending request snapshot that produced that warning, not whatever chat/from/to values are current after the user changes the form;
- `confirmLargeContextAndCreateSession` creates the session after warning;
- first question is sent through `streamConversationAssistantTurn`, not create-session `question`;
- first-question streamed turns remain visible even if the selected-session loader for the new session resolves after streaming has started;
- follow-up clears `followUpQuestion` as soon as send starts;
- follow-up appends the persisted `user_turn` event before assistant deltas;
- follow-up shows draft content from deltas and replaces it with the final assistant turn;
- `done` refreshes the session list after the final assistant turn;
- stream `error` sets the hook error while preserving already emitted turns;
- duplicate send/create guards still work.

- [ ] **Step 3: Run tests red**

Run:

```bash
pnpm --dir apps/web exec vitest run src/services/__tests__/conversationAssistantApi.test.ts src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx
```

Expected: FAIL because new functions and hook state do not exist.

- [ ] **Step 4: Add web types**

In `apps/web/src/types/index.ts`:

```typescript
export interface ConversationAssistantContextCheckRequest {
  chatId: string;
  from: string;
  to: string;
}

export interface ConversationAssistantContextCheckResponse {
  messageCount: number;
  warningThreshold: number;
  requiresConfirmation: boolean;
}

export type ConversationAssistantStreamEvent =
  | { type: 'user_turn'; turn: ConversationAssistantTurn }
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_turn'; turn: ConversationAssistantTurn }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };
```

- [ ] **Step 5: Implement web API stream parser**

Use `fetch` instead of `apiRequest` for the streaming endpoint, with `Authorization: Bearer ${accessToken}` and `Content-Type: application/json`.

Implement a small parser that buffers text until blank-line SSE frames, reads `event:` and `data:` lines, parses JSON data, and calls typed handlers.

- [ ] **Step 6: Implement hook preflight**

Add state:

```typescript
contextWarning: ConversationAssistantContextCheckResponse | null;
confirmLargeContextAndCreateSession: () => Promise<void>;
```

`createSession()` performs context check. If confirmation is required, set warning and return. `confirmLargeContextAndCreateSession()` bypasses the warning for the current chat/from/to values and creates the session.

Store a pending request snapshot:

```typescript
interface PendingLargeContextRequest {
  chatId: string;
  from: string;
  to: string;
  question: string;
}
```

`confirmLargeContextAndCreateSession()` must use this snapshot. `selectChat`, `setFromDateTimeLocal`, and `setToDateTimeLocal` must clear both `contextWarning` and the pending snapshot.

- [ ] **Step 7: Implement hook streaming**

Replace `sendConversationAssistantTurn` calls with `streamConversationAssistantTurn`.

For first question, create the session without `question`, then stream the question into the selected session.

When a new session is selected for the first question, increment `turnsRequestIdRef` before streaming so any late selected-session loader result for the new session cannot clear streamed turns.

Represent a draft assistant turn with stable local id:

```typescript
const draftId = `draft-${requestId}`;
```

Append delta text into the draft and replace it on `assistant_turn`.

Handle stream events explicitly:

- `user_turn`: append the persisted user turn unless that id already exists.
- `assistant_delta`: create or update the local draft assistant turn by appending delta text.
- `assistant_turn`: replace the draft with the persisted assistant turn.
- `error`: set hook error to the event message and keep already emitted turns.
- `done`: refresh the session list and clear `sending`.

Clear `followUpQuestion` immediately after a valid send starts, before awaiting network I/O.

- [ ] **Step 8: Run tests green**

Run:

```bash
pnpm --dir apps/web exec vitest run src/services/__tests__/conversationAssistantApi.test.ts src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx
```

Expected: PASS.

## Task 7: Render Markdown, Warning UI, Composer Progress, And Scroll Follow

**Files:**
- Modify: `apps/web/src/components/whatsapp/ConversationAssistantComposer.tsx`
- Modify: `apps/web/src/pages/WhatsAppConversationAssistantPage.tsx`
- Modify: `apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx`

**Interfaces:**
- Consume: hook `contextWarning`, `confirmLargeContextAndCreateSession`, `sending`, and streamed draft turns.
- Consume: `MarkdownContent`.

- [ ] **Step 1: Write failing page tests**

In `WhatsAppConversationAssistantPage.test.tsx`, add tests:

- assistant text `## Summary\n\n**Important**` renders as heading plus bold text, and raw `**Important**` is not visible as raw markdown;
- assistant text `<strong>Raw</strong>` renders as literal text or escaped content, not an interpreted HTML strong element;
- large-context warning appears with copy containing `very long conversation list`;
- warning confirm button calls `confirmLargeContextAndCreateSession`;
- composer loading text is `Answering` while sending;
- scroll container calls `scrollTo` when turns/draft content changes and the viewport is at bottom;
- scroll container does not call `scrollTo` after user scrolls away from bottom.
- scroll follow resumes when the user scrolls back within 64 pixels of the bottom;
- starting a send forces follow mode back on;
- assistant delta text growth scrolls while follow mode is active;
- replacing a draft with the final assistant turn keeps the container anchored at bottom.

- [ ] **Step 2: Run tests red**

Run:

```bash
pnpm --dir apps/web exec vitest run src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
```

Expected: FAIL because page lacks markdown, warning, and scroll behavior.

- [ ] **Step 3: Render assistant markdown**

Import `MarkdownContent` and render:

```tsx
{isUser ? (
  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
    {turn.text}
  </p>
) : (
  <div className="break-words text-sm leading-6 text-slate-950 dark:text-slate-50">
    <MarkdownContent content={turn.text} />
  </div>
)}
```

- [ ] **Step 4: Add warning UI**

Render a compact warning band near the create controls when `assistant.contextWarning !== null`. Copy must be nontechnical and include `very long conversation list`. Confirm button calls `assistant.confirmLargeContextAndCreateSession`.

- [ ] **Step 5: Update composer progress**

In `ConversationAssistantComposer`, change loading text prop to display `Answering` when `sending === true`.

- [ ] **Step 6: Add scroll follow controller**

In page component:

```typescript
const turnsContainerRef = useRef<HTMLDivElement | null>(null);
const followBottomRef = useRef(true);
const programmaticScrollRef = useRef(false);
const lastTurnSignature = assistant.turns.map((turn) => `${turn.id}:${turn.text.length}`).join('|');
```

On user scroll, if `programmaticScrollRef.current === false`, set `followBottomRef.current = scrollHeight - scrollTop - clientHeight <= 64`. If the user is within 64 pixels of bottom, follow mode resumes.

On `lastTurnSignature`, `loadingTurns`, or `assistant.sending` changes, if follow mode is active, call:

```typescript
programmaticScrollRef.current = true;
container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
window.setTimeout(() => {
  programmaticScrollRef.current = false;
}, 0);
```

When send starts, force `followBottomRef.current = true`.

- [ ] **Step 7: Run tests green**

Run:

```bash
pnpm --dir apps/web exec vitest run src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
```

Expected: PASS.

## Task 8: Integration Verification And PR Preparation

**Files:**
- Modify only files already listed if verification reveals defects.
- Do not stage unrelated sidebar files.

**Interfaces:**
- Consume: all previous tasks.
- Produce: verified branch ready for PR to `development`.

- [ ] **Step 1: Run focused test suites**

Run:

```bash
pnpm exec vitest run packages/infra-openrouter/src/__tests__/client.test.ts packages/llm-factory/src/__tests__/openRouterGenerateClient.test.ts packages/llm-factory/src/__tests__/llmClientFactory.test.ts packages/llm-prompts/src/whatsapp-conversation-assistant/__tests__/conversationAssistantPrompt.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts apps/whatsapp-service/src/__tests__/domain/conversation-assistant/sessionUseCases.test.ts apps/whatsapp-service/src/__tests__/conversationAssistantRoutes.test.ts apps/web/src/services/__tests__/conversationAssistantApi.test.ts apps/web/src/hooks/__tests__/useWhatsAppConversationAssistant.test.tsx apps/web/src/pages/__tests__/WhatsAppConversationAssistantPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked whatsapp-service
pnpm run verify:workspace:tracked web
pnpm run verify:package-exports
```

Expected: PASS.

- [ ] **Step 3: Run full tracked CI**

Run:

```bash
set -o pipefail
pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-conversation-assistant.txt
```

Expected: PASS and output includes `CI passed`.

If it fails, run:

```bash
rg "error|FAIL" -C3 /tmp/ci-output-conversation-assistant.txt
```

Stop before commit, fix the failure, and rerun this step.

- [ ] **Step 4: Stage only Conversation Assistant files**

Run:

```bash
git status --short
git diff --name-only
git diff --cached --name-only
```

Stage only files listed in this plan, excluding existing sidebar menu files unless the user explicitly asks to include them.

After staging, run:

```bash
git diff --cached --name-only | rg '^apps/web/src/components/(Sidebar\.tsx|sidebar/)' && exit 1 || true
```

Expected: no sidebar path is staged.

- [ ] **Step 5: Commit after CI passes**

Run:

```bash
git commit -m "feat: stream conversation assistant with user keys"
```

Expected: commit succeeds only after Step 3 passes.

- [ ] **Step 6: Open PR to development**

If no `INT-XXX` issue id is available, obtain user guidance before creating a PR title/body that requires Linear cross-linking. Do not fabricate an issue id.

Before PR creation:

```bash
git switch -c codex/conversation-assistant-user-key-streaming
git fetch origin development
git merge origin/development
git push -u origin codex/conversation-assistant-user-key-streaming
```

If the branch already exists, switch to it instead of creating it.

PR target: `development`.

- [ ] **Step 7: Verify GitHub Actions**

Use `gh pr checks` on the created PR until all required checks pass. If any check fails, inspect logs, fix, rerun local verification, push, and re-check.

- [ ] **Step 8: WhatsApp report**

Use the available approved channel for WhatsApp reporting if one exists in the environment. If no WhatsApp-sending tool or safe internal workflow is available, report that exact limitation and provide the message text that would be sent.

## Plan Review Strategy

Before implementation, dispatch three dedicated review subagents:

- Backend/LLM reviewer: verify Tasks 1 to 5 cover user keys, MiniMax reasoning, context checks, streaming persistence, error paths, and endpoint contracts.
- Frontend reviewer: verify Tasks 6 and 7 cover preflight warning, stream parsing, draft replacement, markdown rendering, and scroll-follow behavior.
- Verification/config reviewer: verify Task 8 and runtime default changes cover env vars, Terraform/ecosystem wiring, package exports, CI, dirty worktree staging risk, PR target, and GitHub Actions.

Implementation proceeds only after plan-review findings are incorporated.
