# LLM Usage Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a new internal-only `llm-usage-service` that accepts LLM usage events from internal services and orchestrator, stores immutable raw events, maintains daily aggregates, and exposes an internal aggregate query API plus a shared internal service client.

**Architecture:** Create a new Cloud Run app using `/create-service llm-usage-service`. The service uses two authenticated ingest routes, one internal query route, and Firestore-backed raw event plus daily aggregate repositories. Normal services call it through `@intexuraos/internal-clients`. Orchestrator support is only the webhook-compatible endpoint in this stage, not consumer rollout.

**Tech Stack:** TypeScript, Fastify, Firestore, `@intexuraos/common-http`, `@intexuraos/http-contracts`, `@intexuraos/internal-clients`, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-usage-service-api-design.md`

**Out of Scope:** migration, replacing current callers, dashboards, user-scoped endpoints, Claude/Codex runtime turn metrics

---

### Task 1: Scaffold `llm-usage-service` with the standard service command

**Files:**
- Create: `apps/llm-usage-service/*`

- [ ] **Step 1: Run the standard scaffold command**

Use:

```text
/create-service llm-usage-service
```

- [ ] **Step 2: Verify the scaffold instead of rebuilding it manually**

Double-check that the generated service matches `.claude/commands/create-service.md`:

- `apps/llm-usage-service/package.json`
- `apps/llm-usage-service/Dockerfile`
- `apps/llm-usage-service/src/index.ts`
- `apps/llm-usage-service/src/services.ts`
- `apps/llm-usage-service/src/domain/`
- `apps/llm-usage-service/src/infra/`
- `apps/llm-usage-service/src/routes/`

If the command succeeded, do not replace the scaffold with a custom layout.

- [ ] **Step 3: Update service metadata and required env vars**

Adjust the scaffold so the new service validates the env vars it actually needs in stage 1:

- `INTEXURAOS_GCP_PROJECT_ID`
- `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- `INTEXURAOS_ORCHESTRATOR_SECRET`
- standard Sentry/environment vars already used by the repo

- [ ] **Step 4: Verify the service still boots with the scaffolded health route**

Expected outcome:

- `/health` remains available
- service name is `llm-usage-service`
- no missing-import or missing-config errors remain from scaffold cleanup

---

### Task 2: Define the domain model and use-case boundaries

**Files:**
- Create: `apps/llm-usage-service/src/domain/models/usageEvent.ts`
- Create: `apps/llm-usage-service/src/domain/models/usageQuery.ts`
- Create: `apps/llm-usage-service/src/domain/repositories/usageEventRepository.ts`
- Create: `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts`
- Create: `apps/llm-usage-service/src/domain/usecases/queryUsage.ts`

- [ ] **Step 1: Add canonical type definitions matching the spec**

Define domain types for:

- `UsageEventInput`
- `UsageEvent`
- `UsageIngestRequest`
- `UsageIngestResponse`
- `UsageQueryRequest`
- `UsageQueryResponse`
- aggregate metric types

- [ ] **Step 2: Add repository interfaces in the domain layer**

Define ports for:

- creating raw events idempotently
- incrementing daily aggregates
- querying aggregate documents by time range and filters

- [ ] **Step 3: Implement domain use cases without Firestore imports**

Required use cases:

- `ingestUsageEvents`
- `queryUsage`

The use cases should:

- validate allowed `groupBy` and `sortBy` values
- handle duplicate events correctly
- keep route/controller logic thin

---

### Task 3: Implement Firestore persistence for raw events and daily aggregates

**Files:**
- Create: `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts`
- Create: `apps/llm-usage-service/src/infra/firestore/firestoreUsageQueryRepository.ts`
- Create any small helper modules needed for aggregate keys or date partitioning

- [ ] **Step 1: Implement raw event persistence using `llm_usage_events/{eventId}`**

Requirements:

- document ID is `eventId`
- writes must be immutable create operations
- duplicate `eventId` must be detected cleanly

- [ ] **Step 2: Implement daily aggregate upserts using `llm_usage_daily_aggregates/{aggregateId}`**

Requirements:

- aggregate dimensions match the spec exactly
- counters increment only for newly accepted raw events
- date granularity is daily

- [ ] **Step 3: Keep idempotency correct**

The aggregate update must only happen after raw event creation succeeds.

This is the key correctness rule for the whole service.

- [ ] **Step 4: Add repository tests for duplicate handling and aggregate increments**

Required test cases:

- first insert creates raw event and aggregate
- duplicate insert does not change aggregate counters
- multiple events on same day and same dimensions increment one aggregate doc
- same day but different component or model creates separate aggregate docs

---

### Task 4: Implement the authenticated ingest endpoints

**Files:**
- Create: `apps/llm-usage-service/src/routes/internalUsageRoutes.ts`
- Create: `apps/llm-usage-service/src/routes/webhookUsageRoutes.ts`
- Update: service route registration files created by scaffold

- [ ] **Step 1: Implement `POST /internal/usage/events`**

Requirements:

- authenticate with `validateInternalAuth(...)`
- validate request body against the spec
- return partial acceptance information
- accept optional `X-Trace-Id`

- [ ] **Step 2: Implement `POST /internal/webhooks/usage-events`**

Requirements:

- use the existing orchestrator webhook signature pattern
- validate `X-Request-Timestamp`
- validate `X-Request-Signature`
- reject callers trying to use internal auth instead of webhook auth

- [ ] **Step 3: Enforce ingress-specific business rules**

Required rules:

- webhook endpoint only accepts `source.service === "orchestrator"`
- service sets `ingress` to `internal` or `orchestrator_webhook`
- `receivedAt` is generated by the service, never trusted from caller payload

- [ ] **Step 4: Add route tests**

Required test cases:

- internal auth missing -> `401`
- webhook signature missing or expired -> `401`
- valid internal batch with one duplicate and one invalid event -> partial success response
- valid orchestrator payload accepted

---

### Task 5: Implement the internal aggregate query endpoint

**Files:**
- Update: `apps/llm-usage-service/src/routes/internalUsageRoutes.ts`
- Update: query use case and repositories from Tasks 2-3

- [ ] **Step 1: Implement `POST /internal/usage/query`**

Requirements:

- internal auth only
- validate `timeRange`, `filters`, `groupBy`, `sortBy`, and `limit`
- reject unsupported dimensions clearly

- [ ] **Step 2: Query aggregate documents, not raw events**

The implementation should:

- fetch matching daily aggregate docs
- regroup in memory according to `groupBy`
- compute `rows` and `totals`
- support sort descending by `costUsd` for “where is the spend” questions

- [ ] **Step 3: Add query tests**

Required test cases:

- no `groupBy` returns totals only
- grouping by `source.service` and `source.component` returns ranked rows
- filters by owner, model, and success work together
- limit is enforced

---

### Task 6: Add OpenAPI schemas and route registration

**Files:**
- Update: `apps/llm-usage-service/src/server.ts`
- Update: route modules
- Update: any schema registration helpers created by scaffold

- [ ] **Step 1: Register core schemas and endpoint schemas**

Every new route must expose:

- request body schema
- success response schema
- error response schema
- correct `security` declaration for internal endpoints

- [ ] **Step 2: Keep the route layout aligned with repo conventions**

Use:

- `/internal/...` for normal internal routes
- `/internal/webhooks/...` for orchestrator webhook route
- `/health` for the unauthenticated health endpoint

---

### Task 7: Add the shared internal client

**Files:**
- Create: `packages/internal-clients/src/usage-service/client.ts`
- Create: `packages/internal-clients/src/usage-service/types.ts`
- Create: `packages/internal-clients/src/usage-service/index.ts`
- Update: `packages/internal-clients/src/index.ts`
- Create: `packages/internal-clients/src/usage-service/__tests__/client.test.ts`

- [ ] **Step 1: Implement `createUsageServiceClient(...)`**

Mirror the shape of the user-service client and reuse `fetchWithAuth(...)`.

- [ ] **Step 2: Implement typed methods**

Required methods:

- `ingestEvents(...)`
- `queryUsage(...)`

- [ ] **Step 3: Add client tests**

Required test cases:

- internal auth header is sent
- `traceId` is forwarded
- success response is parsed correctly
- HTTP error maps to `API_ERROR`
- network failure maps to `NETWORK_ERROR`

---

### Task 8: Wire dependencies and keep clean architecture boundaries

**Files:**
- Update: `apps/llm-usage-service/src/services.ts`
- Update: any route/use-case wiring files created by scaffold

- [ ] **Step 1: Instantiate Firestore-backed repositories in `services.ts`**

Keep Firestore dependencies in `infra`, not in domain or route modules.

- [ ] **Step 2: Inject use cases into routes through the service container**

Routes should call use cases, not repository implementations directly.

- [ ] **Step 3: Verify ESLint architecture boundaries are respected**

Specifically confirm:

- domain does not import infra
- routes do not implement business logic
- Firestore code stays in infra

---

### Task 9: Final verification before PR

**Files:**
- All changed files

- [ ] **Step 1: Run targeted tests for the new app and internal client**

At minimum, run:

- `pnpm vitest run apps/llm-usage-service`
- `pnpm vitest run packages/internal-clients/src/usage-service/__tests__/client.test.ts`

If the service uses named Vitest projects instead of direct paths, use the matching repo command.

- [ ] **Step 2: Run local typecheck and lint for touched workspaces**

At minimum:

- service typecheck
- service lint
- internal-clients typecheck
- internal-clients tests

- [ ] **Step 3: Run the required final repo verification**

Before commit and PR, run:

```bash
pnpm run ci:tracked
```

If this is too heavy for the environment, document exactly what was run and what remains.

- [ ] **Step 4: Confirm stage-1 boundaries were preserved**

Double-check that the implementation did **not**:

- migrate old data
- wire all callers to the new service
- add user endpoints
- include Claude/Codex runtime turn metrics

---

### Delivery Checklist

- [ ] `llm-usage-service` exists as a new app
- [ ] `/internal/usage/events` implemented
- [ ] `/internal/webhooks/usage-events` implemented
- [ ] `/internal/usage/query` implemented
- [ ] `/health` implemented and working
- [ ] Firestore raw event store implemented
- [ ] Firestore daily aggregate store implemented
- [ ] Shared usage-service internal client implemented
- [ ] Auth and deduplication tests implemented
- [ ] Query grouping tests implemented
- [ ] Final verification completed
