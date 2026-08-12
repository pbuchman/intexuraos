# @intexuraos/llm-factory — Agent Reference

## Contract

| Export | Purpose |
| --- | --- |
| `createLlmClient(config)` | Construct a generate client for an allowed provider/model |
| `createToolCallingClient(config)` | Construct an OpenRouter tool-calling client |
| `isSupportedProvider(provider)` | Validate application-supported providers |

## Required rules

1. Route Google-hosted models through an `or:google/...` OpenRouter identifier.
2. Never pass a raw `gemini-*` model; the factory rejects it with `INVALID_REQUEST`.
3. Use `INTEXURAOS_OPENROUTER_APP_API_KEY` for platform-owned calls.
4. Pass a `UsageSink` and a stable `promptType` for usage attribution.

## Example

```ts
const client = createLlmClient({
  apiKey: openRouterApiKey,
  model: 'or:google/gemini-3-flash-preview',
  userId,
  logger,
  usageSink,
});

const result = await client.generate(prompt, { promptType: 'feature-operation' });
```

## Dependencies

The factory depends on the Claude, GPT, OpenRouter, and Perplexity provider adapters. The direct Google adapter has been removed.
