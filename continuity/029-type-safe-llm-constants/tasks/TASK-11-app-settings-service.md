# TASK-11: Migrate app-settings-service App

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded provider strings with `LlmProviders` constants in app-settings-service.

## Files to Modify

### 1. `apps/app-settings-service/src/index.ts`

**Update provider iteration:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace provider string usages with constants
// 'google' → LlmProviders.Google
// 'openai' → LlmProviders.OpenAI
// 'anthropic' → LlmProviders.Anthropic
// 'perplexity' → LlmProviders.Perplexity
```

### 2. `apps/app-settings-service/src/routes/internalRoutes.ts`

**Update provider iteration:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// In the pricing endpoint, replace:
// FROM:
const [google, openai, anthropic, perplexity] = await Promise.all([
  pricingRepository.getByProvider('google'),
  pricingRepository.getByProvider('openai'),
  pricingRepository.getByProvider('anthropic'),
  pricingRepository.getByProvider('perplexity'),
]);

// TO:
const [google, openai, anthropic, perplexity] = await Promise.all([
  pricingRepository.getByProvider(LlmProviders.Google),
  pricingRepository.getByProvider(LlmProviders.OpenAI),
  pricingRepository.getByProvider(LlmProviders.Anthropic),
  pricingRepository.getByProvider(LlmProviders.Perplexity),
]);
```

### 3. `apps/app-settings-service/src/infra/firestore/firestorePricingRepository.ts`

**Update any hardcoded provider strings if present:**
```typescript
import { LlmProviders } from '@intexuraos/llm-contract';

// Replace any provider string literals with constants
```

## Validation

```bash
npm run typecheck -w @intexuraos/app-settings-service
```

## Acceptance Criteria

- [ ] No hardcoded provider strings
- [ ] All provider references use `LlmProviders.*`
- [ ] Typecheck passes

