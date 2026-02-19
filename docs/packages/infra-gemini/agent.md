# Agent Reference: @intexuraos/infra-gemini

## Identity

| Attribute | Value                                              |
| --------- | -------------------------------------------------- |
| Package   | `@intexuraos/infra-gemini`                         |
| Version   | 2.1.0                                              |
| Purpose   | Google Gemini API wrapper implementing `LLMClient` |
| Provider  | `LlmProviders.Google`                              |
| SDK       | `@google/genai` ^1.0.0                             |

## Exports

```ts
// Factory
export function createGeminiClient(config: GeminiConfig): GeminiClient;

// Cost calculation
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  groundingEnabled: boolean,
  pricing: ModelPricing
): NormalizedUsage;

// Types
export type GeminiClient = LLMClient;
export type {
  GeminiConfig,
  GeminiError,
  ResearchResult,
  GenerateResult,
  ImageGenerationResult,
  ImageGenerateOptions,
  SynthesisInput,
};
```

## Key Interfaces

```ts
interface GeminiConfig {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  imagePricing?: ModelPricing; // separate pricing for generateImage
  logger: Logger;
  auditSink?: AuditSink; // defaults to Firestore audit sink
  usageSink?: UsageSink; // defaults to Firestore usage sink
}

// GeminiError = LLMError from @intexuraos/llm-contract
type GeminiError = {
  code: 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_FILTERED' | 'API_ERROR';
  message: string;
};
```

## Usage Patterns

### Research with Google Search grounding

```ts
import { createGeminiClient } from '@intexuraos/infra-gemini';

const client = createGeminiClient({
  apiKey: env.INTEXURAOS_GOOGLE_API_KEY,
  model: 'gemini-2.5-flash',
  userId,
  pricing: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    groundingCostPerRequest: 0.002,
  },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
  // sources: extracted from groundingMetadata.groundingChunks[].web.uri
  // usage.groundingEnabled: true when Google Search was active
}
```

### Image generation

```ts
const result = await client.generateImage?.('A sunset over mountains', { size: '1024x1024' });
if (result?.ok) {
  // result.data: { imageData: Buffer, model: 'gemini-2.5-flash-preview-04-17', usage: NormalizedUsage }
  // imageData decoded from base64 inlineData
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED': // quota exceeded — retry with backoff
    case 'CONTENT_FILTERED': // safety filter — do not retry
    case 'INVALID_KEY': // bad API key — do not retry
    case 'TIMEOUT': // retry
    case 'API_ERROR': // log and handle
  }
}
```

## Dependencies

| Package                    | Role                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `@intexuraos/common-core`  | Result types, getErrorMessage, Logger                                      |
| `@intexuraos/llm-contract` | LLMClient, NormalizedUsage, TokenUsage, ModelPricing, LlmModels, ImageSize |
| `@intexuraos/llm-prompts`  | buildResearchPrompt                                                        |
| `@intexuraos/llm-audit`    | createAuditContext, AuditSink                                              |
| `@intexuraos/llm-pricing`  | createUsageLogger, UsageSink                                               |

## Constants

| Constant             | Value                          |
| -------------------- | ------------------------------ |
| `IMAGE_MODEL`        | `LlmModels.Gemini25FlashImage` |
| `DEFAULT_IMAGE_SIZE` | `'1024x1024'`                  |

## Constraints

**Do NOT:**

- Expect `reasoning_tokens` in usage — Gemini does not expose reasoning tokens
- Pass a custom image model via config — `IMAGE_MODEL` is hardcoded
- Expect `cacheTokens` in usage — Gemini does not report prompt cache token details

**Requires:**

- Valid `INTEXURAOS_GOOGLE_API_KEY` environment variable
- `logger` field on config (mandatory, enforced by ESLint)
- `imagePricing` config for accurate `generateImage` cost tracking
