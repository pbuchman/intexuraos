# Agent Reference: @intexuraos/infra-gpt

## Identity

- **Package:** `@intexuraos/infra-gpt`
- **Version:** 2.1.0
- **Purpose:** OpenAI GPT API wrapper implementing `LLMClient`
- **Provider constant:** `LlmProviders.OpenAI`
- **External SDK:** `openai` ^6.15.0

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
  imagePricing?: ModelPricing;
  logger: Logger;
}

// GptError = LLMError from @intexuraos/llm-contract
type GptError = { code: LLMErrorCode; message: string };
```

## Usage Patterns

### Create client and run research

```ts
import { createGptClient } from '@intexuraos/infra-gpt';

const client = createGptClient({
  apiKey: env.INTEXURAOS_OPENAI_API_KEY,
  model: 'gpt-4.1',
  userId,
  pricing: { inputPricePerMillion: 2.5, outputPricePerMillion: 10.0 },
  logger,
});

const result = await client.research('query');
if (result.ok) {
  // result.data: { content: string, sources: string[], usage: NormalizedUsage }
}
```

### Generate image

```ts
const result = await client.generateImage?.('A sunset over mountains', { size: '1024x1024' });
if (result?.ok) {
  // result.data: { imageData: Buffer, model: 'gpt-image-1', usage: NormalizedUsage }
}
```

### Error handling

```ts
if (!result.ok) {
  switch (result.error.code) {
    case 'RATE_LIMITED': // 429
    case 'INVALID_KEY': // 401
    case 'CONTEXT_LENGTH': // context_length_exceeded
    case 'TIMEOUT': // timeout
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

- `MAX_TOKENS`: 8192
- `IMAGE_MODEL`: `LlmModels.GPTImage1`
- `DEFAULT_IMAGE_SIZE`: `'1024x1024'`

## Implementation Detail

- `research()` uses the OpenAI Responses API (`client.responses.create`) with `web_search_preview` tool
- `generate()` uses the Chat Completions API (`client.chat.completions.create`)
- `generateImage()` uses `client.images.generate` with `gpt-image-1`; supports both base64 and URL response formats
- Extracts `reasoning_tokens` from `output_tokens_details` for o-series models
