# TASK-12: Migrate llm-pricing Package

## Status: PENDING

## Depends On: TASK-02

## Objective

Replace hardcoded model and provider strings with constants in llm-pricing package.

## Files to Modify

### 1. `packages/llm-pricing/src/pricingClient.ts`

**Update provider iteration:**

```typescript
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';

// Replace any provider string usages:
// 'google' → LlmProviders.Google
// 'openai' → LlmProviders.OpenAI
// 'anthropic' → LlmProviders.Anthropic
// 'perplexity' → LlmProviders.Perplexity
```

### 2. `packages/llm-pricing/src/testFixtures.ts`

**Update fixture model strings:**

```typescript
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';

// Replace all model string keys with constants:
// FROM:
models: {
  'gemini-2.5-pro': { ... },
  'gemini-2.5-flash': { ... },
}

// TO:
models: {
  [LlmModels.Gemini25Pro]: { ... },
  [LlmModels.Gemini25Flash]: { ... },
}

// Replace provider strings:
// FROM:
provider: 'google',

// TO:
provider: LlmProviders.Google,
```

## Validation

```bash
npm run typecheck -w @intexuraos/llm-pricing
```

## Acceptance Criteria

- [ ] No hardcoded model strings in source files
- [ ] No hardcoded provider strings in source files
- [ ] Test fixtures use constants
- [ ] Typecheck passes
