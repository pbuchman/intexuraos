# Agent Reference: @intexuraos/infra-glm

## Identity

| Attribute | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| Package   | `@intexuraos/infra-glm`                                          |
| Version   | 2.1.0                                                            |
| Purpose   | Zai GLM API wrapper implementing `LLMClient` via OpenAI SDK      |
| Provider  | `LlmProviders.Zai`                                               |
| SDK       | `openai` ^6.15.0 (with custom baseURL)                           |
| API Base  | `https://api.z.ai/api/paas/v4/`                                  |

## Exports

```ts
// Factory
export function createGlmClient(config: GlmConfig): GlmClient;

// Cost calculation
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  webSearchCalls: number,
  reasoningTokens: number | undefined,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type GlmClient = LLMClient;
export type { GlmConfig, GlmError, ResearchResult, GenerateResult, SynthesisInput };
```

## Key Interfaces

```ts
interface GlmConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  logger: Logger;
  auditSink?: AuditSink;  // defaults to Firestore audit sink
  usageSink?: UsageSink;  // defaults to Firestore usage sink
}

// GlmError = LLMError from @intexuraos/llm-contract
type GlmError = {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'OVERLOADED' | 'CONTEXT_LENGTH' | 'TIMEOUT' | 'CONTENT_FILTERED' | 'API_ERROR';
  message: string;
};
```

## Usage Patterns

### Research with web search

```ts
import { createGlmClient } from '@intexuraos/infra-glm';

const client = createGlmClient({
  apiKey: env.INTEXURAOS_GLM_API_KEY,
  model: 'glm-4.7',
  userId,
  pricing: {
    inputPricePerMillion: 0.6,
    outputPricePerMillion: 2.2,
    webSearchCostPerCall: 0.005,
  },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // sources: extracted from web_search tool call results
  // usage.webSearchCalls: count of web_search tool invocations
  // usage.cacheTokens: present when prompt_tokens_details.cached_tokens > 0
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
    case 'RATE_LIMITED':     // 429 — retry with backoff
    case 'INVALID_KEY':      // 401 — do not retry
    case 'OVERLOADED':       // 500+ — retry after delay
    case 'CONTEXT_LENGTH':   // context_length_exceeded — reduce prompt
    case 'CONTENT_FILTERED': // sensitive/filtered — do not retry
    case 'TIMEOUT':          // retry
    case 'API_ERROR':        // log and handle
  }
}
```

## Dependencies

| Package                    | Role                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `@intexuraos/common-core`  | Result types, getErrorMessage, Logger                        |
| `@intexuraos/llm-contract` | LLMClient, NormalizedUsage, TokenUsage, ModelPricing         |
| `@intexuraos/llm-prompts`  | buildResearchPrompt                                          |
| `@intexuraos/llm-audit`    | createAuditContext, AuditSink                                |
| `@intexuraos/llm-pricing`  | createUsageLogger, UsageSink                                 |

## Constants

| Constant       | Value                              |
| -------------- | ---------------------------------- |
| `MAX_TOKENS`   | 8192                               |
| `GLM_API_BASE` | `https://api.z.ai/api/paas/v4/`    |

## Constraints

**Do NOT:**
- Call `generateImage` — not implemented on this client
- Expect OpenAI-standard tool type safety — GLM uses custom `web_search` tool via `unknown` cast
- Pass `reasoningTokens` to `normalizeUsage` as a non-undefined value — always pass `undefined` (parameter exists for API compatibility but GLM does not expose reasoning tokens)

**Requires:**
- Valid `INTEXURAOS_GLM_API_KEY` environment variable
- `logger` field on config (mandatory, enforced by ESLint)

## Implementation Detail

Uses `openai` SDK with `baseURL: GLM_API_BASE`. The GLM `web_search` tool type is not part of OpenAI's type definitions and is cast through `unknown` at the call site. Source URLs are extracted from `toolCall.web_search.search_result[].link` in the response.
