# @intexuraos/llm-pricing

Fetches LLM pricing from app-settings-service and provides runtime pricing lookups. Also tracks LLM usage to Firestore for cost analytics, aggregating by model, call type, time period, and user.

**Version:** 2.1.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-firestore`, `@intexuraos/llm-contract`

## Why It Exists

Every LLM call in IntexuraOS needs pricing data to calculate costs. Pricing changes frequently as providers update rates. This package fetches pricing from a centralized settings service at startup, caches it in memory for O(1) lookups, and records every LLM call's usage to Firestore for billing and analytics.

## API Reference

### Pricing Client (`pricingClient.ts`)

#### `fetchAllPricing(baseUrl: string, authToken: string): Promise<Result<AllPricingResponse, PricingClientError>>`

Fetches pricing for all providers from `app-settings-service`.

```typescript
import { fetchAllPricing } from '@intexuraos/llm-pricing';

const result = await fetchAllPricing(
  'http://app-settings-service',
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']!
);

if (result.ok) {
  console.log(Object.keys(result.value.anthropic.models));
  // ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', ...]
}
```

Calls `GET {baseUrl}/internal/settings/pricing` with `X-Internal-Auth` header.

#### `createPricingContext(allPricing: AllPricingResponse, requiredModels?: LLMModel[]): PricingContext`

Creates a validated pricing context. Throws if any required model is missing pricing.

```typescript
import { createPricingContext } from '@intexuraos/llm-pricing';

// Validate all 16 models have pricing (for app-settings-service)
const context = createPricingContext(allPricing);

// Validate only models this service uses
const context = createPricingContext(allPricing, [
  'gemini-2.5-flash',
  'claude-sonnet-4-5-20250929',
]);
```

#### `PricingContext` class

Runtime pricing lookup with O(1) access via internal `Map<LLMModel, ModelPricing>`.

```typescript
interface IPricingContext {
  getPricing(model: LLMModel): ModelPricing; // throws if not found
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void; // throws listing missing
  validateAllModels(): void; // validates all 16 models
  getModelsWithPricing(): LLMModel[];
}
```

### Usage Logger (`usageLogger.ts`)

#### `UsageLogger` class

Logs LLM usage to Firestore for cost tracking. Fire-and-forget -- errors are logged but do not propagate.

```typescript
import { createUsageLogger } from '@intexuraos/llm-pricing';

const usageLogger = createUsageLogger({ logger });

await usageLogger.log({
  userId: 'user-123',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  callType: 'research',
  usage: {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    costUsd: 0.0105,
  },
  success: true,
});
```

**Firestore structure:**

```
llm_usage_stats/{model}/
  by_call_type/{callType}/
    by_period/
      total/                  (all-time aggregate)
        by_user/{userId}
      YYYY-MM/                (monthly aggregate)
        by_user/{userId}
      YYYY-MM-DD/             (daily aggregate)
        by_user/{userId}
```

Each period document tracks: `totalCalls`, `successfulCalls`, `failedCalls`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`.

#### `isUsageLoggingEnabled(): boolean`

Checks `INTEXURAOS_LOG_LLM_USAGE` env var. Defaults to `true`. Set to `false`, `0`, or `no` to disable.

#### `logUsage(params: UsageLogParams): Promise<void>` (deprecated)

Legacy standalone function. Uses a silent logger internally. Migrate to `createUsageLogger()`.

### Types

```typescript
type CallType =
  | 'research'
  | 'generate'
  | 'image_generation'
  | 'visualization_insights'
  | 'visualization_vegalite';

interface UsageLogParams {
  userId: string;
  provider: LlmProvider;
  model: string;
  callType: CallType;
  usage: NormalizedUsage;
  success: boolean;
  errorMessage?: string;
  logger?: Logger;
}

interface AllPricingResponse {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  zai: ProviderPricing;
}

interface PricingClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  message: string;
}

interface LlmPricing {
  provider: LlmProvider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  cacheWriteMultiplier?: number;
  cacheReadMultiplier?: number;
  imageCostPerGeneration?: number;
  updatedAt: string;
}
```

### Test Fixtures (`testFixtures.ts`)

```typescript
import {
  TEST_PRICING,
  TEST_IMAGE_PRICING,
  createFakePricingContext,
} from '@intexuraos/llm-pricing';

const fakePricing = createFakePricingContext();
fakePricing.getPricing('gemini-2.5-flash');
// { inputPricePerMillion: 1.0, outputPricePerMillion: 2.0 }
```

`FakePricingContext` implements `IPricingContext` and returns fixed test pricing for all models.

## Used By

**Packages (6):** `llm-factory`, `internal-clients`, `infra-claude`, `infra-gemini`, `infra-glm`, `infra-gpt`, `infra-perplexity`

**Apps (12):** `actions-agent`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `research-agent`, `todos-agent`, `user-service`, `web-agent`

## Recent Changes

| Commit   | Description                                       | Age     |
| -------- | ------------------------------------------------- | ------- |
| 641eee12 | Fix duplicate Content-Type header in predev proxy | 5 days  |
| 44017d5c | Fix ESLint OOM with batched parallel lint runner  | 7 days  |
| 21c1528a | Fix release skill to bump all package versions    | 12 days |
| 6acb3fc0 | Add tests for 95% branch coverage                 | 13 days |
| 4fa0fed3 | Release v2.0.0                                    | 2 weeks |
| 2c3a98ce | Add GLM-4.7-Flash support as free Zai AI model    | 3 weeks |
| a87cf2b5 | Make logger mandatory in llm-pricing package      | 3 weeks |

## Source Files

| File                   | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `src/index.ts`         | Re-exports all public APIs                            |
| `src/types.ts`         | LlmPricing and LlmProvider types                      |
| `src/pricingClient.ts` | fetchAllPricing, PricingContext, createPricingContext |
| `src/usageLogger.ts`   | UsageLogger class, logUsage, isUsageLoggingEnabled    |
| `src/testFixtures.ts`  | TEST_PRICING, FakePricingContext for tests            |
