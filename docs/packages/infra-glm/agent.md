# Agent Reference: @intexuraos/infra-glm

## Identity

- **Package:** `@intexuraos/infra-glm`
- **Version:** 2.1.0
- **Purpose:** Zai GLM API wrapper implementing `LLMClient` via OpenAI SDK
- **Provider constant:** `LlmProviders.Zai`
- **External SDK:** `openai` ^6.15.0 (with custom baseURL)
- **API Base:** `https://api.z.ai/api/paas/v4/`

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
  auditSink?: AuditSink; // optional, defaults to Firestore audit sink
  usageSink?: UsageSink; // optional, defaults to Firestore usage sink
}

// GlmError = LLMError from @intexuraos/llm-contract
type GlmError = { code: LLMErrorCode; message: string };
```

## Usage Patterns

### Create client and run research

```ts
import { createGlmClient } from '@intexuraos/infra-glm';

const client = createGlmClient({
  apiKey: env.INTEXURAOS_GLM_API_KEY,
  model: 'glm-4.7',
  userId,
  pricing: { inputPricePerMillion: 0.6, outputPricePerMillion: 2.2, webSearchCostPerCall: 0.005 },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
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
    case 'RATE_LIMITED': // 429
    case 'INVALID_KEY': // 401
    case 'OVERLOADED': // 500+
    case 'CONTEXT_LENGTH': // context_length_exceeded
    case 'CONTENT_FILTERED': // sensitive/filtered content
    case 'TIMEOUT': // timeout
    case 'API_ERROR': // general error
  }
}
```

## Dependencies

- `@intexuraos/common-core` -- Result types, getErrorMessage, Logger
- `@intexuraos/llm-contract` -- LLMClient, NormalizedUsage, TokenUsage, ModelPricing
- `@intexuraos/llm-prompts` -- buildResearchPrompt
- `@intexuraos/llm-audit` -- createAuditContext, AuditSink
- `@intexuraos/llm-pricing` -- createUsageLogger, UsageSink

## Constants

- `MAX_TOKENS`: 8192
- `GLM_API_BASE`: `https://api.z.ai/api/paas/v4/`

## Implementation Detail

Uses `openai` SDK with `baseURL: GLM_API_BASE` to communicate with Zai's OpenAI-compatible API. Web search is a custom tool type (`type: 'web_search'`) not part of OpenAI's type definitions.
