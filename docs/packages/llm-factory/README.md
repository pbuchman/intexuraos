# @intexuraos/llm-factory

Unified factory for creating LLM clients across different providers. Maps model identifiers to the correct provider-specific client implementation, allowing apps to switch LLM providers without changing application code.

**Version:** 3.3.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-gemini`, `@intexuraos/llm-audit`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`

## Why It Exists

IntexuraOS supports multiple LLM providers. Each provider has its own client constructor with different configuration requirements. The factory abstracts this away: callers pass a model name and configuration, and the factory returns the correct client. This keeps provider selection logic in one place rather than scattered across every agent app.

## API Reference

### `createLlmClient(config: LlmClientConfig): LlmGenerateClient`

Maps a model to its provider and creates the appropriate client. Currently routes Google (Gemini) models only — Anthropic, OpenAI, and Perplexity models are not routed through this factory and will throw.

```typescript
import { createLlmClient } from '@intexuraos/llm-factory';

const client = createLlmClient({
  apiKey: 'sk-...',
  model: 'gemini-2.5-flash',
  userId: 'user-123',
  pricing: { inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 },
  logger: pinoLogger,
});

const result = await client.generate('Write a poem');
if (result.ok) {
  console.log(result.data.content);
  console.log(`Cost: $${String(result.data.usage.costUsd)}`);
}
```

**Supported providers:**

| Provider | Models Supported                                                                   | Client Package             |
| -------- | ---------------------------------------------------------------------------------- | -------------------------- |
| Google   | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash-image` | `@intexuraos/infra-gemini` |

**Unsupported providers** (not routed through this factory):

- Anthropic (Claude) — configured via separate client setup in each app
- OpenAI (GPT) — configured via separate client setup in each app
- Perplexity (Sonar) — configured via separate client setup in each app

Calling `createLlmClient` with a non-Google model throws `Error("Unsupported LLM provider: {provider}. Only google is supported.")`.

### `createToolCallingClient(config: ToolCallingClientConfig): ToolCallingClient`

Creates a tool-calling agent loop client. Currently supports Google (Gemini) only, routed through `infra-gemini`.

```typescript
import { createToolCallingClient } from '@intexuraos/llm-factory';

const client = createToolCallingClient({
  model: 'gemini-2.5-flash',
  apiKey: process.env.GOOGLE_API_KEY,
  userId: 'user-123',
  pricing: pricingContext.getPricing('gemini-2.5-flash'),
  logger,
  tools: [myTool],
});

const result = await client.run({
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Do the thing' }],
  tools: [myTool],
  maxIterations: 10,
});
```

### `isSupportedProvider(provider: string): provider is SupportedProvider`

Type guard that checks whether a provider is supported by this factory.

```typescript
import { isSupportedProvider } from '@intexuraos/llm-factory';

isSupportedProvider('google');     // true
isSupportedProvider('anthropic');  // false
isSupportedProvider('openai');     // false
```

### Types

```typescript
interface LlmClientConfig {
  apiKey: string;
  model: LLMModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;  // from @intexuraos/llm-audit; defaults to Firestore sink
  usageSink?: UsageSink;  // from @intexuraos/llm-pricing; defaults to Firestore sink
}

interface GenerateResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
}

interface LlmGenerateClient {
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
}
```

`ToolCallingClientConfig` is re-exported from `@intexuraos/infra-gemini`.

## Used By

**Packages (1):** `internal-clients`

**Apps (10):** `actions-agent`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

**Workers (1):** `orchestrator`

## Known Limitations

- Only Google (Gemini) models are routed through this factory. Claude, GPT, and Perplexity clients are constructed independently in each app.
- `LlmGenerateClient` only exposes `generate()`. Callers needing `research()` or `generateImage()` must bypass the factory or cast to the full `LLMClient` interface from `llm-contract`.

## Recent Changes

| Commit    | Description                                             | Age     |
| --------- | ------------------------------------------------------- | ------- |
| c4e3a13cb | Release v3.3.0                                          | 2 hours |
| e4d231053 | Remove ZAI provider and GLM-4.7 models                  | 3 days  |
| 293426524 | Add `createToolCallingClient` for GitHub Agent          | 7 days  |
| 44ae683ae | Release v3.2.0                                          | 8 days  |

## Source Files

| File                      | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `src/index.ts`            | Re-exports factory functions, types, and `isSupportedProvider` |
| `src/llmClientFactory.ts` | `createLlmClient`, `createToolCallingClient`, provider routing |
