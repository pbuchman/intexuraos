# 2-2: Migrate user-service LlmValidatorImpl

## Status: ✅ DONE

## Tier: 2 (Service-level)

## Context

`LlmValidatorImpl` has **8 client instantiations** (4 providers × 2 methods: `validateKey` and `testRequest`). Each needs `pricing` parameter. This is the highest-touch file.

Since this is a validation service using cheap models, pricing can be hardcoded for validation models specifically OR injected via constructor.

**Recommended approach:** Inject pricing map via constructor. This keeps the class testable and consistent with the rest of the codebase.

## Scope

**Files to MODIFY:**
- apps/user-service/src/infra/llm/LlmValidatorImpl.ts

**Tests to MODIFY:**
- apps/user-service/src/__tests__/infra/llmValidator.test.ts

## Current Structure

```typescript
export class LlmValidatorImpl implements LlmValidator {
  // No constructor, stateless

  async validateKey(provider, apiKey, userId): Promise<...> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({ apiKey, model: VALIDATION_MODELS.google, userId });
        // ...
      }
      // ... 3 more providers
    }
  }

  async testRequest(provider, apiKey, prompt, userId): Promise<...> {
    // Same pattern, 4 more client instantiations
  }
}
```

## Target Structure

```typescript
import type { ModelPricing } from '@intexuraos/llm-contract';

interface ValidationPricing {
  google: ModelPricing;
  openai: ModelPricing;
  anthropic: ModelPricing;
  perplexity: ModelPricing;
}

export class LlmValidatorImpl implements LlmValidator {
  private readonly pricing: ValidationPricing;

  constructor(pricing: ValidationPricing) {
    this.pricing = pricing;
  }

  async validateKey(provider, apiKey, userId): Promise<...> {
    switch (provider) {
      case 'google': {
        const client = createGeminiClient({
          apiKey,
          model: VALIDATION_MODELS.google,
          userId,
          pricing: this.pricing.google,
        });
        // ...
      }
      // ... 3 more providers
    }
  }

  async testRequest(provider, apiKey, prompt, userId): Promise<...> {
    // Same pattern with pricing
  }
}
```

## Steps

- [ ] Add `ModelPricing` import from `@intexuraos/llm-contract`
- [ ] Define `ValidationPricing` interface
- [ ] Add constructor with `pricing: ValidationPricing`
- [ ] Store pricing as private readonly field
- [ ] Update all 8 client instantiations to pass `pricing: this.pricing[provider]`
- [ ] Update tests to instantiate with mock pricing

## Client Instantiation Locations (8 total)

### validateKey method (4):
1. Line ~37: `createGeminiClient` for Google
2. Line ~55: `createGptClient` for OpenAI
3. Line ~74: `createClaudeClient` for Anthropic
4. Line ~92: `createPerplexityClient` for Perplexity

### testRequest method (4):
1. Line ~120: `createGeminiClient` for Google
2. Line ~135: `createGptClient` for OpenAI
3. Line ~150: `createClaudeClient` for Anthropic
4. Line ~165: `createPerplexityClient` for Perplexity

## Test Updates

The test file has extensive mocking. Key changes:
- Mock config expectations must include `pricing`
- `LlmValidatorImpl` instantiation needs pricing object
- Use `TEST_*_PRICING` fixtures for specific validation models:
  - `TEST_GOOGLE_PRICING['gemini-2.0-flash']`
  - `TEST_OPENAI_PRICING['gpt-4o-mini']`
  - `TEST_ANTHROPIC_PRICING['claude-3-5-haiku-20241022']`
  - `TEST_PERPLEXITY_PRICING['sonar']`

## Definition of Done

- [ ] Constructor accepts `ValidationPricing`
- [ ] All 8 client calls pass pricing
- [ ] Tests updated and passing
- [ ] `npm run test -w @intexuraos/user-service` passes

## Verification

```bash
npm run test -w @intexuraos/user-service
npm run lint -w @intexuraos/user-service
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 2-3-data-insights-migration.md.

