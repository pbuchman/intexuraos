# 2-0: Migrate llm-orchestrator Adapters

## Status: ✅ DONE

## Tier: 2 (Service-level)

## Context

All 5 adapters in llm-orchestrator use V1 clients. After Tier 1 cleanup, the clients now require `pricing` in config. Update all adapters to accept and pass pricing.

## Scope

**Files to MODIFY:**
- apps/llm-orchestrator/src/infra/llm/GptAdapter.ts
- apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts
- apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts
- apps/llm-orchestrator/src/infra/llm/PerplexityAdapter.ts
- apps/llm-orchestrator/src/infra/llm/ContextInferenceAdapter.ts

**Tests to MODIFY:**
- apps/llm-orchestrator/src/__tests__/infra/llm/GptAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/ClaudeAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/GeminiAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/PerplexityAdapter.test.ts
- apps/llm-orchestrator/src/__tests__/infra/llm/ContextInferenceAdapter.test.ts

**Factory/bootstrap to MODIFY (pricing injection):**
- apps/llm-orchestrator/src/bootstrap/ or wherever adapters are instantiated

## Current Adapter Constructor Pattern

```typescript
// BEFORE
constructor(apiKey: string, model: string, userId: string) {
  this.client = createGptClient({ apiKey, model, userId });
}
```

## Target Adapter Constructor Pattern

```typescript
// AFTER
import type { ModelPricing } from '@intexuraos/llm-contract';

constructor(apiKey: string, model: string, userId: string, pricing: ModelPricing) {
  this.client = createGptClient({ apiKey, model, userId, pricing });
}
```

## Steps

### Per Adapter (repeat for all 5):

- [ ] Add `ModelPricing` import from `@intexuraos/llm-contract`
- [ ] Add `pricing: ModelPricing` as 4th constructor parameter
- [ ] Pass `pricing` to client factory

### GptAdapter specific:
- [ ] File: `apps/llm-orchestrator/src/infra/llm/GptAdapter.ts`
- [ ] Constructor: `(apiKey, model, userId)` → `(apiKey, model, userId, pricing)`
- [ ] Client: `createGptClient({ apiKey, model, userId })` → `createGptClient({ apiKey, model, userId, pricing })`

### ClaudeAdapter specific:
- [ ] File: `apps/llm-orchestrator/src/infra/llm/ClaudeAdapter.ts`
- [ ] Same pattern as GptAdapter

### GeminiAdapter specific:
- [ ] File: `apps/llm-orchestrator/src/infra/llm/GeminiAdapter.ts`
- [ ] Same pattern as GptAdapter

### PerplexityAdapter specific:
- [ ] File: `apps/llm-orchestrator/src/infra/llm/PerplexityAdapter.ts`
- [ ] Same pattern as GptAdapter

### ContextInferenceAdapter specific:
- [ ] File: `apps/llm-orchestrator/src/infra/llm/ContextInferenceAdapter.ts`
- [ ] Constructor has 4 params already (apiKey, model, userId, logger?)
- [ ] Insert `pricing` before `logger`: `(apiKey, model, userId, pricing, logger?)`

### Update Tests:
- [ ] Update mocks to expect `pricing` in config
- [ ] Use `TEST_*_PRICING` fixtures from `@intexuraos/llm-contract` (or inline minimal pricing)
- [ ] Update adapter instantiation in tests

### Update Bootstrap/Factory:
- [ ] Locate where adapters are instantiated
- [ ] Fetch pricing from Firestore at startup
- [ ] Pass pricing to adapter constructors

## Definition of Done

- [ ] All 5 adapters accept `pricing` parameter
- [ ] All 5 adapters pass `pricing` to client factory
- [ ] All adapter tests pass
- [ ] `npm run test -w @intexuraos/llm-orchestrator` passes

## Verification

```bash
npm run test -w @intexuraos/llm-orchestrator
npm run lint -w @intexuraos/llm-orchestrator
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 2-1-image-service-migration.md.

