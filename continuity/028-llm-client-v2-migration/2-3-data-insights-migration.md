# 2-3: Migrate data-insights-service

## Status: ✅ DONE

## Tier: 2 (Service-level)

## Context

`data-insights-service` has a single LLM client usage in `titleGenerationService.ts`. Uses `createGeminiClient` with model `gemini-2.5-flash`.

## Scope

**Files to MODIFY:**

- apps/data-insights-service/src/infra/gemini/titleGenerationService.ts

**Tests to check/update:**

- Check if tests exist for this service (may be integration-tested only)

## Current Structure

```typescript
export function createTitleGenerationService(
  userServiceClient: UserServiceClient
): TitleGenerationService {
  return {
    async generateTitle(userId, content) {
      // ... get API key from userServiceClient ...

      const geminiClient = createGeminiClient({
        apiKey,
        model: TITLE_GENERATION_MODEL, // 'gemini-2.5-flash'
        userId,
      });
      // ...
    },
  };
}
```

## Target Structure

```typescript
import type { ModelPricing } from '@intexuraos/llm-contract';

export function createTitleGenerationService(
  userServiceClient: UserServiceClient,
  pricing: ModelPricing // pricing for gemini-2.5-flash
): TitleGenerationService {
  return {
    async generateTitle(userId, content) {
      // ... get API key from userServiceClient ...

      const geminiClient = createGeminiClient({
        apiKey,
        model: TITLE_GENERATION_MODEL,
        userId,
        pricing,
      });
      // ...
    },
  };
}
```

## Steps

- [ ] Add `ModelPricing` import from `@intexuraos/llm-contract`
- [ ] Add `pricing: ModelPricing` as second parameter to factory function
- [ ] Pass `pricing` to `createGeminiClient`
- [ ] Update all callers of `createTitleGenerationService` to pass pricing
- [ ] Update tests if they exist

## Caller Location

Find where `createTitleGenerationService` is called:

```bash
grep -r "createTitleGenerationService" apps/data-insights-service/
```

The factory caller needs to fetch pricing for `gemini-2.5-flash` from Firestore and pass it.

## Definition of Done

- [ ] Factory accepts `pricing` parameter
- [ ] Client receives pricing
- [ ] All callers updated
- [ ] Service compiles and tests pass (if any)

## Verification

```bash
npm run test -w @intexuraos/data-insights-service
npm run lint -w @intexuraos/data-insights-service
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 3-0-final-verification.md.
