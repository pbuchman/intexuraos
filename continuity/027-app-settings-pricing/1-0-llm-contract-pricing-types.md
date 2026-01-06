# 1-0: Add Pricing Types to llm-contract

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Centralne typy dla pricing używane przez wszystkie infra-* pakiety.

## Scope

- packages/llm-contract/src/pricing.ts (NEW)
- Export from packages/llm-contract/src/index.ts

## Types Added

```typescript
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Partial<Record<ImageSize, number>>;
  useProviderCost?: boolean;
}

export interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string;
}

export interface CostCalculator {
  calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
  calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
}
```

Note: `LlmProvider` already existed in supportedModels.ts.

## Steps

- [x] Create packages/llm-contract/src/pricing.ts
- [x] Add exports to packages/llm-contract/src/index.ts
- [ ] Add tests for type guards if needed (not needed - pure types)

## Definition of Done

- [x] Types compile without errors
- [x] npm run ci passes

## Created Files

- packages/llm-contract/src/pricing.ts

## Verification

```bash
npm run typecheck -w @intexuraos/llm-contract
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-1-endpoint-pricing-provider.md.
