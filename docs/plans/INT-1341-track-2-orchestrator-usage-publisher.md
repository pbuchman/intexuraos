# INT-1341 — Track 2: Wire Orchestrator to llm-usage-service

## Status

- Linear issue: **INT-1341**
- Parent epic: **INT-1338** (LLM Usage Service Phase 2)
- Dependencies: none — Track 2 is independent and starts in Phase 1 parallel (alongside Track 1 and Track 4)
- Blocks: **INT-1342** (Track 3 — reuses `HttpInternalAuthUsageSink` shipped here)
- Plan version: **2.0** (full rewrite — 2026-04-10; supersedes v1.0 which described JSONL parsing)
- Author: Claude (agent thread)
- Authority: `docs/plans/INT-1338-decisions.md` Part 2 is the source of truth for all scope decisions.

---

## Executive summary

Two places in the orchestrator make LLM calls using the `LLMClient` interface directly:

1. `workers/orchestrator/src/services/agent-compliance-validator.ts:297` — `createOpenRouterClient({ usageSink: new StructuredLogUsageSink({ logger }) })`
2. `workers/orchestrator/src/services/completion-verifier.ts:810` — `createLlmClient({ usageSink: new StructuredLogUsageSink({ logger }) })`

Both currently use `StructuredLogUsageSink` — log-only, no Firestore writes, no usage tracking. This track replaces both with `HttpWebhookUsageSink`, a new sink in `packages/llm-pricing` that HMAC-signs usage events and POSTs them to `code-agent/internal/webhooks/usage-events`. Code-agent validates the HMAC (using `INTEXURAOS_ORCHESTRATOR_SECRET`, which it already holds), then forwards the events to `llm-usage-service/internal/usage/events` using `X-Internal-Auth`.

This track also ships `HttpInternalAuthUsageSink` — a second new sink for in-cluster apps (not the orchestrator) that call `llm-usage-service` directly with `X-Internal-Auth`. Track 3 reuses this sink when migrating all `FirestoreUsageSink` call sites.

**What this track explicitly does NOT do:**
- Parse JSONL session files or touch `turn-metrics-collector.ts`
- Add server-side cost calculation (all pricing is client-side, using the existing `PricingContext`)
- Add a feature flag
- Add a `UsagePublisher` class

---

## Pre-flight checks

Run these before opening a PR branch. Each is a hard blocker.

1. **Establish a green CI baseline.**
   ```bash
   pnpm run ci:tracked | tee /tmp/int-1341-baseline.txt
   ```
   Do not proceed if anything fails.

2. **Verify `packages/llm-pricing/dist/` exists.** The new sinks import from this package; `tsc` will fail with `Cannot find module` if dist is stale.
   ```bash
   pnpm build
   ```

3. **Re-read the two call sites before writing any code** to confirm line numbers have not drifted:
   - `workers/orchestrator/src/services/agent-compliance-validator.ts` — search for `usageSink: new StructuredLogUsageSink`
   - `workers/orchestrator/src/services/completion-verifier.ts` — same search

4. **Confirm code-agent already has `INTEXURAOS_ORCHESTRATOR_SECRET` in `REQUIRED_ENV`.**
   Verified at plan time: `apps/code-agent/src/index.ts` line 18 includes `'INTEXURAOS_ORCHESTRATOR_SECRET'`. No env var change needed for code-agent.

5. **Confirm code-agent does NOT yet have `INTEXURAOS_LLM_USAGE_SERVICE_URL`.** Verified at plan time — this env var is absent from `apps/code-agent/src/index.ts` and `apps/code-agent/src/services.ts`. Track 2 adds it (see Phase 3 env var wiring).

6. **Check the orchestrator's `INTEXURAOS_INTERNAL_AUTH_TOKEN`.** The orchestrator already reads this env var at `workers/orchestrator/src/start.ts:442`. It is passed to `WebhookClient` at line 541 and forwarded as `X-Internal-Auth` on all webhook calls. No new env var needed for the orchestrator.

---

## Context files

### Files to create (new)

- `packages/llm-pricing/src/httpWebhookUsageSink.ts` — new `HttpWebhookUsageSink` class implementing `UsageSink`. HMAC-signs usage events in `{timestamp}.{body}` format (matching `signPayload()` in `webhook-client.ts:24-27`) and POSTs to the target URL.
- `packages/llm-pricing/src/httpInternalAuthUsageSink.ts` — new `HttpInternalAuthUsageSink` class implementing `UsageSink`. Sends usage events to llm-usage-service using `X-Internal-Auth`. Ships here so Track 3 can immediately import it from `@intexuraos/llm-pricing`.
- `apps/code-agent/src/routes/internalUsageWebhookRoute.ts` — new Fastify plugin exposing `POST /internal/webhooks/usage-events`. Validates `X-Internal-Auth`, validates HMAC with `validateOrchestratorSignature`, delegates to `forwardUsageEvents` use case.
- `apps/code-agent/src/domain/usecases/forwardUsageEvents.ts` — use case that calls `UsageServiceClient.ingestEvents()` and returns `Result`.

### Files to modify

- `packages/llm-pricing/src/index.ts` — export the two new sink classes and their config types.
- `workers/orchestrator/src/services/agent-compliance-validator.ts:291-298` — replace `StructuredLogUsageSink` with `HttpWebhookUsageSink`.
- `workers/orchestrator/src/services/completion-verifier.ts:800-815` — replace `StructuredLogUsageSink` with `HttpWebhookUsageSink`.
- `apps/code-agent/src/services.ts` — add `usageServiceClient: UsageServiceClient` to `ServiceContainer` and `ServiceConfig`; initialize with `createUsageServiceClient(...)` in the factory; add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `ServiceConfig`.
- `apps/code-agent/src/index.ts` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `REQUIRED_ENV`.
- `apps/code-agent/src/config.ts` (or wherever `loadConfig()` lives) — add `llmUsageServiceUrl: string` from `process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL']`.
- `apps/code-agent/src/server.ts` (or equivalent route-registration entry point) — register `internalUsageWebhookRoute` plugin.
- `terraform/environments/dev/main.tf` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to code-agent's service env block (already defined as a terraform local at line 310; just add it to code-agent's var map).
- `ecosystem.config.cjs` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL: 'http://localhost:8132'` to code-agent's PM2 env block.
- `firestore-collections.json` — no change (no new collections).

### Reference files (read-only)

- `workers/orchestrator/src/services/webhook-client.ts:24-27` — `signPayload()`: `HMAC-SHA256(secret, "${timestamp}.${body}")`, hex-encoded. `HttpWebhookUsageSink` must sign with this exact format.
- `workers/orchestrator/src/services/webhook-client.ts:183-219` — `deliver()`: sets `X-Internal-Auth`, `X-Request-Timestamp`, `X-Request-Signature` headers.
- `apps/code-agent/src/infra/webhookValidation.ts:45-95` — `validateOrchestratorSignature()`: validates `X-Request-Timestamp` and `X-Request-Signature` headers using `INTEXURAOS_ORCHESTRATOR_SECRET`. The new route reuses this function exactly.
- `apps/code-agent/src/routes/webhookRoutes.ts:2045-2103` — turn-metrics webhook: the exact auth + HMAC validation pattern to mirror in the new route.
- `packages/internal-clients/src/usage-service/client.ts` — `createUsageServiceClient()` and `UsageServiceClient.ingestEvents()`. The forwarding use case calls this.
- `packages/internal-clients/src/usage-service/types.ts:81-97` — `UsageEventInput` and `UsageIngestRequest` shapes. The webhook body must deserialize to these types.
- `packages/llm-pricing/src/usageLogger.ts:105-107` — `UsageSink` interface: `log(params: UsageLogParams): Promise<void>`. Both new sinks implement this.
- `packages/llm-pricing/src/usageLogger.ts:83-107` — `UsageLogParams` fields: `userId`, `provider`, `model`, `callType`, `usage` (NormalizedUsage), `success`, `errorMessage?`. The new sinks map these to `UsageEventInput`.
- `apps/code-agent/src/routes/internalRoutes.ts:1-10` — reference for how internal routes start (logIncomingRequest, validateInternalAuth pattern).

---

## Endpoint changes

### Created

- `POST /internal/webhooks/usage-events` on `code-agent` — receives HMAC-signed usage events from the orchestrator, validates the shared `INTEXURAOS_ORCHESTRATOR_SECRET`, and forwards to `llm-usage-service`. Body: `UsageIngestRequest` (same schema as `POST /internal/usage/events` on llm-usage-service). Response: `{ success: true, data: { accepted: number, duplicates: number, rejected: RejectedEvent[] } }`. Auth: `X-Internal-Auth` (step 1) + HMAC (step 2, same as turn-metrics webhook).

### Unchanged

- `POST /internal/usage/events` on `llm-usage-service` — existing ingest endpoint, called by code-agent after HMAC validation. No schema changes in this track.
- All other `code-agent` and `llm-usage-service` routes — untouched.

### Removed

None.

---

## Step-by-step implementation

### Phase 1 — `HttpWebhookUsageSink` in `packages/llm-pricing`

**Goal:** A `UsageSink` that HMAC-signs events and POSTs them to a configurable URL.

#### Step 1.1 — Write a failing test first

Create `packages/llm-pricing/src/__tests__/httpWebhookUsageSink.test.ts`.

The test must:
- Use `nock` to intercept the POST request to a fake webhook URL.
- Assert that `X-Request-Timestamp` and `X-Request-Signature` headers are present.
- Assert that the signature matches `HMAC-SHA256(secret, "${timestamp}.${body}")` hex-encoded.
- Assert the request body matches the `UsageIngestRequest` schema (one event per `log()` call).
- Assert a successful `log()` call resolves without error when the server responds `200 { success: true, data: { accepted: 1, ... } }`.
- Assert a failed `log()` call (5xx response) logs a warning (using a fake logger) but does **not** throw — non-fatal per existing `StructuredLogUsageSink` behavior.

Run the test, confirm it fails with "module not found".

#### Step 1.2 — Implement `httpWebhookUsageSink.ts`

```
packages/llm-pricing/src/httpWebhookUsageSink.ts
```

Config interface:
```ts
export interface HttpWebhookUsageSinkConfig {
  webhookUrl: string;
  webhookSecret: string;
  service: string;       // fills source.service in UsageEventInput
  component: string;     // fills source.component
  logger: Logger;
}
```

Implementation notes:
- Import `createHmac` from `node:crypto`.
- `log(params: UsageLogParams): Promise<void>` maps `UsageLogParams` → `UsageEventInput`:
  - `eventId`: generate a random UUID or use `crypto.randomUUID()` — determinism is not required here since these are live calls, not JSONL replays.
  - `occurredAt`: `new Date().toISOString()`
  - `owner`: `{ type: 'system', id: params.userId }` (orchestrator calls are system-level; userId here is the task identifier passed through by the infra layer)
  - `source.service`: from config
  - `source.component`: from config
  - `source.client`: `params.model`
  - `source.environment`: read from `process.env['NODE_ENV'] === 'production' ? 'prod' : 'dev'`
  - `request.provider`: `params.provider`
  - `request.model`: `params.model`
  - `request.operation`: `params.callType` (types overlap exactly — both use the same union)
  - `request.success`: `params.success`
  - `request.durationMs`: `0` (not tracked at this level; NormalizedUsage doesn't include duration)
  - `usage`: map `NormalizedUsage` fields directly (inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, cachedTokens, reasoningTokens, thinkingTokens, webSearchCalls, groundingEnabled, imageCount)
  - `cost.billedUsd`: `params.usage.costUsd` (already calculated client-side by PricingContext)
  - `cost.providerReportedUsd`: `null`
  - `cost.calculatedUsd`: `params.usage.costUsd`
  - `cost.pricingSource`: `'calculated'`
  - `correlation`: all `null` fields; set `sessionId: null`, `taskId: null`, `requestId: null`, `traceId: null`, `attempt: null`, `researchId: null`
  - `error`: `params.success === false ? { code: null, message: params.errorMessage ?? null } : null`
- Sign and POST:
  ```ts
  const body = JSON.stringify({ schemaVersion: 1, events: [event] });
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${String(timestamp)}.${body}`;
  const signature = createHmac('sha256', config.webhookSecret).update(message).digest('hex');
  ```
  Headers: `X-Request-Timestamp: ${timestamp}`, `X-Request-Signature: ${signature}`, `X-Internal-Auth: ${config.internalAuthToken}`, `Content-Type: application/json`.

  Wait — the webhook route on code-agent validates BOTH `X-Internal-Auth` (step 1) and HMAC (step 2). The `HttpWebhookUsageSink` must send both. Add `internalAuthToken: string` to `HttpWebhookUsageSinkConfig`.

- Failure handling: wrap the fetch in try/catch. On any non-2xx or network error, call `config.logger.warn(...)` and return without throwing. The orchestrator must not fail a compliance validation or completion verification because of a usage reporting side effect.

#### Step 1.3 — Export from `packages/llm-pricing/src/index.ts`

Add:
```ts
export {
  HttpWebhookUsageSink,
  type HttpWebhookUsageSinkConfig,
} from './httpWebhookUsageSink.js';
```

Run the test from Step 1.1 — it must pass. Then run `pnpm run verify:workspace:tracked -- llm-pricing`.

---

### Phase 2 — `HttpInternalAuthUsageSink` in `packages/llm-pricing`

**Goal:** A `UsageSink` for in-cluster apps that call `llm-usage-service` directly using `X-Internal-Auth`. Ships here so Track 3 can import it without waiting.

#### Step 2.1 — Write a failing test first

Create `packages/llm-pricing/src/__tests__/httpInternalAuthUsageSink.test.ts`.

Similar to Phase 1 but simpler — no HMAC. Use `nock` to intercept the POST to `llm-usage-service/internal/usage/events`. Assert `X-Internal-Auth` header. Assert body matches `UsageIngestRequest`. Assert non-fatal on 5xx.

#### Step 2.2 — Implement `httpInternalAuthUsageSink.ts`

```
packages/llm-pricing/src/httpInternalAuthUsageSink.ts
```

Config interface:
```ts
export interface HttpInternalAuthUsageSinkConfig {
  usageServiceUrl: string;
  internalAuthToken: string;
  service: string;
  component: string;
  logger: Logger;
}
```

Implementation notes:
- Same `UsageLogParams` → `UsageEventInput` mapping as `HttpWebhookUsageSink` (extract to a shared private `buildUsageEvent()` helper or inline — fine to duplicate given the files are in the same package).
- POST to `${config.usageServiceUrl}/internal/usage/events` with `X-Internal-Auth: ${config.internalAuthToken}`.
- Same non-fatal failure handling (warn and return).

#### Step 2.3 — Export from `packages/llm-pricing/src/index.ts`

Add:
```ts
export {
  HttpInternalAuthUsageSink,
  type HttpInternalAuthUsageSinkConfig,
} from './httpInternalAuthUsageSink.js';
```

Run `pnpm run verify:workspace:tracked -- llm-pricing` — must stay green.

---

### Phase 3 — code-agent: add `UsageServiceClient` to service container

**Goal:** Wire `createUsageServiceClient` into code-agent's DI container so the forwarding use case can call it.

#### Step 3.1 — Add env var to all three required locations

Per CLAUDE.md env-vars rule, a new env var requires changes in three files:

1. `apps/code-agent/src/index.ts` — add `'INTEXURAOS_LLM_USAGE_SERVICE_URL'` to `REQUIRED_ENV` array.
2. `terraform/environments/dev/main.tf` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL = "https://${local.services.llm_usage_service.name}-${local.cloud_run_url_suffix}"` to code-agent's service env block (the local value is already defined at line 310 and used by other services; just add it to code-agent's map).
3. `ecosystem.config.cjs` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL: 'http://localhost:8132'` to code-agent's PM2 `env` block.

#### Step 3.2 — Update `ServiceContainer` and `ServiceConfig`

In `apps/code-agent/src/services.ts`:
- Add `usageServiceClient: UsageServiceClient` to `ServiceContainer` (not optional — all tests must provide it).
- Add `llmUsageServiceUrl: string` to `ServiceConfig`.
- In the factory function (wherever `setServices` is initialized from config), add:
  ```ts
  usageServiceClient: createUsageServiceClient({
    baseUrl: config.llmUsageServiceUrl,
    internalAuthToken: config.internalAuthToken,
    logger,
  }),
  ```
- Import `createUsageServiceClient` from `@intexuraos/internal-clients`.

#### Step 3.3 — Update config loading

In `apps/code-agent/src/config.ts` (or equivalent), add `llmUsageServiceUrl: string` field loaded from `process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL']`.

#### Step 3.4 — Update all `setServices()` calls in tests

Search for every `setServices({` call in `apps/code-agent/src/__tests__/`:
```
Grep: pattern="setServices\(" path="apps/code-agent/src/__tests__"
```
Every call site must add `usageServiceClient: fakeUsageServiceClient`. Create a `fakeUsageServiceClient` helper in the test utilities (a minimal in-memory fake that records calls and returns `ok({ accepted: 1, duplicates: 0, rejected: [] })`).

Run `pnpm run verify:workspace:tracked -- code-agent` after this step — expect TypeScript errors on the `setServices` call sites until all are updated.

---

### Phase 4 — code-agent: `forwardUsageEvents` use case

#### Step 4.1 — Write a failing test first

Create `apps/code-agent/src/__tests__/domain/usecases/forwardUsageEvents.test.ts`.

Test matrix:
- Happy path: `usageServiceClient.ingestEvents()` returns `ok(...)` → use case returns `ok(...)`.
- Service error: `usageServiceClient.ingestEvents()` returns `err(...)` → use case returns `err(...)`.

#### Step 4.2 — Implement `forwardUsageEvents.ts`

Create `apps/code-agent/src/domain/usecases/forwardUsageEvents.ts`:

```ts
import type { Logger, Result } from '@intexuraos/common-core';
import type { UsageServiceClient, UsageIngestRequest, UsageIngestResponse, UsageServiceError } from '@intexuraos/internal-clients';

export interface ForwardUsageEventsDeps {
  usageServiceClient: UsageServiceClient;
  logger: Logger;
}

export async function forwardUsageEvents(
  request: UsageIngestRequest,
  deps: ForwardUsageEventsDeps
): Promise<Result<UsageIngestResponse, UsageServiceError>> {
  const result = await deps.usageServiceClient.ingestEvents(request);
  if (!result.ok) {
    deps.logger.error({ error: result.error }, 'Failed to forward usage events to llm-usage-service');
    return result;
  }
  deps.logger.info(
    { accepted: result.value.accepted, duplicates: result.value.duplicates },
    'Usage events forwarded to llm-usage-service'
  );
  return result;
}
```

Run the test from Step 4.1 — it must pass.

---

### Phase 5 — code-agent: `internalUsageWebhookRoute`

#### Step 5.1 — Write a failing test first

Create `apps/code-agent/src/__tests__/routes/internalUsageWebhookRoute.test.ts`.

Use `app.inject()` to POST to `/internal/webhooks/usage-events`.

Test matrix:
- Missing `X-Internal-Auth` → 401.
- Valid `X-Internal-Auth` but missing `X-Request-Signature` → 401.
- Valid `X-Internal-Auth` but invalid HMAC → 401.
- Valid `X-Internal-Auth` + valid HMAC + valid body → 200 `{ success: true, data: { accepted: 1, duplicates: 0, rejected: [] } }`.
- Valid auth but `usageServiceClient.ingestEvents()` returns error → 500.
- Valid auth + valid body with zero events → 200 `{ success: true, data: { accepted: 0, duplicates: 0, rejected: [] } }`.

For the HMAC tests, compute the expected signature as `HMAC-SHA256(orchestratorSecret, "${timestamp}.${body}")` in the test setup.

#### Step 5.2 — Implement `internalUsageWebhookRoute.ts`

Create `apps/code-agent/src/routes/internalUsageWebhookRoute.ts`:

```ts
import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { validateOrchestratorSignature } from '../infra/webhookValidation.js';
import { loadConfig } from '../config.js';
import { getServices } from '../services.js';
import { forwardUsageEvents } from '../domain/usecases/forwardUsageEvents.js';

export const internalUsageWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post('/internal/webhooks/usage-events', {
    schema: { /* ... see below */ },
  }, async (request, reply) => {
    logIncomingRequest(request);

    // Step 1: Validate X-Internal-Auth
    const authResult = validateInternalAuth(request);
    if (!authResult.valid) {
      request.log.warn({ reason: authResult.reason }, 'Internal auth failed for usage-events webhook');
      return reply.fail('UNAUTHORIZED', 'Internal authentication failed');
    }

    // Step 2: Validate orchestrator HMAC signature
    const signatureResult = validateOrchestratorSignature(request, {
      orchestratorSecret: loadConfig().orchestratorSecret,
    });
    if (!signatureResult.ok) {
      request.log.warn({ error: signatureResult.error }, 'HMAC validation failed for usage-events webhook');
      return reply.fail('UNAUTHORIZED', 'Unauthorized');
    }

    // Step 3: Forward to llm-usage-service
    const { usageServiceClient, logger } = getServices();
    const result = await forwardUsageEvents(request.body, { usageServiceClient, logger });
    if (!result.ok) {
      return reply.fail('INTERNAL_ERROR', result.error.message);
    }

    return reply.ok(result.value);
  });

  done();
};
```

Schema for the route: body is `UsageIngestRequest` shape (`schemaVersion: 1`, `events: array`). Response 200 is `{ success: true, data: { accepted: number, duplicates: number, rejected: array } }`. Response 401 and 500 follow the standard error shape.

**Note on `reply.fail` / `reply.ok`:** Use whatever reply helpers code-agent uses in existing routes (`webhookRoutes.ts` uses `reply.fail(code, message)` — use the same).

#### Step 5.3 — Register the route

In `apps/code-agent/src/server.ts` (or wherever routes are registered), add:
```ts
import { internalUsageWebhookRoute } from './routes/internalUsageWebhookRoute.js';
// ...
server.register(internalUsageWebhookRoute);
```

Run `pnpm run verify:workspace:tracked -- code-agent` — all tests must pass.

---

### Phase 6 — Orchestrator: swap `StructuredLogUsageSink` for `HttpWebhookUsageSink`

#### Step 6.1 — Confirm orchestrator's env vars

The orchestrator already reads at `workers/orchestrator/src/start.ts`:
- `INTEXURAOS_CODE_AGENT_URL` (line 441)
- `INTEXURAOS_ORCHESTRATOR_SECRET` (line 443)
- `INTEXURAOS_INTERNAL_AUTH_TOKEN` (line 442)

No new env vars needed for the orchestrator itself.

#### Step 6.2 — Update `agent-compliance-validator.ts`

In `workers/orchestrator/src/services/agent-compliance-validator.ts`, update the constructor or factory method that creates the client (around line 291):

Before:
```ts
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
// ...
usageSink: new StructuredLogUsageSink({ logger }),
```

After:
```ts
import { HttpWebhookUsageSink } from '@intexuraos/llm-pricing';
// ...
usageSink: new HttpWebhookUsageSink({
  webhookUrl: `${config.codeAgentUrl}/internal/webhooks/usage-events`,
  webhookSecret: config.orchestratorSecret,
  internalAuthToken: config.internalAuthToken,
  service: 'orchestrator',
  component: 'agent-compliance-validator',
  logger,
}),
```

Where `config` is the object already available in scope (it contains `codeAgentUrl` and `orchestratorSecret` per `start.ts` wiring).

#### Step 6.3 — Update `completion-verifier.ts`

In `workers/orchestrator/src/services/completion-verifier.ts`, update the `createLlmClient` call (around line 800):

Before:
```ts
import { StructuredLogUsageSink } from '@intexuraos/llm-pricing';
// ...
usageSink: new StructuredLogUsageSink({ logger: this.logger }),
```

After:
```ts
import { HttpWebhookUsageSink } from '@intexuraos/llm-pricing';
// ...
usageSink: new HttpWebhookUsageSink({
  webhookUrl: `${this.config.codeAgentUrl}/internal/webhooks/usage-events`,
  webhookSecret: this.config.orchestratorSecret,
  internalAuthToken: this.config.internalAuthToken,
  service: 'orchestrator',
  component: 'completion-verifier',
  logger: this.logger,
}),
```

Verify that `CompletionVerifierConfig` (or its constructor) already holds `codeAgentUrl`, `orchestratorSecret`, and `internalAuthToken`. If not, thread them through from the `start.ts` wiring at lines 752-754.

#### Step 6.4 — Verify orchestrator tests still pass

```bash
pnpm run verify:workspace:tracked -- orchestrator
```

The orchestrator tests use `FakeWebhookClient` for webhook interactions. The new `HttpWebhookUsageSink` is tested separately in `packages/llm-pricing`. Orchestrator tests that construct `AgentComplianceValidator` or `CompletionVerifier` will need a stub `HttpWebhookUsageSink` (use `NoopUsageSink` or a test-specific `HttpWebhookUsageSink` with a `nock`-intercepted URL). If the existing tests pass `usageSink` as a constructor arg, swap them; if the sink is constructed internally, pass a `NoopUsageSink` via config or use `nock`.

---

### Phase 7 — Final verification

```bash
pnpm run ci:tracked | tee /tmp/int-1341-final.txt
```

Expected: zero failures across all workspaces. Verify:
- `packages/llm-pricing` — new sink tests pass, coverage ≥ 95%.
- `apps/code-agent` — new route tests pass, coverage ≥ 95%.
- `workers/orchestrator` — no regressions.

---

## Test plan

### `packages/llm-pricing`

| Test file                           | Scenario                                        | Coverage target                  |
| ----------------------------------- | ----------------------------------------------- | -------------------------------- |
| `httpWebhookUsageSink.test.ts`      | Successful POST, correct HMAC headers           | HMAC signing, body serialization |
| `httpWebhookUsageSink.test.ts`      | 5xx response — non-fatal, logs warning          | Failure path                     |
| `httpWebhookUsageSink.test.ts`      | Network error — non-fatal, logs warning         | Failure path                     |
| `httpInternalAuthUsageSink.test.ts` | Successful POST, correct X-Internal-Auth header | Happy path                       |
| `httpInternalAuthUsageSink.test.ts` | 5xx response — non-fatal, logs warning          | Failure path                     |

### `apps/code-agent`

| Test file                           | Scenario                                          | Coverage target  |
| ----------------------------------- | ------------------------------------------------- | ---------------- |
| `forwardUsageEvents.test.ts`        | `ingestEvents` returns ok → use case returns ok   | Happy path       |
| `forwardUsageEvents.test.ts`        | `ingestEvents` returns err → use case returns err | Error path       |
| `internalUsageWebhookRoute.test.ts` | Missing X-Internal-Auth → 401                     | Auth guard       |
| `internalUsageWebhookRoute.test.ts` | Invalid HMAC → 401                                | HMAC guard       |
| `internalUsageWebhookRoute.test.ts` | Valid auth + valid body → 200                     | Happy path       |
| `internalUsageWebhookRoute.test.ts` | Valid auth + usageServiceClient error → 500       | Error path       |
| `internalUsageWebhookRoute.test.ts` | Valid auth + empty events array → 200             | Edge case        |

---

## Rollout plan

Track 2 is pure additive — no existing behavior changes until the orchestrator deploys with `HttpWebhookUsageSink` active.

1. **PR merge order:** `packages/llm-pricing` changes (Phases 1-2) must be built and published (or at least built in the monorepo) before the apps that import them. In this monorepo, `pnpm build` handles this — just ensure the build order is correct before opening the PR.
2. **Deploy code-agent first.** The new `POST /internal/webhooks/usage-events` route is additive. Deploy code-agent with `INTEXURAOS_LLM_USAGE_SERVICE_URL` set. Verify the route returns 401 on an unsigned test request (smoke test).
3. **Deploy orchestrator second.** Once code-agent is live with the webhook route, deploy the orchestrator with `HttpWebhookUsageSink`. On the next compliance validation or completion verification, a usage event will be POSTed.
4. **Verify end-to-end.** Trigger a code task to completion (or run a manual compliance validation). Check `llm_usage_events` Firestore collection in `intexuraos-dev-pbuchman` — expect one event per LLM call with `source.service = 'orchestrator'`.
5. **No rollback complexity.** The only observable change is: usage events from orchestrator start appearing in Firestore. If the webhook route or forwarding fails, `HttpWebhookUsageSink` logs a warning and returns — the orchestrator task continues. Zero user-visible impact on failure.

---

## Acceptance criteria

- [ ] `packages/llm-pricing` exports `HttpWebhookUsageSink` and `HttpInternalAuthUsageSink`.
- [ ] `POST /internal/webhooks/usage-events` on code-agent returns 401 for missing/invalid auth/HMAC.
- [ ] `POST /internal/webhooks/usage-events` on code-agent returns 200 and forwards events to llm-usage-service for valid requests.
- [ ] `agent-compliance-validator.ts` no longer imports `StructuredLogUsageSink`.
- [ ] `completion-verifier.ts` no longer imports `StructuredLogUsageSink`.
- [ ] `pnpm run ci:tracked` passes with zero failures.
- [ ] A real or simulated compliance validation or completion verification produces a `llm_usage_events` document in Firestore with `source.service = 'orchestrator'`.
- [ ] No new feature flags added.
- [ ] `turn-metrics-collector.ts` is not modified.

---

## Risks

| Risk                                                                                                          | Likelihood  | Mitigation                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpWebhookUsageSink` send failure causes orchestrator regression                                            | Low         | Non-fatal by design — failure is logged and swallowed, matching `StructuredLogUsageSink` semantics                                    |
| `UsageLogParams` fields do not map cleanly to `UsageEventInput` (e.g., missing correlation fields)            | Low         | Verified at plan time: all required fields in `UsageEventInput` are either derivable from `UsageLogParams` or set to `null`/`0`       |
| Code-agent `ServiceContainer` tests break because `usageServiceClient` is now required                        | Medium      | Fully mitigated in Phase 3.4 — all `setServices()` calls updated with a fake client before any code lands                             |
| `CompletionVerifier` or `AgentComplianceValidator` config does not expose `codeAgentUrl`/`orchestratorSecret` | Low         | Verified at plan time: `start.ts` lines 561-563 and 752-754 pass both fields to both services                                         |
| `INTEXURAOS_LLM_USAGE_SERVICE_URL` not set on home-dev code-agent process (PM2)                               | Medium      | Mitigated by adding to `ecosystem.config.cjs`; if process was already running, `pm2 restart code-agent` is needed after config update |

---

## Out of scope

- `workers/orchestrator/src/services/turn-metrics-collector.ts` — untouched.
- JSONL session file parsing of any kind.
- `UsagePublisher` class or any orchestrator-level batching abstraction.
- Server-side cost calculation (Track 4 dropped it entirely; client-side `PricingContext` is sufficient).
- Feature flag of any kind.
- Changes to `llm-usage-service` ingest endpoint schema.
- Migration of `FirestoreUsageSink` call sites in other services — that is Track 3 (INT-1342), which reuses `HttpInternalAuthUsageSink` from this track.
- `INTEXURAOS_ORCHESTRATOR_SECRET` env var management — already present in orchestrator and code-agent.
