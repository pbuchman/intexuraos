# app-settings-service -- Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute | Value                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- |
| Name      | app-settings-service                                                                     |
| Role      | Centralized LLM pricing configuration and per-user usage cost analytics                  |
| Goal      | Provide accurate, up-to-date pricing for all LLM models and track individual usage costs |

## Capabilities

### Get LLM Pricing (Public)

**Endpoint:** `GET /settings/pricing`

**When to use:** When a user or UI needs current pricing for all LLM providers to display costs or estimate charges before making API calls.

**Input Schema:**

```typescript
// No request body. Requires Authorization header.
// Headers: { Authorization: 'Bearer <jwt>' }
```

**Output Schema:**

```typescript
interface AllProvidersPricing {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  zai: ProviderPricing;
}

interface ProviderPricing {
  provider: 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';
  models: Record<string, ModelPricing>;
  updatedAt: string; // ISO date
}

interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadMultiplier?: number;
  cacheWriteMultiplier?: number;
  webSearchCostPerCall?: number;
  groundingCostPerRequest?: number;
  imagePricing?: Record<'1024x1024' | '1536x1024' | '1024x1536', number>;
  useProviderCost?: boolean;
}
```

**Example:**

```json
// Request
// GET /settings/pricing
// Authorization: Bearer eyJhbG...

// Response (200)
{
  "success": true,
  "data": {
    "google": {
      "provider": "google",
      "updatedAt": "2026-02-01T00:00:00Z",
      "models": {
        "gemini-2.5-flash": {
          "inputPricePerMillion": 0.075,
          "outputPricePerMillion": 0.30,
          "groundingCostPerRequest": 0.0035
        }
      }
    },
    "openai": { "provider": "openai", "models": { "..." : "..." }, "updatedAt": "..." },
    "anthropic": { "..." : "..." },
    "perplexity": { "..." : "..." },
    "zai": { "..." : "..." }
  }
}
```

### Get LLM Pricing (Internal)

**Endpoint:** `GET /internal/settings/pricing`

**When to use:** When a service needs to load pricing at startup for its PricingContext. Uses internal auth, not Bearer tokens.

**Input Schema:**

```typescript
// No request body. Requires X-Internal-Auth header.
// Headers: { 'X-Internal-Auth': '<shared-secret>' }
```

**Output Schema:** Same as public pricing endpoint.

**Example:**

```json
// Request
// GET /internal/settings/pricing
// X-Internal-Auth: <token>

// Response (200)
{
  "success": true,
  "data": {
    "google": { "..." : "..." },
    "openai": { "..." : "..." },
    "anthropic": { "..." : "..." },
    "perplexity": { "..." : "..." },
    "zai": { "..." : "..." }
  }
}
```

### Get User Usage Costs

**Endpoint:** `GET /settings/usage-costs`

**When to use:** When displaying a user's LLM spending history with breakdowns by month, model, and call type.

**Input Schema:**

```typescript
interface UsageCostsQuery {
  days?: number; // 1-365, default: 90
}
// Headers: { Authorization: 'Bearer <jwt>' }
```

**Output Schema:**

```typescript
interface AggregatedCosts {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  monthlyBreakdown: MonthlyCost[]; // Sorted newest first
  byModel: ModelCost[];             // Sorted by cost descending
  byCallType: CallTypeCost[];       // Sorted by cost descending
}

interface MonthlyCost {
  month: string;        // "2026-01"
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;   // 0-100, rounded
}

interface ModelCost {
  model: string;
  costUsd: number;
  calls: number;
  percentage: number;
}

interface CallTypeCost {
  callType: string;     // e.g. "research", "classification"
  costUsd: number;
  calls: number;
  percentage: number;
}
```

**Example:**

```json
// Request
// GET /settings/usage-costs?days=30
// Authorization: Bearer eyJhbG...

// Response (200)
{
  "success": true,
  "data": {
    "totalCostUsd": 12.45,
    "totalCalls": 234,
    "totalInputTokens": 1450000,
    "totalOutputTokens": 320000,
    "monthlyBreakdown": [
      { "month": "2026-02", "costUsd": 5.20, "calls": 60, "inputTokens": 620000, "outputTokens": 140000, "percentage": 42 }
    ],
    "byModel": [
      { "model": "gemini-2.5-flash", "costUsd": 8.10, "calls": 95, "percentage": 65 }
    ],
    "byCallType": [
      { "callType": "research", "costUsd": 10.20, "calls": 110, "percentage": 82 }
    ]
  }
}
```

## Constraints

**Do NOT:**

- Call pricing endpoints without authentication (returns 401)
- Request usage costs with `days` outside 1-365 range (returns 400)
- Expect per-day granularity in usage responses (aggregation is by month only)
- Expect write operations (service is read-only for pricing and usage data)

**Requires:**

- Valid Bearer JWT token for public endpoints
- Valid `X-Internal-Auth` header for internal endpoint
- Firestore pricing data must be populated via migrations before service starts

## Usage Patterns

### Pattern 1: Service Startup Pricing Load

```
1. Call GET /internal/settings/pricing with X-Internal-Auth header
2. Parse response.data into PricingContext
3. Use PricingContext for cost calculation during LLM calls
```

### Pattern 2: Display User Cost Dashboard

```
1. Call GET /settings/usage-costs?days=90 with Bearer token
2. Render monthlyBreakdown as a bar chart (month on x-axis, costUsd on y-axis)
3. Render byModel as a pie chart (model as label, percentage as value)
4. Show totalCostUsd and totalCalls as summary cards
```

### Pattern 3: Cost Preview Before LLM Call

```
1. Call GET /settings/pricing with Bearer token
2. Lookup the target model in the appropriate provider
3. Calculate: (inputTokens / 1_000_000) * inputPricePerMillion + (outputTokens / 1_000_000) * outputPricePerMillion
4. Add groundingCostPerRequest or webSearchCostPerCall if applicable
5. Display estimated cost to user before confirming the call
```

## Error Handling

| Error Code | Meaning                    | Recovery Action                                      |
| ---------- | -------------------------- | ---------------------------------------------------- |
| 400        | Invalid days parameter     | Use integer between 1 and 365                        |
| 401        | Unauthorized               | Refresh Bearer token or check internal auth header   |
| 500        | Missing provider pricing   | Contact admin -- Firestore pricing migration needed  |

## Dependencies

| Service    | Why Needed                                      | Failure Behavior            |
| ---------- | ----------------------------------------------- | --------------------------- |
| Firestore  | Pricing config and usage statistics storage     | 500 error on all endpoints  |

## Provider Coverage

| Provider   | Models (16 total)                                                               |
| ---------- | ------------------------------------------------------------------------------- |
| Google     | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-image      |
| OpenAI     | gpt-5.2, gpt-4o-mini, o4-mini-deep-research, gpt-image-1                        |
| Anthropic  | claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-3-5-haiku-20241022 |
| Perplexity | sonar, sonar-pro, sonar-deep-research                                           |
| Zai        | glm-4.7, glm-4.7-flash                                                          |

---

**Last updated:** 2026-02-22
