# app-settings-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with app-settings-service.

---

## Identity

| Field    | Value                                                    |
| -------- | -------------------------------------------------------- |
| **Name** | app-settings-service                                     |
| **Role** | Application Configuration Service                        |
| **Goal** | Manage LLM pricing configuration and usage cost tracking |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface AppSettingsServiceTools {
  // Get LLM pricing for all providers (authenticated user)
  getPricing(): Promise<AllProvidersPricing>;

  // Get user's LLM usage costs (scoped to authenticated user)
  getUsageCosts(params?: {
    days?: number; // Default: 90, max: 365
  }): Promise<AggregatedCosts>;
}
```

### Types

```typescript
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';

type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

interface ModelPricing {
  inputPricePerMillion: number;   // USD per 1M input tokens
  outputPricePerMillion: number;  // USD per 1M output tokens
  cacheReadMultiplier?: number;   // Multiplier on input cost for cache reads
  cacheWriteMultiplier?: number;  // Multiplier on input cost for cache writes
  webSearchCostPerCall?: number;  // Fixed cost per web search call (USD)
  groundingCostPerRequest?: number; // Fixed cost per grounding request (USD)
  imagePricing?: Record<ImageSize, number>; // Cost per image generation by size
  useProviderCost?: boolean;      // Use provider's reported cost instead of calculated
}

interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
  updatedAt: string; // ISO date string of last pricing update
}

interface AllProvidersPricing {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  zai: ProviderPricing;
}

interface MonthlyCost {
  month: string;        // "2026-01"
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;   // % of total cost (0-100, rounded)
}

interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
  percentage: number;   // % of total cost (0-100, rounded)
}

interface CallTypeCost {
  callType: string;     // e.g. "research", "classification"
  costUsd: number;
  calls: number;
  percentage: number;   // % of total cost (0-100, rounded)
}

interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  monthlyBreakdown: MonthlyCost[];  // Sorted newest first
  byModel: ModelCost[];             // Sorted by cost descending
  byCallType: CallTypeCost[];       // Sorted by cost descending
}
```

---

## Constraints

| Rule               | Description                                       |
| ------------------ | ------------------------------------------------- |
| **Authentication** | All public endpoints require valid Bearer token   |
| **Days Range**     | Usage costs: 1-365 days, default 90               |
| **5 Providers**    | Pricing available for all supported LLM providers |
| **User Scoped**    | Usage costs scoped to authenticated user only     |
| **Startup Check**  | Service fails to start if any model lacks pricing |

---

## Usage Patterns

### Get Current Pricing

```typescript
const pricing = await getPricing();
// pricing.google.models['gemini-2.5-flash'].inputPricePerMillion
// pricing.openai.models['gpt-4o'].outputPricePerMillion
```

### Get Usage Costs

```typescript
const costs = await getUsageCosts({ days: 30 });
// costs.totalCostUsd: 12.45
// costs.totalInputTokens: 1_450_000
// costs.monthlyBreakdown: [{ month: "2026-01", costUsd: 12.45, calls: 150, percentage: 100 }]
// costs.byModel: [{ model: "gemini-2.5-flash", costUsd: 5.20, percentage: 42 }]
```

### Calculate Cost Preview

```typescript
const pricing = await getPricing();
const model = pricing.google.models['gemini-2.5-flash'];
const estimatedCost =
  (inputTokens / 1_000_000) * model.inputPricePerMillion +
  (outputTokens / 1_000_000) * model.outputPricePerMillion;
```

---

## Internal Endpoints

| Method | Path                          | Purpose                                           | Auth            |
| ------ | ----------------------------- | ------------------------------------------------- | --------------- |
| GET    | `/internal/settings/pricing`  | Get all LLM provider pricing (for service startup) | Internal header |

---

## Provider Coverage

| Provider   | Models Tracked                                     |
| ---------- | -------------------------------------------------- |
| Google     | gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro |
| OpenAI     | gpt-4o, gpt-4o-mini, o1-mini                       |
| Anthropic  | claude-sonnet-4-20250514                           |
| Perplexity | sonar, sonar-pro                                   |
| Zai        | glm-4-flash                                        |

---

**Last updated:** 2026-02-19 (v2 run verification)
