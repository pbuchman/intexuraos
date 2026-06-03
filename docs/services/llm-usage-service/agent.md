# LLM Usage Service — Agent Interface

> **Machine-readable specification for AI agent integration**

## Identity

| Attribute | Value                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| Name      | llm-usage-service                                                                   |
| Role      | Ingest, store, and aggregate LLM API usage events with cost calculation             |
| Goal      | Provide a single source of truth for LLM costs and token usage across all providers |

## Capabilities

### Ingest Usage Events (Internal)

**Endpoint:** `POST /internal/usage/events`
**Auth:** `X-Internal-Auth: Bearer <token>`

**When to use:** After completing an LLM API call, to record token usage and cost data.

**Input Schema:**

```typescript
interface IngestRequest {
  schemaVersion: 2;
  events: UsageEventInput[];
}

interface UsageEventInput {
  schemaVersion: 2;
  eventId: string;
  occurredAt: string; // ISO 8601
  owner: { type: 'user' | 'system'; id: string };
  source: {
    service: string;
    component: string;
    client: string;
    environment: 'dev' | 'prod' | 'test';
    workerLocation?: string;
  };
  request: {
    provider: 'google' | 'openai' | 'anthropic' | 'perplexity' | 'openrouter';
    model: string;
    operation: 'research' | 'generate' | 'image_generation' | 'tool_calling' | 'other';
    success: boolean;
    durationMs: number;
    promptType?: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    thinkingTokens: number;
    webSearchCalls: number;
    groundingEnabled: boolean;
    imageCount: number;
  };
  cost: {
    providerReportedUsd: number | null;
    pricingSource: 'pending' | 'provider_reported';
  };
  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };
  error: { code: string | null; message: string | null } | null;
}
```

**Output Schema:**

```typescript
interface IngestResponse {
  accepted: number;
  duplicates: number;
  rejected: Array<{ index: number; code: string; message: string }>;
}
```

**Example:**

```json
// Request
{
  "schemaVersion": 2,
  "events": [{
    "schemaVersion": 2,
    "eventId": "evt-abc-123",
    "occurredAt": "2026-04-22T10:00:00.000Z",
    "owner": { "type": "system", "id": "code-agent" },
    "source": { "service": "code-agent", "component": "executor", "client": "code-agent/v1", "environment": "prod" },
    "request": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "operation": "generate", "success": true, "durationMs": 4200 },
    "usage": { "inputTokens": 10000, "outputTokens": 2000, "totalTokens": 12000, "cacheReadTokens": 3000, "cacheWriteTokens": 0, "cachedTokens": 0, "reasoningTokens": 0, "thinkingTokens": 0, "webSearchCalls": 0, "groundingEnabled": false, "imageCount": 0 },
    "cost": { "providerReportedUsd": null, "pricingSource": "pending" },
    "correlation": { "requestId": "req-1", "traceId": null, "taskId": "task_xyz", "researchId": null, "attempt": 1, "sessionId": null },
    "error": null
  }]
}

// Response
{ "accepted": 1, "duplicates": 0, "rejected": [] }
```

### Query Aggregated Usage

**Endpoint:** `POST /query`
**Auth:** Auth0 Bearer token

**When to use:** To get summarized usage data grouped by dimensions (provider, model, day, etc.).

**Input Schema:**

```typescript
interface UsageQueryRequest {
  timeRange: { from: string; to: string };
  filters?: {
    ownerTypes?: ('user' | 'system')[];
    ownerIds?: string[];
    services?: string[];
    providers?: string[];
    models?: string[];
    operations?: string[];
    success?: boolean;
  };
  groupBy?: Array<'day' | 'owner.type' | 'owner.id' | 'source.service' | 'source.component' | 'source.client' | 'request.provider' | 'request.model' | 'request.operation' | 'request.success'>;
  sortBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number; // default 100, max 500
}
```

**Output Schema:**

```typescript
interface UsageQueryResponse {
  rows: Array<{
    group: Record<string, string | boolean>;
    metrics: AggregateMetrics;
  }>;
  totals: AggregateMetrics;
}

interface AggregateMetrics {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  webSearchCalls: number;
  imageCount: number;
}
```

### List Usage Events

**Endpoint:** `POST /events/list`
**Auth:** Auth0 Bearer token

**When to use:** To browse individual LLM call events with filtering, sorting, and cursor pagination.

**Input Schema:**

```typescript
interface ListRequest {
  timeRange: { from: string; to: string };
  filters?: UsageEventFilters;
  sortBy?: { field: 'occurredAt' | 'costUsd' | 'totalTokens'; direction: 'asc' | 'desc' };
  limit?: number; // default 50, max 200
  cursor?: string; // base64url-encoded cursor from previous response
}
```

### Get All Pricing

**Endpoint:** `GET /internal/pricing`
**Auth:** `X-Internal-Auth: Bearer <token>`

**When to use:** At service boot to fetch pricing data for all providers.

**Output Schema:**

```typescript
interface PricingResponse {
  google: ProviderPricing;
  openai: ProviderPricing;
  anthropic: ProviderPricing;
  perplexity: ProviderPricing;
  openrouter: ProviderPricing;
}
```

## Constraints

**Do NOT:**

- Send events with `schemaVersion: 1` — only `schemaVersion: 2` is accepted on input
- Use `request.promptType` as a `groupBy` field in aggregate queries — it is not an allowed dimension
- Assume pricing is immediately available after writing — the cache has a 5-minute TTL
- Send webhook events without HMAC signature — the endpoint rejects unsigned requests

**Requires:**

- Pricing data must be seeded via `POST /internal/pricing` before cost calculation works
- Events must have unique `eventId` values — duplicates are silently counted, not stored twice
- Orchestrator webhook events must have `source.service === 'orchestrator'` and `source.workerLocation` set

## Usage Patterns

### Pattern 1: Post-LLM-Call Ingestion

```
1. Complete an LLM API call
2. Build UsageEventInput with token counts and correlation IDs
3. If provider reports cost: set pricingSource = "provider_reported", providerReportedUsd = cost
4. If provider does not report cost: set pricingSource = "pending", providerReportedUsd = null
5. POST /internal/usage/events with schemaVersion: 2
6. Service calculates cost (if pending) and stores event + updates daily aggregate
```

### Pattern 2: Dashboard Data Fetch

```
1. POST /query with desired groupBy dimensions and time range
2. Render rows as chart/table data
3. Use totals for summary metrics
4. For drill-down: POST /events/list with matching filters
```

### Pattern 3: Pricing Bootstrap

```
1. At service boot: GET /internal/pricing to fetch all provider pricing
2. Cache locally for cost estimation before sending events
3. Periodically refresh to pick up pricing updates
```

## Error Handling

| Error Code | Meaning                              | Recovery Action                          |
| ---------- | ------------------------------------ | ---------------------------------------- |
| 400        | Invalid input (schema validation)    | Fix request payload per schema           |
| 401        | Auth failed (internal or Auth0)      | Check auth header format and token       |
| 404        | Event not found (getById)            | Verify eventId exists                    |
| 500        | Internal error (Firestore failure)   | Retry with backoff                       |

## Events Published

None. This service is a data sink — it receives events but does not publish to Pub/Sub.

## Dependencies

| Service    | Why Needed                          | Failure Behavior                                     |
| ---------- | ----------------------------------- | ---------------------------------------------------- |
| Firestore  | Event storage and aggregation       | 500 errors on all data operations                    |
| Pricing DB | Cost calculation for pending events | Events stored with `billedUsd: 0` and warning logged |
