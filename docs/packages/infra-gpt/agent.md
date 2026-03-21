# Agent Reference: @intexuraos/infra-gpt

## Identity

| Attribute | Value                                           |
| --------- | ----------------------------------------------- |
| Package   | `@intexuraos/infra-gpt`                         |
| Version   | 3.3.0                                           |
| Purpose   | OpenAI GPT API wrapper implementing `LLMClient` |
| Provider  | `LlmProviders.OpenAI`                           |
| SDK       | `openai` ^6.15.0                                |

## Exports

```ts
// Factory
export function createGptClient(config: GptConfig): GptClient;

// Cost calculation
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  webSearchCalls: number,
  reasoningTokens: number | undefined,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type GptClient = LLMClient;
export type {
  GptConfig,
  GptError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
};
```

## Key Interfaces

```ts
interface GptConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  imagePricing?: ModelPricing; // separate pricing for generateImage
  logger: Logger;
}

// GptError = LLMError from @intexuraos/llm-contract
type GptError = {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'CONTEXT_LENGTH' | 'TIMEOUT' | 'API_ERROR';
  message: string;
};
```

## Usage Patterns

### Research with web search

```ts
import { createGptClient } from '@intexuraos/infra-gpt';

const client = createGptClient({
  apiKey: env.INTEXURAOS_OPENAI_APP_API_KEY,
  model: 'gpt-4.1',
  userId,
  pricing: { inputPricePerMillion: 2.5, outputPricePerMillion: 10.0 },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // Uses Responses API with web_search_preview tool (medium context)
  // usage.webSearchCalls: count of web_search_call items in response.output
  // usage.cacheTokens: from input_tokens_details.cached_tokens
  // usage.reasoningTokens: from output_tokens_details.reasoning_tokens (o-series models)
}
```

### Image generation

```ts
const result = await client.generateImage('A sunset over mountains', { size: '1024x1024' });
if (result.ok) {
  // result.data: { imageData: Buffer, model: LlmModels.GPTImage1, usage: NormalizedUsage }
  // imageData: decoded from b64_json (primary) or fetched from URL (fallback — no timeout)
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED':    // 429 — retry with backoff
    case 'INVALID_KEY':     // 401 — do not retry
    case 'CONTEXT_LENGTH':  // context_length_exceeded — reduce prompt
    case 'TIMEOUT':         // retry
    case 'API_ERROR':       // log and handle
  }
}
```

## Dependencies

| Package                    | Role                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `@intexuraos/common-core`  | Result types, getErrorMessage, Logger                                      |
| `@intexuraos/llm-contract` | LLMClient, NormalizedUsage, TokenUsage, ModelPricing, LlmModels, ImageSize |
| `@intexuraos/llm-prompts`  | buildResearchPrompt                                                        |
| `@intexuraos/llm-audit`    | createAuditContext                                                         |
| `@intexuraos/llm-pricing`  | createUsageLogger                                                          |

## Constants

| Constant             | Value                 |
| -------------------- | --------------------- |
| `MAX_TOKENS`         | 8192                  |
| `IMAGE_MODEL`        | `LlmModels.GPTImage1` |
| `DEFAULT_IMAGE_SIZE` | `'1024x1024'`         |

## Constraints

**Do NOT:**

- Inject custom `auditSink` or `usageSink` — not supported (uses Firestore defaults)
- Rely on `generateImage` having a timeout on URL fetches — there is none; can hang if OpenAI CDN is unresponsive

**Requires:**

- Valid `INTEXURAOS_OPENAI_APP_API_KEY` environment variable
- `logger` field on config (mandatory, enforced by ESLint)
- `imagePricing` config for accurate `generateImage` cost tracking

## Implementation Detail

- `research()` uses `client.responses.create` (Responses API) with `{ type: 'web_search_preview', search_context_size: 'medium' }` tool. Returns `response.output_text` as content.
- `generate()` uses `client.chat.completions.create` (Chat Completions API). Both APIs require separate usage extraction since their response shapes differ (`ResponseUsage` vs `CompletionUsage`).
- `generateImage()` uses `client.images.generate` with `IMAGE_MODEL`. Prefers `b64_json`; falls back to fetching from `url` when only a URL is returned.
