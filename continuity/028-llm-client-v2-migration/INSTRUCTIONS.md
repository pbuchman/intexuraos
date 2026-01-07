# 028 — LLM Client V2 Migration

## Goal

Migrate all LLM client usages from V1 (`createXxxClient`) to V2 (`createXxxClientV2`) and **completely remove** all V1 client code. No backward compatibility—clean cut.

## Success Criteria

1. All services use `createXxxClientV2` with pricing from Firestore
2. All V1 client files (`client.ts`) deleted from infra-\* packages
3. V2 clients renamed: `clientV2.ts` → `client.ts`, exports simplified
4. All tests updated and passing
5. `npm run ci` passes
6. No dead code remains

## Task Numbering

```
0-0-*.md  — Tier 0: Setup/shared fixtures
1-0-*.md  — Tier 1: Package-level changes (infra-* cleanup)
2-0-*.md  — Tier 2: Service-level migrations (consumer updates)
3-0-*.md  — Tier 3: Final cleanup and verification
```

## Pricing Source Strategy

**Option A (selected):** Inject pricing at service startup, no refresh during runtime.

Each service fetches pricing once from `settings/llm_pricing/{provider}` at initialization and passes it to adapters/factories.

## Pricing Fixture (for tests)

Based on migration 012 (with DALL-E 3 removed per migration 013):

```typescript
// packages/llm-contract/src/__tests__/fixtures/pricing.ts
export const TEST_PRICING = {
  google: {
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
  },
  openai: {
    'o4-mini-deep-research': {
      inputPricePerMillion: 2.0,
      outputPricePerMillion: 8.0,
      cacheReadMultiplier: 0.25,
      webSearchCostPerCall: 0.01,
    },
    'gpt-5.2': {
      inputPricePerMillion: 1.75,
      outputPricePerMillion: 14.0,
      cacheReadMultiplier: 0.1,
    },
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
  },
  anthropic: {
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
  },
  perplexity: {
    sonar: { inputPricePerMillion: 1.0, outputPricePerMillion: 1.0, useProviderCost: true },
    'sonar-pro': { inputPricePerMillion: 3.0, outputPricePerMillion: 15.0, useProviderCost: true },
    'sonar-deep-research': {
      inputPricePerMillion: 2.0,
      outputPricePerMillion: 8.0,
      useProviderCost: true,
    },
  },
};
```

## Execution Order

1. **0-0**: Create shared test pricing fixture in llm-contract
2. **1-0**: Clean up infra-gemini (delete V1, rename V2)
3. **1-1**: Clean up infra-gpt (delete V1, rename V2)
4. **1-2**: Clean up infra-claude (delete V1, rename V2)
5. **1-3**: Clean up infra-perplexity (delete V1, rename V2)
6. **2-0**: Migrate llm-orchestrator adapters
7. **2-1**: Migrate image-service generators
8. **2-2**: Migrate user-service validator
9. **2-3**: Migrate data-insights-service
10. **3-0**: Final verification and dead code check

## Resume Procedure

1. Read `CONTINUITY.md`
2. Check "Now" and "Next" fields
3. Continue from the current task
4. Update ledger after each step
