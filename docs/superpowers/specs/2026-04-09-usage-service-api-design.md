# LLM Usage Service API and Data Model Specification

**Date:** 2026-04-09  
**Status:** Draft for review  
**Service Name:** `llm-usage-service`  
**Audience:** Implementation worker creating the service and the shared internal client  
**Out of Scope:** migration, rollout, consumer replacement, Terraform, dashboards, billing policy

## Purpose

Define the first implementation stage of a new internal-only service that becomes the authoritative ingestion point for LLM usage events across IntexuraOS.

This stage is intentionally limited to:

- the HTTP API shape
- the authentication model
- the event and aggregate data model
- the shared internal client contract
- the delivery checkpoints needed to create the service cleanly

This stage does **not** include replacing existing usage storage or wiring every caller to the new service yet.

## Why This Service Exists

LLM usage is currently fragmented:

- shared provider clients write aggregated usage to `llm_usage_stats`
- audit logging writes detailed request metadata to `llm_api_logs`
- `code-agent` keeps a separate `user_usage` store for quota and estimated spend
- orchestrator verifier and compliance-validator usage is only structured-logged

That split creates four concrete failures:

1. There is no single authoritative ingestion API for LLM usage.
2. Important token subtypes are lost in the current shared aggregate path.
3. Orchestrator usage is not captured in the same analytics system as other services.
4. Spend concentration by service, component, model, and client implementation is hard to answer reliably.

The new service exists to fix those design problems with one internal contract.

## Decision Summary

Build a new Cloud Run app named `llm-usage-service` with:

- one internal ingest endpoint for normal services authenticated by `X-Internal-Auth`
- one webhook-style ingest endpoint for orchestrator authenticated by HMAC headers
- one internal aggregate query endpoint for cost and usage analysis
- one canonical immutable `UsageEvent` record shape
- one Firestore-backed raw-event store plus one Firestore-backed daily aggregate store
- one new `@intexuraos/internal-clients` usage-service client for normal services

Do **not** add any user-scoped public endpoint in this stage.

## Existing Repo Patterns To Reuse

The implementation must reuse existing repo patterns instead of inventing new ones:

- Service scaffolding: `.claude/commands/create-service.md`
- Internal auth: `validateInternalAuth(...)` from `@intexuraos/common-http`
- Orchestrator webhook auth: current `validateOrchestratorSignature(...)` pattern, implemented locally in `llm-usage-service` because apps cannot import from `apps/code-agent`
- Internal client style: `packages/internal-clients/src/user-service/*`
- Response envelope style: `reply.ok(...)` and `reply.fail(...)`
- Route logging: `logIncomingRequest()` on every endpoint before auth and use-case execution
- Service structure: routes + domain + infra with clean architecture boundaries
- Firestore registry: `firestore-collections.json` ownership registration for every new collection

## Required Service Scaffolding Command

Use the standard service creation command:

```text
/create-service llm-usage-service
```

The command already includes the scaffold checklist. The implementation worker must only add one mandatory verification step after running it:

- confirm that the generated app structure matches `.claude/commands/create-service.md`

Do not hand-roll the initial service skeleton if the command succeeds.

## Scope

### In Scope

- `llm-usage-service` API contract
- auth model for internal services and orchestrator
- request and response schemas
- canonical event shape
- Firestore data model for raw events and aggregates
- shared usage-service internal client
- internal aggregate query endpoint needed to answer cost concentration questions

### Out of Scope

- migration from `llm_usage_stats`, `llm_api_logs`, or `user_usage`
- replacing current provider usage logging in this same task
- consumer rollout across all services
- public or user JWT endpoints
- orchestrator turn metrics unrelated to LLM usage events
- dashboards or UI

## Service Boundary

`llm-usage-service` is an internal infrastructure service. Its only job is:

1. validate incoming usage events
2. deduplicate them by `eventId`
3. persist immutable raw events
4. maintain aggregate usage counters
5. expose internal-only aggregate queries

It is **not** responsible for:

- prompt or response auditing
- end-user settings
- quota decisions
- pricing model configuration
- user-facing reporting pages

## API Surface

| Method | Path                               | Auth                    | Purpose                                                                        |
| ------ | ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| POST   | `/internal/usage/events`           | `X-Internal-Auth`       | Ingest usage events from normal services                                       |
| POST   | `/internal/webhooks/usage-events`  | Orchestrator HMAC       | Ingest usage events from orchestrator without exposing the internal auth token |
| POST   | `/internal/usage/query`            | `X-Internal-Auth`       | Query aggregated usage and cost concentration                                  |
| GET    | `/health`                          | none                    | Standard service health endpoint                                               |

There must be **no** user-scoped public endpoint in this stage.

## Route Conventions

Every route in this service must call `logIncomingRequest()` before authentication and before invoking the use case.

This applies to:

- `POST /internal/usage/events`
- `POST /internal/webhooks/usage-events`
- `POST /internal/usage/query`
- `GET /health`

## Authentication Design

### 1. Internal Service Calls

Used by normal services inside IntexuraOS.

Headers:

- `X-Internal-Auth: <token>`
- `X-Trace-Id: <optional-trace-id>`

Validation:

- use the existing `validateInternalAuth(...)` pattern

Applies to:

- `POST /internal/usage/events`
- `POST /internal/usage/query`

### 2. Orchestrator Webhook Calls

Used only by orchestrator.

Headers:

- `X-Request-Timestamp: <unix-seconds>`
- `X-Request-Signature: <hex-hmac>`

Validation:

- reuse the existing orchestrator webhook signing model
- implement the HMAC validation locally inside `llm-usage-service` by following the existing `code-agent` pattern; do not import from `apps/code-agent`
- signature input must match the existing repo pattern: `${timestamp}.${JSON.stringify(body)}`
- reject requests older than 15 minutes
- use `INTEXURAOS_ORCHESTRATOR_SECRET`

Applies to:

- `POST /internal/webhooks/usage-events`

### 3. Separation Rules

These rules are mandatory:

- the webhook endpoint must not accept `X-Internal-Auth` as its authentication mechanism
- the internal endpoint must not accept unsigned orchestrator traffic
- orchestrator must not be given the internal service auth token

## Common Response Envelope

All authenticated endpoints must follow the normal internal response shape:

Successful response:

```json
{
  "success": true,
  "data": {}
}
```

Failure response:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human-readable message"
  }
}
```

Recommended failure codes for this service:

- `UNAUTHORIZED`
- `INVALID_REQUEST`
- `NOT_FOUND`
- `INTERNAL_ERROR`

## Ingest API Contract

### Endpoint

`POST /internal/usage/events`  
`POST /internal/webhooks/usage-events`

Both endpoints accept the same payload shape. The only difference is authentication.

### Request Body

```json
{
  "schemaVersion": 1,
  "events": [
    {
      "eventId": "14bb54ff-0fb7-4f4f-bab0-a6c63a0ad329",
      "occurredAt": "2026-04-09T13:45:00.000Z",
      "owner": {
        "type": "user",
        "id": "auth0|abc123"
      },
      "source": {
        "service": "research-agent",
        "component": "summary-generator",
        "client": "infra-gemini",
        "environment": "dev"
      },
      "request": {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "operation": "generate",
        "success": true,
        "durationMs": 1840
      },
      "usage": {
        "inputTokens": 1000,
        "outputTokens": 240,
        "totalTokens": 1240,
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "reasoningTokens": 0,
        "thinkingTokens": 50,
        "webSearchCalls": 0,
        "groundingEnabled": false,
        "imageCount": 0
      },
      "cost": {
        "billedUsd": 0.00132,
        "providerReportedUsd": null,
        "calculatedUsd": 0.00132,
        "pricingSource": "calculated"
      },
      "correlation": {
        "requestId": "req_123",
        "traceId": "trace_123",
        "taskId": null,
        "researchId": "res_456",
        "attempt": null,
        "sessionId": null
      },
      "error": null
    }
  ]
}
```

### Ingest Response

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

Rejected items must be reported per index:

```json
{
  "success": true,
  "data": {
    "accepted": 1,
    "duplicates": 1,
    "rejected": [
      {
        "index": 2,
        "code": "INVALID_REQUEST",
        "message": "usage.totalTokens must be >= 0"
      }
    ]
  }
}
```

### Ingest Validation Rules

- `schemaVersion` is required and must be `1`
- `events` is required and must be non-empty
- `eventId` is required
- `occurredAt` must be a valid ISO timestamp
- `owner.type` must be `user` or `system`
- `owner.id` is required
- `source.service`, `source.component`, `source.client`, and `source.environment` are required
- `request.provider`, `request.model`, `request.operation`, `request.success`, and `request.durationMs` are required
- all numeric usage fields must be integers `>= 0`
- `cost.billedUsd` is required and must be `>= 0`
- `providerReportedUsd` and `calculatedUsd` are optional and may be `null`
- `error` may be `null` even when `success=false`
- `success=false` events may still have non-zero usage and cost

### Ingest Semantics

- event ingestion must be idempotent by `eventId`
- duplicates are treated as successful no-op events
- partial acceptance inside a batch is allowed
- the service sets `receivedAt`; callers do not send it
- the service records which ingress path accepted the event: `internal` or `orchestrator_webhook`

### Orchestrator-Specific Rules

For `POST /internal/webhooks/usage-events`:

- `source.service` must equal `orchestrator`
- `owner.type` will usually be `system`
- `correlation.taskId` and `correlation.attempt` are strongly recommended when the event came from a task execution

## Query API Contract

### Endpoint

`POST /internal/usage/query`

### Purpose

This endpoint exists so internal systems can answer questions like:

- which service is generating the most cost
- which component within a service is the most expensive
- how much spend belongs to a given user or system owner
- which models and providers dominate usage

### Request Body

```json
{
  "timeRange": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "filters": {
    "ownerTypes": ["user", "system"],
    "ownerIds": ["auth0|abc123", "orchestrator-completion-verifier"],
    "services": ["research-agent", "orchestrator"],
    "components": ["summary-generator", "completion-verifier"],
    "clients": ["infra-gemini", "infra-openrouter"],
    "providers": ["google", "openrouter"],
    "models": ["gemini-2.5-flash"],
    "operations": ["generate", "tool_calling"],
    "success": true
  },
  "groupBy": ["source.service", "source.component", "request.model"],
  "sortBy": {
    "field": "costUsd",
    "direction": "desc"
  },
  "limit": 50
}
```

### Allowed `groupBy` Dimensions

- `day`
- `owner.type`
- `owner.id`
- `source.service`
- `source.component`
- `source.client`
- `request.provider`
- `request.model`
- `request.operation`
- `request.success`

### Query Response

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "group": {
          "source.service": "research-agent",
          "source.component": "summary-generator",
          "request.model": "gemini-2.5-flash"
        },
        "metrics": {
          "calls": 1200,
          "costUsd": 18.45,
          "inputTokens": 800000,
          "outputTokens": 125000,
          "totalTokens": 925000,
          "cacheReadTokens": 0,
          "cacheWriteTokens": 0,
          "cachedTokens": 0,
          "reasoningTokens": 0,
          "thinkingTokens": 42000,
          "webSearchCalls": 0,
          "imageCount": 0
        }
      }
    ],
    "totals": {
      "calls": 1200,
      "costUsd": 18.45,
      "inputTokens": 800000,
      "outputTokens": 125000,
      "totalTokens": 925000,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "cachedTokens": 0,
      "reasoningTokens": 0,
      "thinkingTokens": 42000,
      "webSearchCalls": 0,
      "imageCount": 0
    }
  }
}
```

### Query Rules

- `timeRange.from` and `timeRange.to` are required
- `limit` defaults to `100` and must be capped to a safe maximum such as `500`
- `sortBy.field` must be one of the returned metric fields
- query must run against aggregate documents, not by scanning raw events directly
- if `groupBy` is empty, return one totals row only
- prefer a date-range aggregate fetch plus in-memory regrouping so the first implementation does not depend on multi-field Firestore queries
- if later filtering requires multi-field Firestore queries, add the required composite index migration in `migrations/*.mjs`

## Canonical Event Schema

This is the authoritative logical model stored after ingestion.

```ts
interface UsageEvent {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  receivedAt: string;
  ingress: 'internal' | 'orchestrator_webhook';

  owner: {
    type: 'user' | 'system';
    id: string;
  };

  source: {
    service: string;
    component: string;
    client: string;
    environment: 'dev' | 'prod' | 'test';
  };

  request: {
    provider: 'google' | 'openai' | 'anthropic' | 'perplexity' | 'openrouter';
    model: string;
    operation:
      | 'research'
      | 'generate'
      | 'image_generation'
      | 'tool_calling'
      | 'visualization_insights'
      | 'visualization_vegalite'
      | 'other';
    success: boolean;
    durationMs: number;
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
    billedUsd: number;
    providerReportedUsd: number | null;
    calculatedUsd: number | null;
    pricingSource: 'provider_reported' | 'calculated' | 'mixed' | 'external';
  };

  correlation: {
    requestId: string | null;
    traceId: string | null;
    taskId: string | null;
    researchId: string | null;
    attempt: number | null;
    sessionId: string | null;
  };

  error: {
    code: string | null;
    message: string | null;
  } | null;
}
```

### Provider Values

`request.provider` stays a closed union in stage 1. Unknown providers should be rejected instead of silently accepted, and adding a new provider is a deliberate schema update rather than an implicit string expansion.

## Concrete Firestore Data Model

Use Firestore in stage 1 because it matches existing repo infrastructure and avoids inventing a new storage dependency.

### Collection 1: Raw Events

Collection:

```text
llm_usage_events/{eventId}
```

Rules:

- document ID is `eventId`
- document is immutable after successful create
- if create fails because the document already exists, treat as duplicate
- this collection is the source of truth for ingestion history and deduplication
- register `llm_usage_events` in `firestore-collections.json` with `owner: "llm-usage-service"`

Required stored fields:

- the full canonical `UsageEvent`
- optional `ingestMetadata.requestIp` if easy to capture
- optional `ingestMetadata.traceId` copied from headers for debugging

### Collection 2: Daily Aggregates

Collection:

```text
llm_usage_daily_aggregates/{aggregateId}
```

One document represents one day and one exact dimension tuple:

- `date`
- `owner.type`
- `owner.id`
- `source.service`
- `source.component`
- `source.client`
- `source.environment`
- `request.provider`
- `request.model`
- `request.operation`
- `request.success`

Recommended `aggregateId` shape:

```text
{date}__{ownerType}__{ownerIdHash}__{service}__{component}__{client}__{provider}__{modelHash}__{operation}__{success}
```

Deterministic encoding rules:

- normalize `owner.id` and `request.model` exactly as received
- compute `ownerIdHash` as lowercase hex SHA-256 truncated to 32 characters
- compute `modelHash` as lowercase hex SHA-256 truncated to 32 characters
- keep the unhashed dimensions human-readable in the aggregate ID

This keeps the key deterministic, avoids delimiter collisions from values like `auth0|abc123`, and still leaves enough readable context for debugging.

Required aggregate fields:

```ts
interface DailyUsageAggregate {
  aggregateId: string;
  date: string; // YYYY-MM-DD

  ownerType: 'user' | 'system';
  ownerId: string;

  sourceService: string;
  sourceComponent: string;
  sourceClient: string;
  sourceEnvironment: string;

  provider: string;
  model: string;
  operation: string;
  success: boolean;

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

  firstOccurredAt: string;
  lastOccurredAt: string;
  updatedAt: string;
}
```

Register `llm_usage_daily_aggregates` in `firestore-collections.json` with `owner: "llm-usage-service"`.

### Aggregate Write Rule

Aggregate updates must happen **only** after the raw event create succeeds.

That means:

- new raw event -> update aggregate
- duplicate raw event -> do not update aggregate

This is what keeps idempotency correct.

## Data Modeling Rules

### Owner Attribution

Owner is mandatory and must be explicit in the payload.

Examples:

- `{ "type": "user", "id": "auth0|abc123" }`
- `{ "type": "system", "id": "orchestrator-completion-verifier" }`
- `{ "type": "system", "id": "orchestrator-compliance-validator" }`

The service must not infer owner from auth headers.

### Source Attribution

Every event must include:

- `source.service`
- `source.component`
- `source.client`

This is mandatory because the business requirement is to answer where costs are concentrated.

Examples:

- `research-agent` / `summary-generator` / `infra-gemini`
- `image-service` / `prompt-adapter` / `infra-openrouter`
- `orchestrator` / `completion-verifier` / `infra-gpt`

### Token Modeling

Keep token subtypes as first-class fields.

Rules:

- `cacheReadTokens` and `cacheWriteTokens` stay separate
- `cachedTokens` stays separate for providers that only expose cached input tokens
- `reasoningTokens` and `thinkingTokens` stay separate
- `totalTokens` is stored exactly as reported by the caller

`cacheWriteTokens` is the canonical cross-provider field for values currently represented in some clients as cache creation tokens.

### Cost Modeling

`cost.billedUsd` is the authoritative reporting value.

Use:

- `providerReportedUsd` when the upstream provider directly reports cost
- `calculatedUsd` when cost was derived from pricing tables
- `pricingSource` to explain how `billedUsd` was chosen

This is required because some providers expose direct API call cost while others do not.

## Shared Internal Client Design

Add a new client to `@intexuraos/internal-clients` that mirrors the style of the existing user-service client.

Recommended package layout:

```text
packages/internal-clients/src/
  usage-service/
    client.ts
    types.ts
    index.ts
```

### `UsageServiceConfig`

```ts
interface UsageServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}
```

### `UsageServiceClient`

```ts
interface UsageServiceClient {
  ingestEvents(
    request: UsageIngestRequest,
    options?: { traceId?: string }
  ): Promise<Result<UsageIngestResponse, UsageServiceError>>;

  queryUsage(
    request: UsageQueryRequest,
    options?: { traceId?: string }
  ): Promise<Result<UsageQueryResponse, UsageServiceError>>;
}
```

### `UsageServiceError`

```ts
interface UsageServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'VALIDATION_ERROR';
  message: string;
}
```

### Client Implementation Rules

- mirror the method surface and error envelope of the user-service client
- use `fetchWithAuth(...)` from `packages/internal-clients/src/shared/errors.ts` even though the older user-service client still uses inline `fetch()`; `fetchWithAuth` is the newer preferred shared pattern
- keep the success envelope consistent with existing internal clients
- support optional `traceId`
- do not add orchestrator webhook auth to this package

## Orchestrator Position

Do **not** make orchestrator depend on `@intexuraos/internal-clients` in this stage.

Reason:

- orchestrator does not currently depend on that package
- orchestrator uses a different auth model
- coupling low-level webhook delivery to the internal client package does not simplify the design

Recommended orchestrator implementation when rollout happens later:

- create a small local sender that posts to `/internal/webhooks/usage-events`
- reuse the existing HMAC signing helper pattern

Implementation note for stage 1:

- keep the webhook validator local to `llm-usage-service/src/infra/` even if the logic mirrors `apps/code-agent/src/infra/webhookValidation.ts`
- do not introduce a cross-app import
- do not expand scope by extracting the validator to a shared package in this task; that cleanup can happen later if multiple services need the same helper

## Future `LLMClient` Integration Contract

This stage does not implement the rollout, but the API must support the planned integration shape.

The future direction should be:

```ts
interface LlmUsageReporter {
  report(event: UsageEventInput): Promise<void>;
}
```

Important design rule:

- low-level `LLMClient` implementations should depend on a required reporter interface
- they should **not** depend directly on `@intexuraos/internal-clients`

That keeps provider packages transport-agnostic while still allowing:

- normal services to use an HTTP reporter backed by `UsageServiceClient`
- orchestrator to use a webhook reporter with HMAC signing

## Required Delivery Checkpoints

The implementation worker must deliver all of the following:

1. New app scaffolded with `/create-service llm-usage-service` and scaffold verified.
2. Authenticated internal ingest endpoint implemented.
3. Authenticated orchestrator webhook ingest endpoint implemented.
4. Internal aggregate query endpoint implemented.
5. Firestore raw-event and daily-aggregate repositories implemented.
6. OpenAPI schemas for all endpoints implemented.
7. Shared `@intexuraos/internal-clients` usage-service client implemented.
8. Tests for auth, ingestion, deduplication, aggregate writes, and query grouping implemented.
9. Health endpoint preserved and working.
10. Final verification completed before PR creation.

## What The Worker Must Not Do In This Stage

- do not migrate old usage data
- do not delete old usage paths
- do not update all existing LLM clients to point to this service
- do not add end-user endpoints
- do not include Claude/Codex runtime turn metrics

## Implementation Plan Reference

Detailed execution steps live in:

`docs/superpowers/plans/2026-04-09-llm-usage-service-implementation-plan.md`

That plan is the operational handoff for the Claude worker.
