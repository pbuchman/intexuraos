# @intexuraos/llm-pricing — Agent Reference

> Machine-readable interface for automated tooling and AI agents.

## Identity

| Attribute | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Package   | `@intexuraos/llm-pricing`                                          |
| Role      | Pricing lookup and usage tracking for LLM operations               |
| Goal      | Provide O(1) cost lookup at runtime; aggregate usage to Firestore  |
| Firestore | `llm_usage_stats` (owner: this package via `FirestoreUsageSink`)   |

## Exports

### Functions

| Export                  | Signature                                                                                         | Purpose                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `fetchAllPricing`       | `(baseUrl: string, authToken: string) => Promise<Result<AllPricingResponse, PricingClientError>>` | Fetch pricing from app-settings-service           |
| `createPricingContext`  | `(allPricing: AllPricingResponse, requiredModels?: LLMModel[]) => PricingContext`                 | Build validated O(1) pricing lookup               |
| `createUsageLogger`     | `(deps: { logger: Logger; sink?: UsageSink }) => UsageLogger`                                     | Create a usage logger instance                    |
| `isUsageLoggingEnabled` | `() => boolean`                                                                                   | Check `INTEXURAOS_LOG_LLM_USAGE`                  |

### Classes

| Export                   | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `PricingContext`         | O(1) pricing lookups via internal Map                    |
| `UsageLogger`            | Logs usage to Firestore with structured logging          |
| `FirestoreUsageSink`     | Default sink — writes to `llm_usage_stats`               |
| `StructuredLogUsageSink` | Sink that emits to a Pino logger                         |
| `NoopUsageSink`          | Sink that discards all events (tests only)               |
| `FakePricingContext`     | Test double implementing `IPricingContext`               |

### Key Types

```typescript
type CallType =
  | 'research' | 'generate' | 'image_generation'
  | 'visualization_insights' | 'visualization_vegalite' | 'tool_calling';

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

interface UsageSink {
  log(params: UsageLogParams): Promise<void>;
}

interface IPricingContext {
  getPricing(model: LLMModel): ModelPricing;  // throws if missing
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void;
  validateAllModels(): void;
  getModelsWithPricing(): LLMModel[];
}

interface AllPricingResponse {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
}
```

## Usage Patterns

### Pattern 1: Service startup

```typescript
// Fetch + validate at startup
const pricingResult = await fetchAllPricing(settingsBaseUrl, authToken);
if (!pricingResult.ok) throw new Error(`Pricing fetch failed: ${pricingResult.error.message}`);
const pricingContext = createPricingContext(pricingResult.data, requiredModels);

// Store on services container
services.pricingContext = pricingContext;
```

### Pattern 2: Per-request logging

```typescript
const usageLogger = createUsageLogger({ logger });

// After LLM call completes
await usageLogger.log({
  userId,
  provider: getProviderForModel(model),
  model,
  callType: 'research',
  usage: result.data.usage,
  success: true,
});
```

### Pattern 3: Test setup

```typescript
import { createFakePricingContext } from '@intexuraos/llm-pricing';

const pricingContext = createFakePricingContext();
// Returns TEST_PRICING (1.0/2.0 per million) for text, TEST_IMAGE_PRICING for images
```

## Constraints

**Do NOT:**
- Call `getPricing()` with a model not in the pricing response (throws)
- Use `logUsage()` standalone function in new code — it is deprecated; use `UsageLogger.log()` instead
- Use `FirestoreUsageSink` in tests — use `NoopUsageSink` instead

**Requires:**
- `fetchAllPricing` must succeed before `createPricingContext` can be called
- `INTEXURAOS_LOG_LLM_USAGE` defaults to `true`; no config needed to enable

## Environment Variables

| Variable                   | Default | Values                     |
| -------------------------- | ------- | -------------------------- |
| `INTEXURAOS_LOG_LLM_USAGE` | `true`  | `true`, `false`, `0`, `no` |

## Dependencies

| Package                       | Why Needed                                                      |
| ----------------------------- | --------------------------------------------------------------- |
| `@intexuraos/common-core`     | `Result` type, `getErrorMessage`                                |
| `@intexuraos/infra-firestore` | Firestore client + `FieldValue`                                 |
| `@intexuraos/llm-contract`    | `LLMModel`, `ALL_LLM_MODELS`, `ModelPricing`, `ProviderPricing` |
