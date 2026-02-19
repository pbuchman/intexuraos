# App Settings Service - Tutorial

LLM pricing and usage tracking.

## Prerequisites

- Auth0 access token

## Part 1: Get Pricing

```bash
curl -X GET https://app-settings.intexuraos.com/settings/pricing \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response example:**

```json
{
  "success": true,
  "data": {
    "google": {
      "provider": "google",
      "updatedAt": "2026-02-01",
      "models": {
        "gemini-2.5-flash": {
          "inputPricePerMillion": 0.075,
          "outputPricePerMillion": 0.30,
          "groundingCostPerRequest": 0.0035
        }
      }
    },
    "openai": { ... },
    "anthropic": { ... },
    "perplexity": { ... },
    "zai": { ... }
  }
}
```

> **Note:** Prices are per **million** tokens, not per thousand.

## Part 2: Get Usage Costs

```bash
curl -X GET "https://app-settings.intexuraos.com/settings/usage-costs?days=30" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response example:**

```json
{
  "success": true,
  "data": {
    "totalCostUsd": 12.45,
    "totalCalls": 150,
    "totalInputTokens": 1450000,
    "totalOutputTokens": 320000,
    "monthlyBreakdown": [
      {
        "month": "2026-02",
        "costUsd": 5.2,
        "calls": 60,
        "inputTokens": 620000,
        "outputTokens": 140000,
        "percentage": 42
      }
    ],
    "byModel": [{ "model": "gemini-2.5-flash", "costUsd": 8.1, "calls": 95, "percentage": 65 }],
    "byCallType": [{ "callType": "research", "costUsd": 10.2, "calls": 110, "percentage": 82 }]
  }
}
```

## Part 3: Calculate Estimated Cost

Use the pricing data to estimate costs before making LLM calls:

```typescript
const pricing = await getPricing();
const model = pricing.google.models['gemini-2.5-flash'];

// Prices are per million tokens
const estimatedCost =
  (inputTokens / 1_000_000) * model.inputPricePerMillion +
  (outputTokens / 1_000_000) * model.outputPricePerMillion;
```

## Part 4: Internal Endpoint (Service-to-Service)

Services call this at startup to populate their `PricingContext`:

```bash
curl -X GET https://app-settings.intexuraos.com/internal/settings/pricing \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

Returns the same pricing structure as the public endpoint.

## Response Format

All endpoints return a standardized response contract:

- **Success:** `{ "success": true, "data": { ... } }`
- **Error:** `{ "success": false, "error": { "code": "...", "message": "..." } }`

## Troubleshooting

| Error               | Cause                    | Solution                                          |
| ------------------- | ------------------------ | ------------------------------------------------- |
| `days > 365`        | Invalid range            | Use 1-365                                         |
| 400 INVALID_REQUEST | Non-numeric days param   | Pass an integer string, e.g. `?days=30`           |
| 500 INTERNAL_ERROR  | Missing pricing data     | Contact admin — Firestore pricing needs migration |
| 401 UNAUTHORIZED    | Missing or invalid token | Check Bearer token or Internal Auth header        |
