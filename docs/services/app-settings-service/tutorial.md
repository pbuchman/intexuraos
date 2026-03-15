# App Settings Service -- Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Auth0 access token, IntexuraOS project access
> **You will learn:** How to fetch LLM pricing, query usage costs, and calculate estimated costs before making LLM calls

---

## What You Will Build

A working integration that:

- Fetches current LLM pricing for all 4 providers
- Queries your personal usage costs with time-range filtering
- Calculates estimated costs before making an LLM call

---

## Prerequisites

Before starting, ensure you have:

- [ ] A valid Auth0 Bearer token (from the web dashboard)
- [ ] For internal endpoints: the `INTEXURAOS_INTERNAL_AUTH_TOKEN` value
- [ ] `curl` or an HTTP client installed

---

## Part 1: Health Check (2 minutes)

Verify the service is running.

### Step 1.1: Check Service Health

```bash
curl -s http://localhost:8122/health | jq .
```

**Expected response:**

```json
{
  "status": "ok",
  "serviceName": "app-settings-service",
  "version": "0.0.4",
  "timestamp": "2026-02-22T12:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0 },
    { "name": "firestore", "status": "ok", "latencyMs": 15 }
  ]
}
```

### What Just Happened?

The health endpoint verifies two things: that required secrets (internal auth token) are loaded, and that Firestore is reachable. If both pass, the service reports `"ok"`.

---

## Part 2: Fetch LLM Pricing (5 minutes)

### Step 2.1: Get All Provider Pricing (Public)

```bash
curl -s http://localhost:8122/settings/pricing \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

**Expected response:**

```json
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
        },
        "gemini-2.5-pro": {
          "inputPricePerMillion": 1.25,
          "outputPricePerMillion": 10.0
        }
      }
    },
    "openai": { "...": "..." },
    "anthropic": { "...": "..." },
    "perplexity": { "...": "..." }
  }
}
```

> **Note:** Prices are per **million** tokens, not per thousand.

### Step 2.2: Get Pricing via Internal Endpoint

Services call this at startup to populate their `PricingContext`:

```bash
curl -s http://localhost:8122/internal/settings/pricing \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" | jq .
```

Returns the same pricing structure as the public endpoint.

**Checkpoint:** You should see pricing data for all 4 providers with at least one model each.

---

## Part 3: Query Usage Costs (5 minutes)

### Step 3.1: Default 90-Day View

```bash
curl -s http://localhost:8122/settings/usage-costs \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "totalCostUsd": 12.45,
    "totalCalls": 234,
    "totalInputTokens": 1450000,
    "totalOutputTokens": 320000,
    "monthlyBreakdown": [
      {
        "month": "2026-02",
        "costUsd": 5.20,
        "calls": 60,
        "inputTokens": 620000,
        "outputTokens": 140000,
        "percentage": 42
      },
      {
        "month": "2026-01",
        "costUsd": 4.25,
        "calls": 84,
        "inputTokens": 500000,
        "outputTokens": 100000,
        "percentage": 34
      }
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

### Step 3.2: Custom Time Range

Fetch only the last 30 days:

```bash
curl -s "http://localhost:8122/settings/usage-costs?days=30" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

### Step 3.3: Handle Validation Errors

Try an invalid range:

```bash
curl -s "http://localhost:8122/settings/usage-costs?days=500" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

**Expected response:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "days must be between 1 and 365"
  }
}
```

**Checkpoint:** You should see your personal usage data (or empty arrays if you have not made any LLM calls).

---

## Part 4: Calculate Estimated Cost (5 minutes)

Use the pricing data to estimate costs before making LLM calls.

### Step 4.1: Fetch Pricing and Extract Model Data

```typescript
const response = await fetch('http://localhost:8122/settings/pricing', {
  headers: { Authorization: `Bearer ${token}` },
});
const { data: pricing } = await response.json();

const geminiFlash = pricing.google.models['gemini-2.5-flash'];
```

### Step 4.2: Calculate Token Cost

```typescript
function estimateCost(
  model: { inputPricePerMillion: number; outputPricePerMillion: number },
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * model.inputPricePerMillion +
    (outputTokens / 1_000_000) * model.outputPricePerMillion
  );
}

// Example: 5000 input tokens, 2000 output tokens with Gemini 2.5 Flash
const cost = estimateCost(geminiFlash, 5000, 2000);
// $0.000375 + $0.0006 = $0.000975
```

### Step 4.3: Account for Optional Costs

Some models have additional costs beyond tokens:

```typescript
function estimateFullCost(
  model: {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    groundingCostPerRequest?: number;
    webSearchCostPerCall?: number;
  },
  inputTokens: number,
  outputTokens: number,
  options?: { grounding?: boolean; webSearch?: boolean },
): number {
  let cost =
    (inputTokens / 1_000_000) * model.inputPricePerMillion +
    (outputTokens / 1_000_000) * model.outputPricePerMillion;

  if (options?.grounding && model.groundingCostPerRequest !== undefined) {
    cost += model.groundingCostPerRequest;
  }
  if (options?.webSearch && model.webSearchCostPerCall !== undefined) {
    cost += model.webSearchCostPerCall;
  }

  return cost;
}
```

**Result:** You can now preview costs before making any LLM call.

---

## Response Format

All endpoints return a standardized response contract:

- **Success:** `{ "success": true, "data": { ... } }`
- **Error:** `{ "success": false, "error": { "code": "...", "message": "..." } }`

---

## Troubleshooting

| Problem                | Cause                            | Solution                                           |
| ---------------------- | -------------------------------- | -------------------------------------------------- |
| 401 UNAUTHORIZED       | Missing or invalid token         | Check Bearer token or X-Internal-Auth header       |
| 400 INVALID_REQUEST    | Non-numeric or out-of-range days | Pass an integer string between 1 and 365           |
| 500 INTERNAL_ERROR     | Missing pricing data             | Contact admin -- Firestore pricing needs migration |
| Empty usage data       | No LLM calls made yet            | Make some research queries first                   |
| Service not starting   | Missing model pricing            | Run Firestore pricing migration                    |

---

## Next Steps

Now that you understand the basics:

1. Explore the [OpenAPI documentation](http://localhost:8122/docs) for full schema details
2. Read the [Technical Reference](technical.md) for architecture and gotchas
3. Check [research-agent](../research-agent/features.md) to see how pricing feeds into LLM cost tracking

---

## Exercises

Test your understanding:

1. **Easy:** Fetch pricing and find which model has the lowest input cost per million tokens
2. **Medium:** Query usage costs for 7 days vs 365 days and compare the monthly breakdown
3. **Hard:** Write a function that takes a model name and token counts, fetches pricing from the API, and returns the estimated cost in USD including optional grounding fees

<details>
<summary>Solutions</summary>

### Exercise 1: Cheapest Input Model

```typescript
const { data: pricing } = await fetch('/settings/pricing', {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

let cheapest = { model: '', cost: Infinity };
for (const [, provider] of Object.entries(pricing)) {
  for (const [model, config] of Object.entries(provider.models)) {
    if (config.inputPricePerMillion < cheapest.cost) {
      cheapest = { model, cost: config.inputPricePerMillion };
    }
  }
}
console.log(`Cheapest: ${cheapest.model} at $${cheapest.cost}/M tokens`);
```

### Exercise 2: Time Range Comparison

```bash
# 7 days
curl -s "/settings/usage-costs?days=7" -H "Authorization: Bearer $TOKEN" | jq '.data.monthlyBreakdown'
# 365 days
curl -s "/settings/usage-costs?days=365" -H "Authorization: Bearer $TOKEN" | jq '.data.monthlyBreakdown | length'
```

### Exercise 3: Cost Estimator Function

```typescript
async function estimateLLMCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  options?: { grounding?: boolean },
): Promise<number> {
  const { data: pricing } = await fetch('/settings/pricing', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

  for (const provider of Object.values(pricing)) {
    const model = provider.models[modelName];
    if (model) {
      let cost =
        (inputTokens / 1_000_000) * model.inputPricePerMillion +
        (outputTokens / 1_000_000) * model.outputPricePerMillion;
      if (options?.grounding && model.groundingCostPerRequest) {
        cost += model.groundingCostPerRequest;
      }
      return Math.round(cost * 1_000_000) / 1_000_000;
    }
  }
  throw new Error(`Model ${modelName} not found in pricing`);
}
```

</details>
