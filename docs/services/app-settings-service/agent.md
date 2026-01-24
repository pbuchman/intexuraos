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
  // Get LLM pricing for all providers
  getPricing(): Promise<AllProvidersPricing>;

  // Get user's LLM usage costs
  getUsageCosts(params?: {
    days?: number; // Default: 90, max: 365
  }): Promise<AggregatedCosts>;
}
```

### Types

```typescript
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';

interface ProviderPricing {
  provider: LlmProvider;
  models: Record<string, ModelPricing>;
}

interface ModelPricing {
  inputPricePer1k: number; // USD per 1K input tokens
  outputPricePer1k: number; // USD per 1K output tokens
}

interface AllProvidersPricing {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  zai: ProviderPricing;
}

interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  monthlyBreakdown: MonthlyBreakdown[];
  byModel: ModelCosts[];
  byCallType: CallTypeCosts[];
}

interface MonthlyBreakdown {
  month: string; // "2026-01"
  costUsd: number;
  calls: number;
}

interface ModelCosts {
  model: string;
  provider: LlmProvider;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface CallTypeCosts {
  callType: string; // "research", "classification", etc.
  costUsd: number;
  calls: number;
}
```

---

## Constraints

| Rule               | Description                                       |
| ------------------ | ------------------------------------------------- |
| **Authentication** | All endpoints require valid Bearer token          |
| **Days Range**     | Usage costs: 1-365 days, default 90               |
| **5 Providers**    | Pricing available for all supported LLM providers |
| **User Scoped**    | Usage costs scoped to authenticated user only     |

---

## Usage Patterns

### Get Current Pricing

```typescript
const pricing = await getPricing();
// pricing.google.models['gemini-2.5-flash'].inputPricePer1k
// pricing.openai.models['gpt-4o'].outputPricePer1k
```

### Get Usage Costs

```typescript
const costs = await getUsageCosts({ days: 30 });
// costs.totalCostUsd: 12.45
// costs.monthlyBreakdown: [{ month: "2026-01", costUsd: 12.45, calls: 150 }]
// costs.byModel: [{ model: "gemini-2.5-flash", costUsd: 5.20, ... }]
```

### Calculate Cost Preview

```typescript
const pricing = await getPricing();
const model = pricing.google.models['gemini-2.5-flash'];
const estimatedCost =
  (inputTokens / 1000) * model.inputPricePer1k + (outputTokens / 1000) * model.outputPricePer1k;
```

---

## Internal Endpoints

| Method | Path                          | Purpose                                     |
| ------ | ----------------------------- | ------------------------------------------- |
| POST   | `/internal/usage/record`      | Record LLM usage (called by research-agent) |
| GET    | `/internal/pricing/:provider` | Get pricing for specific provider           |

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

**Last updated:** 2026-01-19
