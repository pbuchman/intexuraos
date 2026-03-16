# Agent Reference: @intexuraos/infra-perplexity

## Identity

- **Package:** `@intexuraos/infra-perplexity`
- **Version:** 3.3.0
- **Purpose:** Perplexity AI API wrapper implementing `research` and `generate` from `LLMClient`
- **Provider constant:** `LlmProviders.Perplexity`
- **External SDK:** None (raw `fetch` with SSE streaming)
- **API Base:** `https://api.perplexity.ai`

## Exports

```ts
// Factory
export function createPerplexityClient(config: PerplexityConfig): PerplexityClient;

// Cost calculation
export function calculateTextCost(
  usage: TokenUsage,
  pricing: ModelPricing,
  providerCost: number | undefined
): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  providerCost: number | undefined,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type PerplexityClient = Pick<LLMClient, 'research' | 'generate'>;
export type { PerplexityConfig, PerplexityError, ResearchResult, GenerateResult };
```

## Key Interfaces

```ts
interface PerplexityConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  timeoutMs?: number; // Default: 840000 (14 minutes)
  logger: Logger;
}

// PerplexityError = LLMError from @intexuraos/llm-contract
type PerplexityError = { code: LLMErrorCode; message: string };
```

## Usage Patterns

### Create client and run research (SSE streamed)

```ts
import { createPerplexityClient } from '@intexuraos/infra-perplexity';

const client = createPerplexityClient({
  apiKey: env.INTEXURAOS_PERPLEXITY_API_KEY,
  model: 'sonar-pro',
  userId,
  pricing: { inputPricePerMillion: 1.0, outputPricePerMillion: 1.0 },
  timeoutMs: 840000,
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // sources = citation URLs from Perplexity
}
```

### Text generation (buffered JSON)

```ts
const result = await client.generate('prompt');
if (result.ok) {
  // result.data: { content: string, usage: NormalizedUsage }
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED': // 429
    case 'INVALID_KEY': // 401
    case 'OVERLOADED': // 503
    case 'TIMEOUT': // AbortError or timeout-like messages
    case 'API_ERROR': // general error
  }
}
```

## Dependencies

- `@intexuraos/common-core` -- Result types, getErrorMessage, Logger
- `@intexuraos/llm-contract` -- LLMClient, NormalizedUsage, TokenUsage, ModelPricing, LlmModels
- `@intexuraos/llm-prompts` -- buildResearchPrompt
- `@intexuraos/llm-audit` -- createAuditContext
- `@intexuraos/llm-pricing` -- createUsageLogger

## Constants

- `API_BASE_URL`: `https://api.perplexity.ai`
- `DEFAULT_TIMEOUT_MS`: 840000 (14 minutes)
- `MAX_TOKENS`: 8192

## Implementation Detail

- `research()` uses `stream: true` with SSE parsing to prevent idle timeouts on deep research models
- `generate()` uses standard buffered JSON response
- Cost calculation prioritizes provider-reported cost (`usage.cost.total_cost`), falls back to token-based calculation
- Search context size is auto-mapped: sonar=low, sonar-pro=medium, sonar-deep-research=high
- `webSearchCalls` is always 1 (every Perplexity request involves search)
