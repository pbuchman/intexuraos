# @intexuraos/llm-contract

Common types and interfaces for LLM client implementations.

This package defines the shared contract that all LLM provider implementations
(Claude, GPT, Gemini, Perplexity) must follow.

## Core Types

### `LLMClient`

The interface that all LLM clients implement:

```ts
interface LLMClient {
  research(prompt: string): Promise<Result<ResearchResult, LLMError>>;
  generate(prompt: string): Promise<Result<GenerateResult, LLMError>>;
  generateImage?(prompt: string, options?: ImageGenerateOptions): Promise<Result<ImageGenerationResult, LLMError>>;
}
```

### `LLMErrorCode`

Error codes returned by all providers:

| Code | Description | Action |
|------|-------------|--------|
| API_ERROR | General API error | Check message for details |
| TIMEOUT | Request timed out | Retry with backoff |
| INVALID_KEY | API key invalid | Check configuration |
| RATE_LIMITED | Rate limit exceeded | Implement backoff |
| OVERLOADED | Provider overloaded | Retry after delay |
| CONTEXT_LENGTH | Prompt too long | Truncate prompt |
| CONTENT_FILTERED | Content filtered | Modify content |

### `NormalizedUsage`

Standardized usage information across all providers:

```ts
interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  cacheTokens?: number;
  reasoningTokens?: number;
  webSearchCalls?: number;
  groundingEnabled?: boolean;
}
```

### `ModelPricing`

Pricing configuration for cost calculation:

```ts
interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<ImageSize, number>>;
}
```

## Result Types

All client methods return a `Result<T, E>` type:

```ts
// Success
{ ok: true, data: T }

// Failure
{ ok: false, error: E }
```

## Usage Pattern

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';
import type { LLMClient } from '@intexuraos/llm-contract';

function processWithLLM(client: LLMClient, prompt: string) {
  const result = await client.generate(prompt);
  if (result.ok) {
    return result.data.content;
  }
  // Handle error based on result.error.code
  throw new Error(result.error.message);
}
```

## Supported Models

See `supportedModels.ts` for the full list of supported model identifiers.
