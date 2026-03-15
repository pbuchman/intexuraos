# @intexuraos/llm-pricing

Fetches LLM pricing from app-settings-service and provides runtime pricing lookups. Also tracks LLM usage to Firestore for cost analytics, aggregating by model, call type, time period, and user.

**Version:** 3.3.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** `@intexuraos/common-core`, `@intexuraos/infra-firestore`, `@intexuraos/llm-contract`

## Why It Exists

Every LLM call in IntexuraOS needs pricing data to calculate costs. Pricing changes frequently as providers update rates. This package fetches pricing from a centralized settings service at startup, caches it in memory for O(1) lookups, and records every LLM call's usage to Firestore for billing and analytics.

## API Reference

### Pricing Client (`pricingClient.ts`)

#### `fetchAllPricing(baseUrl: string, authToken: string): Promise<Result<AllPricingResponse, PricingClientError>>`

Fetches pricing for all providers from `app-settings-service`. Calls `GET {baseUrl}/internal/settings/pricing` with `X-Internal-Auth` header.

```typescript
import { fetchAllPricing } from '@intexuraos/llm-pricing';

const result = await fetchAllPricing(
  'http://app-settings-service',
  process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']
);

if (result.ok) {
  const context = createPricingContext(result.data);
}
```

Error codes: `'NETWORK_ERROR'` | `'API_ERROR'` | `'VALIDATION_ERROR'`

#### `createPricingContext(allPricing: AllPricingResponse, requiredModels?: LLMModel[]): PricingContext`

Creates a validated pricing context. Throws if any required model is missing pricing. Defaults to validating all 14 known models.

```typescript
import { createPricingContext } from '@intexuraos/llm-pricing';

// Validate all 14 models (for app-settings-service startup)
const context = createPricingContext(allPricing);

// Validate only models this service uses
const context = createPricingContext(allPricing, [
  'gemini-2.5-flash',
  'claude-sonnet-4-5-20250929',
]);
```

#### `PricingContext` class

Runtime pricing lookup backed by `Map<LLMModel, ModelPricing>` for O(1) access.

```typescript
interface IPricingContext {
  getPricing(model: LLMModel): ModelPricing;   // throws if not found
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void;    // throws listing missing models
  validateAllModels(): void;                   // validates all 14 models
  getModelsWithPricing(): LLMModel[];
}
```

### Usage Logger (`usageLogger.ts`)

#### `UsageLogger` class / `createUsageLogger(deps)`

Logs LLM usage to Firestore for cost tracking and analytics. Writes to three time-period aggregation levels: `total`, `YYYY-MM`, and `YYYY-MM-DD`. Also writes per-user stats under `by_user/{userId}` subcollection. Errors are caught and logged — they never propagate to disrupt LLM operations.

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
    webSearchCalls: 3,
  },
  success: true,
});
```

#### `CallType`

```typescript
type CallType =
  | 'research'              // Web search enhanced generation
  | 'generate'             // Simple text generation
  | 'image_generation'     // Image creation
  | 'visualization_insights' // Chart data analysis
  | 'visualization_vegalite' // Vega-Lite chart generation
  | 'tool_calling';         // Function calling agent loops
```

#### Usage Sinks

| Sink                     | Destination                   | Use Case                            |
| ------------------------ | ----------------------------- | ----------------------------------- |
| `FirestoreUsageSink`     | Firestore `llm_usage_stats`   | Default for all production services |
| `StructuredLogUsageSink` | Pino logger (structured JSON) | Services without Firestore access   |
| `NoopUsageSink`          | /dev/null                     | Tests, disabled logging             |

All sinks implement `UsageSink`:

```typescript
interface UsageSink {
  log(params: UsageLogParams): Promise<void>;
}
```

#### `isUsageLoggingEnabled(): boolean`

Checks `INTEXURAOS_LOG_LLM_USAGE`. Defaults to `true`.

### Firestore Structure

```
llm_usage_stats/{model}/
  by_call_type/{callType}/
    by_period/
      total/              (all-time aggregate)
        by_user/{userId}
      YYYY-MM/            (monthly aggregate)
        by_user/{userId}
      YYYY-MM-DD/         (daily aggregate)
        by_user/{userId}
```

Each period document accumulates `totalCalls`, `successfulCalls`, `failedCalls`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd` via Firestore `FieldValue.increment`.

### Test Fixtures

The package ships test fixtures for use in consumer test suites:

```typescript
import { createFakePricingContext, TEST_PRICING, TEST_IMAGE_PRICING } from '@intexuraos/llm-pricing';

const pricingContext = createFakePricingContext();
// Returns TEST_PRICING for all text models, TEST_IMAGE_PRICING for image models
```

`FakePricingContext` implements `IPricingContext` — substitute it directly wherever `PricingContext` is used.

## Configuration

| Env Var                    | Default | Description                                             |
| -------------------------- | ------- | ------------------------------------------------------- |
| `INTEXURAOS_LOG_LLM_USAGE` | `true`  | Set to `false`, `0`, or `no` to disable usage logging   |

## Deprecated API

`logUsage(params)` — standalone function exported for backward compatibility. Uses a silent logger. Migrate to `UsageLogger` class or `createUsageLogger()`.

## Used By

**Packages (2):** `llm-factory`, `infra-gemini`

**Apps (1):** `app-settings-service` (pricing storage and `validateAllModels` at startup)

**Workers (1):** `orchestrator` (via `llm-factory`)

## Recent Changes

| Commit    | Description                                             | Age     |
| --------- | ------------------------------------------------------- | ------- |
| c4e3a13cb | Release v3.3.0                                          | 2 hours |
| e4d231053 | Remove ZAI provider and GLM-4.7 models                  | 3 days  |
| 44ae683ae | Release v3.2.0                                          | 8 days  |

## Source Files

| File                   | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `src/index.ts`         | Re-exports all public APIs                                                             |
| `src/types.ts`         | `LlmPricing`, `LlmProvider` re-export                                                  |
| `src/pricingClient.ts` | `fetchAllPricing`, `PricingContext`, `createPricingContext`, `IPricingContext`         |
| `src/usageLogger.ts`   | `UsageLogger`, `CallType`, `UsageSink` implementations, `isUsageLoggingEnabled`        |
| `src/testFixtures.ts`  | `FakePricingContext`, `TEST_PRICING`, `TEST_IMAGE_PRICING`, `createFakePricingContext` |
