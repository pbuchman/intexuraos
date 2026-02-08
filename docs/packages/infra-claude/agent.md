# Agent Reference: @intexuraos/infra-claude

## Identity

- **Package:** `@intexuraos/infra-claude`
- **Version:** 2.1.0
- **Purpose:** Anthropic Claude API wrapper implementing `LLMClient`
- **Provider constant:** `LlmProviders.Anthropic`
- **External SDK:** `@anthropic-ai/sdk` ^0.52.0

## Exports

```ts
// Factory
export function createClaudeClient(config: ClaudeConfig): ClaudeClient;

// Cost calculation
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  webSearchCalls: number,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type ClaudeClient = LLMClient;
export type { ClaudeConfig, ClaudeError, ResearchResult, GenerateResult, SynthesisInput };
```

## Key Interfaces

```ts
interface ClaudeConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
}

// ClaudeError = LLMError from @intexuraos/llm-contract
type ClaudeError = { code: LLMErrorCode; message: string };
```

## Usage Patterns

### Create client and run research

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';

const client = createClaudeClient({
  apiKey: env.INTEXURAOS_ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5',
  userId,
  pricing: modelPricing,
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
}
```

### Create client and run generation

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
    case 'RATE_LIMITED': // retry with backoff
    case 'INVALID_KEY': // configuration error
    case 'OVERLOADED': // retry after delay
    case 'TIMEOUT': // retry
    case 'API_ERROR': // log and handle
  }
}
```

## Dependencies

- `@intexuraos/common-core` -- Result types, getErrorMessage, Logger
- `@intexuraos/llm-contract` -- LLMClient interface, NormalizedUsage, TokenUsage, ModelPricing
- `@intexuraos/llm-prompts` -- buildResearchPrompt
- `@intexuraos/llm-audit` -- createAuditContext
- `@intexuraos/llm-pricing` -- createUsageLogger

## Constants

- `MAX_TOKENS`: 8192
- Web search tool: `web_search_20250305`
