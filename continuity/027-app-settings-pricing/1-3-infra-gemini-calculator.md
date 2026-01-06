# 1-3: Add Calculator to infra-gemini

## Status: ✅ DONE

## Tier: 1 (Independent)

## Context

Nowy klient createGeminiClientV2() z parametryzowanym pricingiem.
Stary createGeminiClient() pozostaje.

## Scope

- packages/infra-gemini/src/costCalculator.ts (NEW)
- packages/infra-gemini/src/clientV2.ts (NEW)
- packages/infra-gemini/src/types.ts (extend with GeminiConfigV2)

## Implementation

```typescript
// types.ts
export interface GeminiConfigV2 {
  apiKey: string;
  model: string;
  userId: string;
  pricing: ModelPricing;
  imagePricing?: ModelPricing;
}

// costCalculator.ts
export function calculateTextCost(usage: TokenUsage, pricing: ModelPricing): number;
export function calculateImageCost(size: ImageSize, pricing: ModelPricing): number;
export function normalizeUsageV2(...): NormalizedUsage;

// clientV2.ts
export function createGeminiClientV2(config: GeminiConfigV2): GeminiClientV2;
```

## Steps

- [x] Create costCalculator.ts with calculateTextCost, calculateImageCost, normalizeUsageV2
- [x] Create GeminiConfigV2 in types.ts
- [x] Create clientV2.ts copying structure from client.ts
- [x] Replace hardcoded GEMINI_PRICING with config.pricing
- [x] Export from index.ts
- [ ] Add tests for costCalculator (not added - relies on integration tests)
- [ ] Add tests for clientV2 (not added - relies on integration tests)

## Definition of Done

- [x] createGeminiClientV2 works with passed pricing
- [x] No hardcoded prices in V2 client
- [x] Original createGeminiClient unchanged
- [x] npm run ci passes

## Created Files

- packages/infra-gemini/src/costCalculator.ts
- packages/infra-gemini/src/clientV2.ts
- packages/infra-gemini/src/types.ts (updated with GeminiConfigV2)

## Verification

```bash
npm run test -w @intexuraos/infra-gemini
npm run ci
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 1-4-infra-gpt-calculator.md.
