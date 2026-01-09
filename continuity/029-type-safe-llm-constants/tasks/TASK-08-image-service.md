# TASK-08: Migrate image-service App

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded model and provider strings with constants in image-service. Update local type definitions to use individual types.

## Files to Modify

### 1. `apps/image-service/src/domain/models/ImageGenerationModel.ts`

**Update type definition:**

```typescript
// FROM:
export type ImageGenerationModel = 'gpt-image-1' | 'gemini-2.5-flash-image';

// TO:
import type { GPTImage1, Gemini25FlashImage } from '@intexuraos/llm-contract';
export type ImageGenerationModel = GPTImage1 | Gemini25FlashImage;
```

**Update IMAGE_GENERATION_MODELS:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export const IMAGE_GENERATION_MODELS: Record<ImageGenerationModel, ImageModelConfig> = {
  [LlmModels.GPTImage1]: { provider: LlmProviders.OpenAI, modelId: LlmModels.GPTImage1 },
  [LlmModels.Gemini25FlashImage]: {
    provider: LlmProviders.Google,
    modelId: LlmModels.Gemini25FlashImage,
  },
};
```

### 2. `apps/image-service/src/domain/models/ImagePromptModel.ts`

**Update type definition:**

```typescript
// FROM:
export type ImagePromptModel = 'gpt-4.1' | 'gemini-2.5-pro';

// TO:
import type { Gemini25Pro } from '@intexuraos/llm-contract';
// Note: gpt-4.1 is not in our LLMModel - need to verify if this is correct or should be GPT4oMini
export type ImagePromptModel = 'gpt-4.1' | Gemini25Pro;
```

**Update IMAGE_PROMPT_MODELS:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

export const IMAGE_PROMPT_MODELS: Record<ImagePromptModel, ImageModelConfig> = {
  'gpt-4.1': { provider: LlmProviders.OpenAI, modelId: 'gpt-4.1' },
  [LlmModels.Gemini25Pro]: { provider: LlmProviders.Google, modelId: LlmModels.Gemini25Pro },
};
```

### 3. `apps/image-service/src/index.ts`

**Update REQUIRED_MODELS:**

```typescript
import {
  LlmModels,
  type ImageModel,
  type FastModel,
  type ValidationModel,
} from '@intexuraos/llm-contract';

const REQUIRED_MODELS: (ImageModel | FastModel | ValidationModel)[] = [
  LlmModels.Gemini25Flash, // Prompt generation
  LlmModels.GPT4oMini, // Prompt generation
  LlmModels.GPTImage1, // Image generation
  LlmModels.Gemini25FlashImage, // Image generation
];
```

### 4. `apps/image-service/src/services.ts`

**Update pricing lookups:**

```typescript
import { LlmModels } from '@intexuraos/llm-contract';

// FROM:
const geminiPricing = pricingContext.getPricing('gemini-2.5-flash');
const gptPricing = pricingContext.getPricing('gpt-4o-mini');
const openaiImagePricing = pricingContext.getPricing('gpt-image-1');
const googleImagePricing = pricingContext.getPricing('gemini-2.5-flash-image');

// TO:
const geminiPricing = pricingContext.getPricing(LlmModels.Gemini25Flash);
const gptPricing = pricingContext.getPricing(LlmModels.GPT4oMini);
const openaiImagePricing = pricingContext.getPricing(LlmModels.GPTImage1);
const googleImagePricing = pricingContext.getPricing(LlmModels.Gemini25FlashImage);
```

### 5. `apps/image-service/src/infra/llm/GeminiPromptAdapter.ts`

**Update DEFAULT_MODEL:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

// FROM:
const DEFAULT_MODEL = 'gemini-2.5-pro';

// TO:
const DEFAULT_MODEL = LlmModels.Gemini25Pro;

// Also update provider:
// FROM: provider: 'google'
// TO: provider: LlmProviders.Google
```

### 6. `apps/image-service/src/infra/image/GoogleImageGenerator.ts`

**Update model constant:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

// FROM:
model: 'gemini-2.5-flash-image',

// TO:
model: LlmModels.Gemini25FlashImage,

// FROM: provider: 'google'
// TO: provider: LlmProviders.Google
```

### 7. `apps/image-service/src/routes/schemas/imageSchemas.ts`

**Update enum values:**

```typescript
import { LlmModels } from '@intexuraos/llm-contract';

// FROM:
enum: ['gpt-image-1', 'gemini-2.5-flash-image'],

// TO:
enum: [LlmModels.GPTImage1, LlmModels.Gemini25FlashImage],
```

### 8. `apps/image-service/src/routes/schemas/promptSchemas.ts`

**Update enum values:**

```typescript
import { LlmModels } from '@intexuraos/llm-contract';

// FROM:
enum: ['gpt-4.1', 'gemini-2.5-pro'],

// TO:
enum: ['gpt-4.1', LlmModels.Gemini25Pro],
```

## Validation

```bash
npm run typecheck -w @intexuraos/image-service
```

## Acceptance Criteria

- [ ] ImageGenerationModel uses individual types
- [ ] No hardcoded model strings in source files
- [ ] No hardcoded provider strings in source files
- [ ] Typecheck passes

## Note

The `gpt-4.1` model appears in image-service but is not in `ALL_LLM_MODELS`. This needs investigation - it may be a deprecated model or a typo. If it should be `gpt-4o-mini`, update accordingly.
