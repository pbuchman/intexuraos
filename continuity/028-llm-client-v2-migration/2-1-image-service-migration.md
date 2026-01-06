# 2-1: Migrate image-service

## Status: ✅ DONE

## Tier: 2 (Service-level)

## Context

image-service has 3 places using LLM clients:
1. `OpenAIImageGenerator` — uses `createGptClient` for image generation
2. `GoogleImageGenerator` — uses `createGeminiClient` for image generation  
3. `GptPromptAdapter` — uses `createGptClient` for thumbnail prompt generation

All need `pricing` parameter (and `imagePricing` for image generators).

## Scope

**Files to MODIFY:**
- apps/image-service/src/infra/image/OpenAIImageGenerator.ts
- apps/image-service/src/infra/image/GoogleImageGenerator.ts
- apps/image-service/src/infra/llm/GptPromptAdapter.ts

**Tests to MODIFY:**
- apps/image-service/src/__tests__/infra/OpenAIImageGenerator.test.ts
- apps/image-service/src/__tests__/infra/GoogleImageGenerator.test.ts

## OpenAIImageGenerator Changes

### Current:
```typescript
export interface OpenAIImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  userId: string;
  generateId?: () => string;
}

// In generate():
const client = createGptClient({
  apiKey: this.apiKey,
  model: this.model,
  userId: this.userId,
});
```

### Target:
```typescript
import type { ModelPricing } from '@intexuraos/llm-contract';

export interface OpenAIImageGeneratorConfig {
  apiKey: string;
  model: ImageGenerationModel;
  storage: ImageStorage;
  userId: string;
  pricing: ModelPricing;        // text pricing
  imagePricing: ModelPricing;   // image pricing (with imagePricing field)
  generateId?: () => string;
}

// In generate():
const client = createGptClient({
  apiKey: this.apiKey,
  model: this.model,
  userId: this.userId,
  pricing: this.pricing,
  imagePricing: this.imagePricing,
});
```

## GoogleImageGenerator Changes

Same pattern as OpenAIImageGenerator but using `createGeminiClient`.

## GptPromptAdapter Changes

### Current:
```typescript
export interface GptPromptAdapterConfig {
  apiKey: string;
  userId: string;
  model?: string;
}

const client = createGptClient({
  apiKey: this.apiKey,
  model: this.model,
  userId: this.userId,
});
```

### Target:
```typescript
import type { ModelPricing } from '@intexuraos/llm-contract';

export interface GptPromptAdapterConfig {
  apiKey: string;
  userId: string;
  model?: string;
  pricing: ModelPricing;
}

const client = createGptClient({
  apiKey: this.apiKey,
  model: this.model,
  userId: this.userId,
  pricing: this.pricing,
});
```

## Steps

### OpenAIImageGenerator:
- [ ] Add `ModelPricing` import
- [ ] Add `pricing` and `imagePricing` to config interface
- [ ] Store in constructor
- [ ] Pass to `createGptClient`

### GoogleImageGenerator:
- [ ] Add `ModelPricing` import
- [ ] Add `pricing` and `imagePricing` to config interface
- [ ] Store in constructor
- [ ] Pass to `createGeminiClient`

### GptPromptAdapter:
- [ ] Add `ModelPricing` import
- [ ] Add `pricing` to config interface
- [ ] Store in constructor
- [ ] Pass to `createGptClient`

### Tests:
- [ ] Update `OpenAIImageGenerator.test.ts` mock config with pricing
- [ ] Update `GoogleImageGenerator.test.ts` mock config with pricing
- [ ] Use test fixtures for pricing values

### Bootstrap/Factory:
- [ ] Locate where generators/adapters are instantiated
- [ ] Add pricing fetch from Firestore
- [ ] Pass pricing to constructors

## Definition of Done

- [ ] All 3 files accept and pass `pricing`
- [ ] Image generators also handle `imagePricing`
- [ ] Tests pass
- [ ] `npm run test -w @intexuraos/image-service` passes

## Verification

```bash
npm run test -w @intexuraos/image-service
npm run lint -w @intexuraos/image-service
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 2-2-user-service-migration.md.

