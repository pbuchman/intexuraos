# Agent Reference: @intexuraos/infra-gemini

## Identity

- **Package:** `@intexuraos/infra-gemini`
- **Version:** 2.1.0
- **Purpose:** Google Gemini API wrapper implementing `LLMClient`
- **Provider constant:** `LlmProviders.Google`
- **External SDK:** `@google/genai` ^1.0.0

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
  imagePricing?: ModelPricing;
  logger: Logger;
}

// GeminiError = LLMError from @intexuraos/llm-contract
type GeminiError = { code: LLMErrorCode; message: string };
```

## Usage Patterns

### Create client and run research with grounding

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
  // usage.groundingEnabled will be true
}
```

### Generate image

```ts
const result = await client.generateImage?.('A sunset over mountains', { size: '1024x1024' });
if (result?.ok) {
  // result.data: { imageData: Buffer, model: string, usage: NormalizedUsage }
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED': // quota exceeded
    case 'CONTENT_FILTERED': // safety filter
    case 'INVALID_KEY': // bad API key
    case 'TIMEOUT': // request timeout
    case 'API_ERROR': // general error
  }
}
```

## Dependencies

- `@intexuraos/common-core` -- Result types, getErrorMessage, Logger
- `@intexuraos/llm-contract` -- LLMClient, NormalizedUsage, TokenUsage, ModelPricing, LlmModels, ImageSize
- `@intexuraos/llm-prompts` -- buildResearchPrompt
- `@intexuraos/llm-audit` -- createAuditContext
- `@intexuraos/llm-pricing` -- createUsageLogger

## Constants

- `IMAGE_MODEL`: `LlmModels.Gemini25FlashImage`
- `DEFAULT_IMAGE_SIZE`: `'1024x1024'`
