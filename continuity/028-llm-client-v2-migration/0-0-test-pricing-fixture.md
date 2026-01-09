# 0-0: Create Shared Test Pricing Fixture

## Status: ✅ DONE

## Tier: 0 (Setup)

## Context

All services and tests will need mock pricing data. Create a shared fixture in llm-contract to avoid duplication. Values match migration 012 structure (with DALL-E 3 removed per migration 013).

## Scope

- packages/llm-contract/src/**tests**/fixtures/pricing.ts (NEW)
- packages/llm-contract/src/**tests**/fixtures/index.ts (NEW)

## Non-Scope

- No changes to production code
- No changes to existing tests yet

## Implementation

```typescript
// packages/llm-contract/src/__tests__/fixtures/pricing.ts
import type { ModelPricing } from '../../pricing.js';

export const TEST_GOOGLE_PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-pro': {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10.0,
    groundingCostPerRequest: 0.035,
  },
  'gemini-2.5-flash': {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
    groundingCostPerRequest: 0.035,
  },
  'gemini-2.0-flash': {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    groundingCostPerRequest: 0.035,
  },
  'gemini-2.5-flash-image': {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricing: { '1024x1024': 0.03, '1536x1024': 0.04, '1024x1536': 0.04 },
  },
};

export const TEST_OPENAI_PRICING: Record<string, ModelPricing> = {
  'o4-mini-deep-research': {
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    cacheReadMultiplier: 0.25,
    webSearchCostPerCall: 0.01,
  },
  'gpt-5.2': { inputPricePerMillion: 1.75, outputPricePerMillion: 14.0, cacheReadMultiplier: 0.1 },
  'gpt-4o-mini': {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cacheReadMultiplier: 0.5,
  },
  'gpt-image-1': {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    imagePricing: { '1024x1024': 0.04, '1536x1024': 0.08, '1024x1536': 0.08 },
  },
};

export const TEST_ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-5-20251101': {
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.03,
  },
  'claude-sonnet-4-5-20250929': {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
    webSearchCostPerCall: 0.03,
  },
  'claude-3-5-haiku-20241022': {
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
  },
};

export const TEST_PERPLEXITY_PRICING: Record<string, ModelPricing> = {
  sonar: { inputPricePerMillion: 1.0, outputPricePerMillion: 1.0, useProviderCost: true },
  'sonar-pro': { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0, useProviderCost: true },
  'sonar-deep-research': {
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    useProviderCost: true,
  },
};

/** Helper to get pricing for a specific model */
export function getTestPricing(
  provider: 'google' | 'openai' | 'anthropic' | 'perplexity',
  model: string
): ModelPricing {
  const pricingMap = {
    google: TEST_GOOGLE_PRICING,
    openai: TEST_OPENAI_PRICING,
    anthropic: TEST_ANTHROPIC_PRICING,
    perplexity: TEST_PERPLEXITY_PRICING,
  };
  const pricing = pricingMap[provider][model];
  if (!pricing) {
    throw new Error(`No test pricing for ${provider}/${model}`);
  }
  return pricing;
}
```

## Steps

- [x] Create `packages/llm-contract/src/__tests__/fixtures/` directory
- [x] Create `pricing.ts` with all provider pricing maps
- [x] Create `index.ts` re-exporting fixtures
- [x] Verify TypeScript compiles

## Definition of Done

- [x] Fixture file exists with all 4 providers
- [x] Types match `ModelPricing` interface
- [x] Values match migration 012/013

## Verification

```bash
npx tsc --noEmit -p packages/llm-contract/tsconfig.json
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-0-infra-gemini-cleanup.md.
