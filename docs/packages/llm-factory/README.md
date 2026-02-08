# @intexuraos/llm-factory

Unified factory for creating LLM clients across different providers. Maps model identifiers to the correct provider-specific client implementation, allowing apps to switch LLM providers without changing application code.

**Version:** 2.1.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-gemini`, `@intexuraos/infra-glm`, `@intexuraos/llm-contract`, `@intexuraos/llm-pricing`

## Why It Exists

IntexuraOS supports multiple LLM providers (Google Gemini, Zai GLM, and others via separate client packages). Each provider has its own client constructor with different configuration requirements. The factory abstracts this away: callers pass a model name and configuration, and the factory returns the correct client. This keeps provider selection logic in one place rather than scattered across every agent app.

## API Reference

### `createLlmClient(config: LlmClientConfig): LlmGenerateClient`

Maps a model to its provider and creates the appropriate client.

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
  console.log(result.value.content);
  console.log(`Cost: $${String(result.value.usage.costUsd)}`);
}
```

**Supported providers:**

| Provider | Models Created                                                                     | Client Package             |
| -------- | ---------------------------------------------------------------------------------- | -------------------------- |
| Google   | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash-image` | `@intexuraos/infra-gemini` |
| Zai      | `glm-4.7`, `glm-4.7-flash`                                                         | `@intexuraos/infra-glm`    |

**Unsupported providers** (not routed through this factory):
- Anthropic (Claude) -- handled via separate client setup
- OpenAI (GPT) -- handled via separate client setup
- Perplexity (Sonar) -- handled via separate client setup

Calling `createLlmClient` with an unsupported provider model throws an `Error` with message `"Unsupported LLM provider: {provider}"`.

### `isSupportedProvider(provider: string): provider is SupportedProvider`

Type guard that checks if a provider string is supported by this factory.

```typescript
import { isSupportedProvider } from '@intexuraos/llm-factory';

if (isSupportedProvider('google')) {
  // TypeScript narrows to 'google' | 'zai'
}

isSupportedProvider('anthropic'); // false
isSupportedProvider('openai');    // false
```

### Types

```typescript
interface LlmClientConfig {
  apiKey: string;
  model: LLMModel;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
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

The factory also re-exports `LLMError` from `@intexuraos/llm-contract` for convenience.

## Used By

**Packages (1):** `internal-clients`

**Apps (10):** `actions-agent`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `linear-agent`, `research-agent`, `todos-agent`, `web-agent`

## Recent Changes

| Commit   | Description                                          | Age     |
| -------- | ---------------------------------------------------- | ------- |
| 44017d5c | Fix ESLint OOM with batched parallel lint runner     | 7 days  |
| 21c1528a | Fix release skill to bump all package versions       | 12 days |
| 4fa0fed3 | Release v2.0.0                                       | 2 weeks |
| 8aad9098 | Migrate imports and delete llm-common                | 2 weeks |
| 6ec4205e | Make logger mandatory in all LLM configs             | 3 weeks |
| 7d2b5a9f | Add getLlmClient implementation for commands-agent   | 4 weeks |
| 0d1f115e | Fix pricing endpoint to include zai provider         | 4 weeks |

## Source Files

| File                         | Purpose                                           |
| ---------------------------- | ------------------------------------------------- |
| `src/index.ts`               | Re-exports factory function, types, and guard     |
| `src/llmClientFactory.ts`    | Factory implementation with exhaustive switch     |
