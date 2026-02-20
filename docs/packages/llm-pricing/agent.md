# @intexuraos/llm-pricing - Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/llm-pricing
version: 2.1.0
type: module
leaf: false
dependencies: @intexuraos/common-core, @intexuraos/infra-firestore, @intexuraos/llm-contract
entry_points:
  - ".": ./src/index.ts
firestore_collections:
  - llm_usage_stats (owned)
env_vars:
  - INTEXURAOS_LOG_LLM_USAGE (optional, default: true)
```

## Exported Types

```typescript
// types.ts
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

// Re-exported
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';

// usageLogger.ts
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

// pricingClient.ts
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
interface IPricingContext {
  getPricing(model: LLMModel): ModelPricing;
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void;
  validateAllModels(): void;
  getModelsWithPricing(): LLMModel[];
}
```

## Exported Functions

```typescript
function fetchAllPricing(
  baseUrl: string,
  authToken: string
): Promise<Result<AllPricingResponse, PricingClientError>>;
function createPricingContext(
  allPricing: AllPricingResponse,
  requiredModels?: LLMModel[]
): PricingContext;
function createUsageLogger(deps: { logger: Logger }): UsageLogger;
function isUsageLoggingEnabled(): boolean;
/** @deprecated */ function logUsage(params: UsageLogParams): Promise<void>;
```

## Exported Classes

```typescript
class PricingContext implements IPricingContext {
  readonly pricing: Map<LLMModel, ModelPricing>;
  constructor(allPricing: AllPricingResponse);
  getPricing(model: LLMModel): ModelPricing;
  hasPricing(model: LLMModel): boolean;
  validateModels(models: LLMModel[]): void;
  validateAllModels(): void;
  getModelsWithPricing(): LLMModel[];
}

class UsageLogger {
  readonly logger: Logger;
  readonly sink: UsageSink;
  constructor(deps: { logger: Logger; sink?: UsageSink });
  async log(params: UsageLogParams): Promise<void>;
}

// Sink implementations
interface UsageSink {
  log(params: UsageLogParams): Promise<void>;
}
class FirestoreUsageSink implements UsageSink {
  /* writes to llm_usage_stats */
}
class StructuredLogUsageSink implements UsageSink {
  constructor(deps: { logger: Logger });
}
class NoopUsageSink implements UsageSink {
  /* discards all events */
}
```

## Exported Test Fixtures

```typescript
const TEST_PRICING: ModelPricing; // { inputPricePerMillion: 1.0, outputPricePerMillion: 2.0 }
const TEST_IMAGE_PRICING: ModelPricing; // { imagePricing: { '1024x1024': 0.04, ... } }

class FakePricingContext implements IPricingContext {
  /* always returns test pricing */
}
function createFakePricingContext(
  pricing?: ModelPricing,
  imagePricing?: ModelPricing
): FakePricingContext;
```

## Dependency Graph

```
common-core, llm-contract, infra-firestore
  <- llm-pricing
       <- llm-factory
       <- infra-claude, infra-gemini, infra-glm, infra-gpt, infra-perplexity
       <- internal-clients
       <- 12 apps
       <- workers/orchestrator
```

## Usage Patterns

```typescript
// Fetch and create pricing context at startup
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
const result = await fetchAllPricing(settingsUrl, authToken);
if (!result.ok) throw new Error(result.error.message);
const pricingContext = createPricingContext(result.value);

// Look up pricing for a model
const pricing = pricingContext.getPricing('gemini-2.5-flash');

// Log usage after LLM call
import { createUsageLogger } from '@intexuraos/llm-pricing';
const usageLogger = createUsageLogger({ logger });
await usageLogger.log({
  userId,
  provider: 'google',
  model: 'gemini-2.5-flash',
  callType: 'generate',
  usage,
  success: true,
});

// In tests
import { createFakePricingContext } from '@intexuraos/llm-pricing';
const fakePricing = createFakePricingContext();
```

## Test Mock Pattern

```typescript
const fakePricingContext: IPricingContext = {
  getPricing: vi.fn().mockReturnValue({ inputPricePerMillion: 1.0, outputPricePerMillion: 2.0 }),
  hasPricing: vi.fn().mockReturnValue(true),
  validateModels: vi.fn(),
  validateAllModels: vi.fn(),
  getModelsWithPricing: vi.fn().mockReturnValue([]),
};
```
