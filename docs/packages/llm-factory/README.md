# @intexuraos/llm-factory

Unified factory for constructing application LLM clients.

## Routing contract

- OpenRouter model IDs use the `or:` prefix and are routed through `@intexuraos/infra-openrouter`.
- Direct Anthropic, OpenAI, and Perplexity model IDs use their provider adapters.
- Direct Google model IDs such as `gemini-2.5-flash` are rejected. Google-hosted models must use an OpenRouter ID such as `or:google/gemini-3-flash-preview`.
- Tool-calling clients are available only for the curated OpenRouter tool-calling models.

## `createLlmClient`

```ts
import { createLlmClient } from '@intexuraos/llm-factory';

const client = createLlmClient({
  apiKey: openRouterApiKey,
  model: 'or:google/gemini-3-flash-preview',
  userId,
  logger,
  usageSink,
});

const result = await client.generate('Write a concise summary.', {
  promptType: 'summary',
});
```

`createLlmClient` returns `LlmGenerateClient`. The client exposes `generate()` and may expose chat methods when the selected provider supports them.

## `createToolCallingClient`

```ts
import { createToolCallingClient } from '@intexuraos/llm-factory';

const client = createToolCallingClient({
  apiKey: openRouterApiKey,
  model: 'or:google/gemini-3-flash-preview',
  userId,
  logger,
  usageSink,
});
```

Passing a raw Google model fails with `INVALID_REQUEST`. There is no Google API-key fallback.

## Dependencies

- `@intexuraos/common-core`
- `@intexuraos/infra-claude`
- `@intexuraos/infra-gpt`
- `@intexuraos/infra-openrouter`
- `@intexuraos/infra-perplexity`
- `@intexuraos/llm-contract`
- `@intexuraos/llm-pricing`

## Source files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Public exports |
| `src/llmClientFactory.ts` | Provider routing and fail-closed direct-Google guard |
