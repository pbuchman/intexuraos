# LLM Usage Service — Tutorial

> **Time:** 20-30 minutes
> **Prerequisites:** Node.js 20+, GCP project access, valid Auth0 token or internal auth token
> **You'll learn:** How to ingest LLM usage events, query aggregated data, and manage pricing

---

## What You'll Build

A working integration that:

- Ingests LLM usage events from an internal service
- Queries aggregated usage data grouped by provider, model, and prompt type
- Requests a research-run cost summary by `researchId`
- Retrieves individual event details with full correlation data

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS dev environment
- [ ] A valid `INTEXURAOS_INTERNAL_AUTH_TOKEN` for internal endpoints
- [ ] A valid Auth0 bearer token for public endpoints
- [ ] The llm-usage-service running (check `GET /health`)

---

## Part 1: Health Check (2 minutes)

Verify the service is running and healthy.

### Step 1.1: Check Service Health

```bash
curl -s http://localhost:8080/health | jq .
```

**Expected response:**

```json
{
  "status": "ok",
  "serviceName": "llm-usage-service",
  "version": "0.0.1",
  "timestamp": "2026-04-22T10:00:00.000Z",
  "checks": [
    { "name": "secrets", "status": "ok", "latencyMs": 0 },
    { "name": "firestore", "status": "ok", "latencyMs": 12 }
  ]
}
```

### What Just Happened?

The health endpoint verified that required secrets (`INTEXURAOS_INTERNAL_AUTH_TOKEN`, `INTEXURAOS_ORCHESTRATOR_SECRET`) are configured and that Firestore is reachable.

---

## Part 2: Ingest a Usage Event (10 minutes)

Submit an LLM usage event through the internal endpoint.

### Step 2.1: Prepare the Event Payload

```json
{
  "schemaVersion": 2,
  "events": [
    {
      "schemaVersion": 2,
      "eventId": "evt-tutorial-001",
      "occurredAt": "2026-04-22T10:00:00.000Z",
      "owner": { "type": "user", "id": "user-123" },
      "source": {
        "service": "research-agent",
        "component": "synthesis",
        "client": "research-agent/v1",
        "environment": "dev"
      },
      "request": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "operation": "research",
        "success": true,
        "durationMs": 3500,
        "promptType": "research-synthesis"
      },
      "usage": {
        "inputTokens": 12000,
        "outputTokens": 3000,
        "totalTokens": 15000,
        "cacheReadTokens": 5000,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "reasoningTokens": 0,
        "thinkingTokens": 0,
        "webSearchCalls": 0,
        "groundingEnabled": false,
        "imageCount": 0
      },
      "cost": {
        "providerReportedUsd": null,
        "pricingSource": "pending"
      },
      "correlation": {
        "requestId": "req-abc-123",
        "traceId": "trace-xyz-789",
        "taskId": "task_tutorial_001",
        "researchId": "res_tutorial_001",
        "attempt": 1,
        "sessionId": null
      },
      "error": null
    }
  ]
}
```

### Step 2.2: Send the Request

```bash
curl -X POST http://localhost:8080/internal/usage/events \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d @event.json
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "accepted": 1,
    "duplicates": 0,
    "rejected": []
  }
}
```

### Step 2.3: Verify Idempotency

Send the same request again:

```bash
curl -X POST http://localhost:8080/internal/usage/events \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d @event.json
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "accepted": 0,
    "duplicates": 1,
    "rejected": []
  }
}
```

**Checkpoint:** The duplicate count incremented instead of creating a second event. Firestore's `.create()` prevents overwrites using the `eventId` as document key.

---

## Part 3: Query Usage Data (10 minutes)

### Step 3.1: Retrieve the Event by ID

```bash
curl -s http://localhost:8080/events/evt-tutorial-001 \
  -H "Authorization: Bearer $AUTH0_TOKEN" | jq .
```

**Expected response:** The full enriched event with server-computed fields (`receivedAt`, `ingress`, resolved `cost`).

### Step 3.2: List Events in a Time Range

```bash
curl -X POST http://localhost:8080/events/list \
  -H "Authorization: Bearer $AUTH0_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timeRange": {
      "from": "2026-04-22T00:00:00.000Z",
      "to": "2026-04-22T23:59:59.999Z"
    },
    "sortBy": { "field": "occurredAt", "direction": "desc" },
    "limit": 10
  }'
```

### Step 3.3: Query Aggregated Usage

```bash
curl -X POST http://localhost:8080/query \
  -H "Authorization: Bearer $AUTH0_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timeRange": {
      "from": "2026-04-01T00:00:00.000Z",
      "to": "2026-04-30T23:59:59.999Z"
    },
    "groupBy": ["request.provider", "request.model", "request.promptType"],
    "sortBy": { "field": "costUsd", "direction": "desc" },
    "limit": 20
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "group": {
          "request.provider": "anthropic",
          "request.model": "claude-sonnet-4-20250514",
          "request.promptType": "research-synthesis"
        },
        "metrics": {
          "calls": 1,
          "costUsd": 0.042,
          "inputTokens": 12000,
          "outputTokens": 3000,
          "totalTokens": 15000,
          ...
        }
      }
    ],
    "totals": { "calls": 1, "costUsd": 0.042, ... }
  }
}
```

**Checkpoint:** The aggregated query returns rows grouped by your specified dimensions with summed metrics and overall totals.

### Step 3.4: Summarize a Research Run

```bash
curl -X POST http://localhost:8080/internal/usage/research-cost-summary \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "researchId": "res_tutorial_001",
    "owner": { "type": "user", "id": "user-123" },
    "timeRange": {
      "from": "2026-04-22T00:00:00.000Z",
      "to": "2026-04-22T23:59:59.999Z"
    }
  }'
```

**Expected response:** `totals` with calls, tokens, image count, and cost; `rows` with each correlated usage event; and `diagnostics.missingAttribution` for owner/time-range matching events that were not linked to any `researchId`.

---

## Part 4: Manage Pricing (5 minutes)

### Step 4.1: Read Current Pricing

```bash
curl -s http://localhost:8080/internal/pricing \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" | jq '.data.anthropic.models | keys'
```

This shows all Anthropic model IDs that have pricing configured.

### Step 4.2: Write Pricing for a Provider

```bash
curl -X POST http://localhost:8080/internal/pricing \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "anthropic",
    "models": {
      "claude-sonnet-4-20250514": {
        "inputPricePerMillion": 3.0,
        "outputPricePerMillion": 15.0,
        "cacheReadMultiplier": 0.1,
        "cacheWriteMultiplier": 1.25,
        "webSearchCostPerCall": 0.01
      }
    },
    "updatedAt": "2026-04-22T10:00:00.000Z"
  }'
```

Note: The pricing cache has a 5-minute TTL. New pricing takes effect for ingestion within 5 minutes.

---

## Troubleshooting

| Problem                                      | Solution                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| "401 Unauthorized" on internal endpoint      | Verify `X-Internal-Auth: Bearer <token>` header matches configured secret |
| "401 Unauthorized" on public endpoint        | Verify Auth0 bearer token is valid and not expired                        |
| "400 Invalid request" on ingest              | Check `schemaVersion: 2` and all required fields are present              |
| Cost shows as `0` after ingestion            | Verify pricing exists for the provider/model via `GET /internal/pricing`  |
| Aggregate query returns empty rows           | Aggregates are keyed by date — ensure the time range covers event dates   |
| Prompt type appears as `__missing__` in query rows | The source event did not include `request.promptType`                     |

---

## Next Steps

Now that you understand the basics:

1. Explore the [OpenAPI spec](http://localhost:8080/docs) for full schema details
2. Read the [Technical Reference](technical.md) for architecture and cost calculation details
3. Set up the orchestrator webhook endpoint with HMAC signature validation

---

## Exercises

Test your understanding:

1. **Easy:** Ingest an event with `pricingSource: "provider_reported"` and `providerReportedUsd: 0.05` — verify the stored event uses the provider-reported cost instead of calculating it
2. **Medium:** Query usage grouped by `day`, `request.operation`, and `request.promptType` for the last 7 days, sorted by `totalTokens` descending
3. **Hard:** Ingest 5 events with different providers and models, then write a query that identifies which provider has the highest cost-per-call ratio

<details>
<summary>Solutions</summary>

### Exercise 1: Provider-Reported Cost

```bash
curl -X POST http://localhost:8080/internal/usage/events \
  -H "X-Internal-Auth: Bearer $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": 2,
    "events": [{
      "schemaVersion": 2,
      "eventId": "evt-exercise-1",
      "occurredAt": "2026-04-22T11:00:00.000Z",
      "owner": { "type": "user", "id": "user-123" },
      "source": { "service": "test", "component": "tutorial", "client": "curl", "environment": "dev" },
      "request": { "provider": "openai", "model": "gpt-5.4", "operation": "generate", "success": true, "durationMs": 2000 },
      "usage": { "inputTokens": 1000, "outputTokens": 500, "totalTokens": 1500, "cacheReadTokens": 0, "cacheWriteTokens": 0, "cachedTokens": 0, "reasoningTokens": 0, "thinkingTokens": 0, "webSearchCalls": 0, "groundingEnabled": false, "imageCount": 0 },
      "cost": { "providerReportedUsd": 0.05, "pricingSource": "provider_reported" },
      "correlation": { "requestId": null, "traceId": null, "taskId": null, "researchId": null, "attempt": null, "sessionId": null },
      "error": null
    }]
  }'
```

Then verify: `GET /events/evt-exercise-1` should show `cost.billedUsd: 0.05` and `cost.pricingSource: "provider_reported"`.

### Exercise 2: Multi-Dimension Query

```bash
curl -X POST http://localhost:8080/query \
  -H "Authorization: Bearer $AUTH0_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timeRange": {
      "from": "2026-04-15T00:00:00.000Z",
      "to": "2026-04-22T23:59:59.999Z"
    },
    "groupBy": ["day", "request.operation", "request.promptType"],
    "sortBy": { "field": "totalTokens", "direction": "desc" }
  }'
```

### Exercise 3: Cost-Per-Call Analysis

Ingest events for multiple providers, then query grouped by `request.provider`. The cost-per-call ratio is `costUsd / calls` for each row.

</details>
