# Agent Reference: @intexuraos/infra-claude

## Identity

| Attribute | Value                                                 |
| --------- | ----------------------------------------------------- |
| Package   | `@intexuraos/infra-claude`                            |
| Version   | 3.3.0                                                 |
| Purpose   | Anthropic Claude API wrapper implementing `LLMClient` |
| Provider  | `LlmProviders.Anthropic`                              |
| SDK       | `@anthropic-ai/sdk` ^0.52.0                           |

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
// LLMErrorCode: 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED' | 'TIMEOUT' | 'API_ERROR'
```

## Usage Patterns

### Research with web search

```ts
import { createClaudeClient } from '@intexuraos/infra-claude';

const client = createClaudeClient({
  apiKey: env.INTEXURAOS_ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5',
  userId,
  pricing: {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.0035,
  },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // usage.cacheTokens: present when prompt caching was active
  // usage.webSearchCalls: count of web_search tool invocations
}
```

### Text generation

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
    case 'INVALID_KEY':  // configuration error — do not retry
    case 'OVERLOADED':   // retry after delay
    case 'TIMEOUT':      // retry
    case 'API_ERROR':    // log and handle
  }
}
```

## Dependencies

| Package                    | Role                                                 |
| -------------------------- | ---------------------------------------------------- |
| `@intexuraos/common-core`  | Result types, getErrorMessage, Logger                |
| `@intexuraos/llm-contract` | LLMClient, NormalizedUsage, TokenUsage, ModelPricing |
| `@intexuraos/llm-prompts`  | buildResearchPrompt                                  |
| `@intexuraos/llm-audit`    | createAuditContext                                   |
| `@intexuraos/llm-pricing`  | createUsageLogger                                    |

## Constants

| Constant        | Value                 |
| --------------- | --------------------- |
| `MAX_TOKENS`    | 8192                  |
| Web search tool | `web_search_20250305` |

## Constraints

**Do NOT:**

- Call `generateImage` — not implemented (method does not exist on this client)
- Inject custom `auditSink` or `usageSink` — not supported (uses Firestore defaults)
- Expect `reasoning_tokens` in usage — Claude does not expose reasoning tokens

**Requires:**

- Valid `INTEXURAOS_ANTHROPIC_API_KEY` environment variable
- `logger` field on config (mandatory, enforced by ESLint)
