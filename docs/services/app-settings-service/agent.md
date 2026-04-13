# app-settings-service — Agent Interface

> Machine-readable specification for AI agent integration

## Identity

| Attribute | Value                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- |
| Name      | app-settings-service                                                                     |
| Role      | Centralized LLM pricing configuration                                                    |
| Goal      | Provide accurate, up-to-date pricing for all LLM models                                  |

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
}

interface ProviderPricing {
  provider: 'google' | 'openai' | 'anthropic' | 'perplexity';
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
    "perplexity": { "..." : "..." }
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
    "perplexity": { "..." : "..." }
  }
}
```

## Constraints

**Do NOT:**

- Call pricing endpoints without authentication (returns 401)
- Expect write operations (service is read-only for pricing data)

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

### Pattern 2: Cost Preview Before LLM Call

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
| 401        | Unauthorized               | Refresh Bearer token or check internal auth header   |
| 500        | Missing provider pricing   | Contact admin — Firestore pricing migration needed   |

## Dependencies

| Service    | Why Needed                                      | Failure Behavior            |
| ---------- | ----------------------------------------------- | --------------------------- |
| Firestore  | Pricing config storage                          | 500 error on all endpoints  |

## Provider Coverage

| Provider   | Models (14 total)                                                               |
| ---------- | ------------------------------------------------------------------------------- |
| Google     | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.5-flash-image      |
| OpenAI     | gpt-5.4, gpt-4o-mini, o4-mini-deep-research, gpt-image-1                        |
| Anthropic  | claude-opus-4-6, claude-sonnet-4-6, claude-3-5-haiku-20241022                   |
| Perplexity | sonar, sonar-pro, sonar-deep-research                                           |

---

**Last updated:** 2026-04-07
