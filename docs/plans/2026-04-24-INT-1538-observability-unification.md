# INT-1538 — Observability & Error Handling Unification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Linear:** [INT-1538](https://linear.app/pbuchman/issue/INT-1538)
**Parent:** [INT-1473](https://linear.app/pbuchman/issue/INT-1473)
**Source evidence:** [`docs/reviews/2026-04-24-refactoring-analysis.md §10`](../reviews/2026-04-24-refactoring-analysis.md)

**Goal:** Unify observability primitives (Sentry, OTel, structured logging, typed errors, custom metrics) across every service and package, propagate trace / request correlation across HTTP and Pub/Sub boundaries, and harden the alerting surface.

**Architecture:** Centralize a `initWorker()` bootstrap in `packages/infra-sentry` (Sentry + OTel-aware log stream + release/sampling/PII scrub). Expose a shared `requestContext` AsyncLocalStorage in `packages/common-core/tracing` that both `packages/internal-clients` and `packages/infra-pubsub` read to forward `x-request-id`/`x-correlation-id`. Wrap LLM provider calls in OTel spans and record `durationMs` on `UsageLogger`. Migrate remaining `throw new Error(...)` call-sites to `IntexuraOSError` and update the Fastify error handler to honour `httpStatus` and skip Sentry for 4xx. Create a new leaf `packages/common-metrics` wrapper for Cloud Monitoring custom-metric emission; wire it into orchestrator + code-agent flows.

**Tech stack:** Node 22, TypeScript strict, Fastify, Pino, `@sentry/node`, `@opentelemetry/sdk-node`, `@google-cloud/pubsub`, `@google-cloud/monitoring`, Terraform.

---

## Endpoint Changes

- **Modified:** Every existing HTTP route inherits the hardened Fastify error handler (4xx → no Sentry, typed mapping via `IntexuraOSError.httpStatus`). No URL or payload changes.
- **Created:** None.
- **Removed:** None.
- **Unchanged:** All REST surface; this refactor is observability-only.

---

## Shared Contracts (Frozen — every subtask implements against these)

### 1. `initWorker()` — `packages/infra-sentry/src/initWorker.ts`

```ts
export interface WorkerBootstrapConfig {
  serviceName: string;                         // e.g. 'orchestrator'
  environment: string;                         // dev | prod
  sentryDsn?: string;                          // INTEXURAOS_SENTRY_DSN
  release?: string;                            // K_REVISION (Cloud Run) or git sha
  tracesSampleRate?: number;                   // default 0 dev, 0.1 prod
  extraLogStreamTags?: Record<string, string>;
}

export interface WorkerBootstrap {
  logger: import('pino').Logger;               // already wired to logStream + OTel transport
  flush: () => Promise<void>;                  // flush Sentry + Pino on shutdown
}

export function initWorker(cfg: WorkerBootstrapConfig): WorkerBootstrap;
```

Internally it MUST:
1. Call `initSentry` with `beforeSend` (see §2), `release`, `tracesSampleRate`, `serverName = serviceName`.
2. Build a Pino logger via `createAppLogger` + `createLogStream` with OTel transport attached.
3. Return `{ logger, flush }` so callers can `await flush()` in `SIGTERM`.

### 2. Sentry `beforeSend` contract

Drop events where `event.contexts?.response?.status_code` is `< 500`.
Redact the following keys everywhere they appear in `event.extra`, `event.contexts`, `event.breadcrumbs[*].data`:

```ts
export const SENTRY_REDACT_KEYS = [
  'authorization', 'cookie', 'set-cookie', 'x-internal-auth',
  'apiKey', 'api_key', 'token', 'refreshToken', 'password',
  'githubToken', 'anthropicApiKey', 'openaiApiKey',
] as const;
```

Replace values with the string `'[REDACTED]'`.

### 3. `requestContext` — `packages/common-core/src/tracing/requestContext.ts`

```ts
export interface RequestContext {
  requestId: string;          // x-request-id (generated if absent)
  correlationId: string;      // === requestId at the HTTP edge
  traceId?: string;           // OTel trace id if active
  parentId?: string;          // upstream x-request-id for cross-service chains
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T;
export function getRequestContext(): RequestContext | undefined;
export function getRequestId(): string | undefined;  // convenience
```

Backed by `AsyncLocalStorage`. MUST be initialized in `logIncomingRequest()` inside `packages/http-server` on every request BEFORE the route handler runs.

### 4. Outbound header contract — `packages/internal-clients`

All outbound `fetch` / `httpRequest` helpers MUST read `getRequestId()` and inject:

- `x-request-id: <id>` (always)
- `x-correlation-id: <id>` (always — same as request id at edge)
- `traceparent: <otel-traceparent>` (if OTel active; emitted by `@opentelemetry/instrumentation-http` automatically — verify in tests)

### 5. Pub/Sub correlation contract — `packages/infra-pubsub`

`BasePubSubPublisher.publishToTopic(...)` MUST set message attributes:

```ts
{
  'x-request-id': ctx.requestId,
  'x-correlation-id': ctx.correlationId,
  'publisher-service': process.env['INTEXURAOS_SERVICE_NAME'] ?? 'unknown',
}
```

Consumers MUST use a new `extractCorrelation(message.attributes)` helper that returns `RequestContext` and wraps the handler in `runWithRequestContext`.

### 6. LLM observability contract — `packages/llm-factory` (+ providers)

Every provider `generate()` call MUST be wrapped in an OTel span named `llm.<provider>.generate` with attributes:

```
llm.provider           = 'claude' | 'gpt' | 'gemini' | 'perplexity' | 'openrouter'
llm.model              = <model-id>
llm.input_tokens       = <number>
llm.output_tokens      = <number>
llm.cached_input_tokens= <number>
llm.cost_usd           = <number>
llm.duration_ms        = <number>
```

`UsageLogger.record(...)` gains a `durationMs: number` field (required) persisted to Firestore `llm_usage_events`.

### 7. `common-metrics` — `packages/common-metrics/src/index.ts` (NEW PACKAGE)

```ts
export interface MetricLabel { [k: string]: string }

export interface CustomMetric<L extends MetricLabel = MetricLabel> {
  readonly name: string;                         // e.g. 'code_tasks_completed'
  readonly type: 'counter' | 'gauge' | 'distribution';
  readonly unit: string;                         // '1', 'ms', 'By'
  readonly description: string;
}

export interface MetricsClient {
  increment<L extends MetricLabel>(m: CustomMetric<L>, labels: L, by?: number): void;
  record<L extends MetricLabel>(m: CustomMetric<L>, labels: L, value: number): void;
  flush(): Promise<void>;
}

export function createMetricsClient(cfg: {
  projectId: string;
  serviceName: string;
  logger: import('pino').Logger;
}): MetricsClient;

// Registry of descriptors declared in terraform — must match `cloud-monitoring-metrics.tf`.
export const CODE_TASK_METRICS = {
  COMPLETED: { name: 'code_tasks_completed', type: 'counter', unit: '1', description: '...' },
  FAILED:    { name: 'code_tasks_failed',    type: 'counter', unit: '1', description: '...' },
  DURATION:  { name: 'code_task_duration',   type: 'distribution', unit: 'ms', description: '...' },
} as const;
```

### 8. `IntexuraOSError` Fastify mapping

The Fastify `setErrorHandler` in `packages/http-server` MUST:
- If `err instanceof IntexuraOSError`: reply `{ code, message, details? }` with `err.httpStatus`; do NOT forward to Sentry if `httpStatus < 500`.
- Otherwise: reply `{ code: 'INTERNAL_ERROR', message: 'Internal Server Error' }` with `500`; forward to Sentry.
- Always log with `err` key (not `error`) and include `requestId` from `getRequestContext()`.

---

## Subtask Breakdown (executed in parallel — one PR each)

> All subtasks target branch `development`. Each PR title is `[INT-1538-S<N>] <title>` and body references both the parent (`Fixes INT-1538-S<N>`) and this plan doc.
>
> Subtasks never depend on each other at runtime — every consumer re-declares the contract as a local shim if its producer has not yet landed, and the shim is deleted in a final cleanup commit once the producer's PR merges. The plan doc is the single source of truth for the shim signature.

### S1 — `packages/infra-sentry`: Harden init + `initWorker()`
- **Files:** `packages/infra-sentry/src/init.ts`, `src/initWorker.ts` (new), `src/redact.ts` (new), `src/__tests__/*`, `src/index.ts`.
- **Scope:**
  - Add `beforeSend` implementing §2 (unit tests cover redaction + 4xx drop).
  - Add `release` (read from `K_REVISION` env), `tracesSampleRate` per-env default (0 dev / 0.1 prod).
  - Export `initWorker()` per §1 (new file). It MUST bind Pino logger + `createLogStream` + Sentry, and return `{ logger, flush }`.
  - Emit `SENTRY_REDACT_KEYS` as a named export.
- **Acceptance:**
  - `initSentry({ sentryDsn: undefined })` is still a no-op (regression test).
  - `beforeSend` returns `null` for 4xx; redacts `authorization` in nested `event.extra` (unit test).
  - `initWorker({ serviceName: 'test' })` returns a live Pino logger that writes to an in-memory stream (unit test with fake transport).
- **Out of scope:** Adoption by any worker (those are S5/S6/S7).

### S2 — `packages/internal-clients` + `packages/http-server`: trace propagation + error handler
- **Files:**
  - `packages/common-core/src/tracing/requestContext.ts` (new)
  - `packages/common-core/src/tracing/index.ts`
  - `packages/http-server/src/index.ts` — wire `runWithRequestContext` into request lifecycle.
  - `packages/http-server/src/errorHandler.ts` (new or existing) — implement §8 mapping.
  - `packages/internal-clients/src/shared/**` — inject headers per §4.
- **Scope:**
  - Implement `requestContext` AsyncLocalStorage per §3.
  - Replace ad-hoc request-id extraction in `logIncomingRequest` with a helper that calls `runWithRequestContext`.
  - Every `packages/internal-clients/src/*/client.ts` MUST attach the three headers from §4 to outbound requests.
  - Fastify `setErrorHandler` updates per §8, with unit tests: 400 `IntexuraOSError` → no Sentry; 500 `IntexuraOSError` → Sentry; plain `Error` → generic 500 + Sentry.
- **Acceptance:**
  - `app.inject({ headers: { 'x-request-id': 'abc' }, url: '/...' })` results in the downstream fake HTTP client receiving `x-request-id: abc`.
  - Missing `x-request-id` on inbound gets a generated UUID, propagated outbound.
  - Fastify error handler unit tests cover all four cases (4xx typed, 5xx typed, 4xx plain, 5xx plain).
- **Out of scope:** Pub/Sub attributes (S3), worker adoption (S5–S7).

### S3 — `packages/infra-pubsub`: correlation attributes
- **Files:** `packages/infra-pubsub/src/basePublisher.ts`, `src/messageAttributes.ts` (new), `src/__tests__/*`, `src/index.ts`.
- **Scope:**
  - `publishToTopic` and `publishToOptionalTopic` read `getRequestContext()` (from common-core) and set attributes per §5.
  - New exported helper `extractCorrelation(attributes)` returns a `RequestContext`, generating a fresh UUID if absent.
  - Update `types.ts` to include attribute field in `PublishOptions` for overrides.
- **Acceptance:**
  - Fake PubSub test: publish inside `runWithRequestContext({ requestId: 'r-1', ... })` and assert the message carries `x-request-id: r-1`.
  - `extractCorrelation` returns deterministic context given attributes; generates UUID when missing.
- **Out of scope:** Consumer adoption (lives inside each worker subtask).

### S4 — LLM stack observability
- **Files:**
  - `packages/llm-factory/src/**` — add OTel span wrapping + duration measurement around provider dispatch.
  - `packages/infra-claude/src/*`, `packages/infra-gpt/src/*`, `packages/infra-gemini/src/*`, `packages/infra-perplexity/src/*`, `packages/infra-openrouter/src/*` — ensure each `generate()` returns `{ durationMs, ... }` and the factory forwards it.
  - `packages/llm-utils/src/usageLogger.ts` (or equivalent) — add required `durationMs` field.
- **Scope:**
  - Wrap each provider call in `tracer.startActiveSpan('llm.<provider>.generate', ...)` with attributes from §6.
  - Compute `durationMs = Date.now() - start` around the provider call.
  - `UsageLogger.record` signature gains `durationMs: number`; update every caller in the monorepo.
  - Firestore `llm_usage_events` migration (new `migrations/*.mjs`) to add `durationMs` as an indexed field if any query reads it (verify `firestore-collections.json`); otherwise no index needed.
- **Acceptance:**
  - Unit tests with a fake OTel `InMemorySpanExporter` confirm spans are emitted with correct attributes per provider.
  - Every caller of `UsageLogger.record` compiles (grep: `UsageLogger.record(` must return zero arg-mismatch errors).
  - Snapshot test on one provider asserts `durationMs` ≥ 0.
- **Out of scope:** Cloud Monitoring dashboards — unchanged; metric is still logged via existing pipeline.

### S5 — `workers/orchestrator`: adopt `initWorker()` + emit `code_tasks_*` metrics
- **Files:** `workers/orchestrator/src/start.ts`, `src/index.ts`, `src/services/*.ts`, `src/__tests__/*`, `workers/orchestrator/Dockerfile` (add OTel `--import` preload), `workers/orchestrator/package.json` (add `@intexuraos/common-metrics`).
- **Scope:**
  - Replace current logger bootstrap with `initWorker({ serviceName: 'orchestrator', ... })` from S1.
  - Wrap the main Pub/Sub consumer + webhook handler in `runWithRequestContext(extractCorrelation(msg.attributes), ...)` from S2/S3.
  - Emit `CODE_TASK_METRICS.COMPLETED / FAILED / DURATION` at end of each code-task lifecycle via `MetricsClient` from §7.
  - Convert known `throw new Error(...)` in `src/services/**` to `IntexuraOSError` with appropriate codes (`QUEUE_FULL`, `INVALID_WORKER`, etc.).
- **Acceptance:**
  - Unit tests: bootstrapping records log lines containing `requestId` when invoked under `runWithRequestContext`.
  - Fake metrics client captures `code_tasks_completed{status="ok"}` on happy-path finish.
  - `logIncomingRequest` helper reports 100% on the orchestrator routes per the new verify script (S8).
- **Out of scope:** Adding `code-worker` Node instrumentation (not a Node service — see note below).

### S6 — `workers/vm-lifecycle`: adopt `initWorker()` + kill silent catches + typed errors
- **Files:** `workers/vm-lifecycle/src/{index,logger,start-vm,stop-vm}.ts`, `src/__tests__/*`, `workers/vm-lifecycle/Dockerfile`.
- **Scope:**
  - Replace `createAppLogger` call with `initWorker()`.
  - Rewrite silent catches at `start-vm.ts:129-131`, `stop-vm.ts:57-59`, `stop-vm.ts:104-107` into categorized handling:
    ```ts
    } catch (error) {
      if (isExpectedStartupNetworkError(error)) {
        logger.debug({ err: error }, 'VM not yet responding (expected during startup)');
      } else {
        logger.error({ err: error }, 'Unexpected error during VM health poll');
        Sentry.captureException(error);
      }
    }
    ```
  - `isExpectedStartupNetworkError` narrows by `error.code` ∈ {`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`} or `AbortError`.
  - Convert `throw new Error(...)` in domain helpers to `IntexuraOSError` (`WORKER_UNAVAILABLE`, `WORKER_UNHEALTHY`).
- **Acceptance:**
  - Unit tests using `FakeHttpClient` verify debug-level log on `ECONNREFUSED` and error-level + Sentry on `TypeError`.
  - No `catch {}` or `catch (_)` anywhere in `workers/vm-lifecycle/src/**` (grep).

### S7 — `workers/transcription` + `workers/log-cleanup`: adopt `initWorker()`
- **Files:** `workers/transcription/src/{main,logger,index}.ts`, `workers/log-cleanup/src/{cleanup,logger,index}.ts`, respective `Dockerfile`s, `__tests__/*`.
- **Scope:**
  - Replace existing Pino bootstrap with `initWorker()`.
  - Wrap each outer handler (`polling.ts` in transcription, scheduled Cloud Function entry in log-cleanup) in `runWithRequestContext(extractCorrelation(...), ...)`.
  - No metric emission, no silent-catch work — pure bootstrap uplift.
- **Acceptance:**
  - Each service's unit tests still pass.
  - Log output contains `service`, `requestId`, and `release` in every line (verify via in-memory stream assertion).

### S8 — `packages/common-metrics` (new) + Terraform alerts + `verify-incoming-request-logging.mjs`
- **Files:**
  - `packages/common-metrics/**` (new package — `package.json`, `tsconfig.json`, `src/index.ts`, `src/client.ts`, `src/__tests__/*`).
  - `terraform/environments/prod/variables.tf` — change `alert_email` to required (`type = string`, no default).
  - `terraform/environments/prod/main.tf` — add `google_monitoring_notification_channel` of type `slack`.
  - `terraform/environments/prod/cloud-monitoring-metrics.tf` — add alert policy for `code_tasks_failed` rate > 5% over 15min.
  - `scripts/verify-incoming-request-logging.mjs` (new) — AST scan of Fastify route files; fail if any route handler file lacks `logIncomingRequest(` on the matched path.
  - `package.json` root — register new script under `ci:tracked`.
  - `packages/common-core/src/logging.ts` — standardise `err` key (add deprecation warning if `error` key is used in dev; unit-tested).
  - `packages/infra-sentry/src/logStream.ts` + `packages/common-core/src/logging.ts` — dedupe Pino transport construction (extract `buildPinoTransport()` helper).
- **Scope:**
  - Package passes strict TypeScript + 100% branch coverage per CLAUDE.md.
  - Verify script is invoked by CI; runs in < 5s; output is a list of non-compliant files.
- **Acceptance:**
  - `pnpm run ci:tracked` passes and runs the new script.
  - Terraform plan in dev succeeds (no apply required).
  - Intentional regression test: adding a route without `logIncomingRequest()` fails the new script.
- **Out of scope:** Dashboard panel edits.

### S9 — Typed errors migration: `packages/infra-firestore` + `apps/*/src/domain/**`
- **Files:** `packages/infra-firestore/src/**`, every `apps/*/src/domain/**/*.ts` with `throw new Error(`, no app-level src changes outside domain folder.
- **Scope:**
  - Audit every `throw new Error(` in domain code; replace with `IntexuraOSError` and one of the existing `ErrorCode` values (add new codes ONLY if clearly required; adding a code requires updating `ERROR_HTTP_STATUS` in the same commit).
  - Do NOT touch route files — the error handler (S2) already maps `IntexuraOSError` correctly.
  - Do NOT touch test files that intentionally throw plain `Error` to test generic fallthrough.
- **Acceptance:**
  - `rg "throw new Error\(" apps/*/src/domain packages/infra-firestore/src` returns zero non-test matches.
  - All existing unit tests pass unchanged.
  - New unit tests: one per new error code path, asserting `instanceof IntexuraOSError` and correct `code`/`httpStatus`.

---

## Notes on `workers/code-worker`

`workers/code-worker` is a Docker image (no Node entry point) executed by the orchestrator to run the Claude CLI inside isolated containers. The "observability" for this worker lives inside the **orchestrator** (S5) where container stdout is forwarded via `log-forwarder.ts`. No separate subtask is needed — S5 ensures that forwarded logs carry the orchestrator's `requestId` and flow through the same Sentry/OTel pipeline.

---

## Cross-Subtask Verification (final reconciliation commit on main plan branch)

After S1–S9 land, this plan branch hosts a thin cleanup commit that:
1. Deletes any local "contract shims" left by subtasks that landed before their producer.
2. Adds an end-to-end integration test asserting a request tagged with `x-request-id: e2e-1` surfaces in: Fastify log, outbound HTTP client, Pub/Sub attribute, downstream worker log, Sentry event breadcrumb.
3. Runs `pnpm run ci:tracked` and captures proof.

Not a subtask — the orchestrator of this plan (the parent worker) owns it.

---

## Acceptance Criteria (parent issue)

- [ ] All 5 workers boot via `initWorker()` (S1 + S5–S7).
- [ ] `x-request-id` traverses: HTTP → internal HTTP client → Pub/Sub attribute → consumer logger.
- [ ] Sentry init honours `beforeSend`, `release`, `tracesSampleRate`, PII redaction.
- [ ] No silent `catch {}` or `catch (_)` remaining in `workers/vm-lifecycle/src/**`.
- [ ] `throw new Error(` count outside tests reduced to zero in `apps/*/src/domain/**`, `packages/infra-firestore/src/**`, `packages/llm-factory/src/**`, `packages/http-server/src/**`.
- [ ] Every provider `generate()` call emits an `llm.*.generate` OTel span and records `durationMs`.
- [ ] `@intexuraos/common-metrics` package published (workspace) and consumed by orchestrator.
- [ ] Terraform `alert_email` required in prod; Slack notification channel provisioned.
- [ ] `scripts/verify-incoming-request-logging.mjs` in `ci:tracked`.
- [ ] `pnpm run ci:tracked` passes.

## Test Plan (parent-level, executed after all subtasks merge)

- [ ] Unit tests in each subtask.
- [ ] Integration test at repo root: `pnpm test -- observability-e2e` asserts propagation chain (see Cross-Subtask Verification).
- [ ] Manual: deploy to dev, trigger a code-task, confirm one Sentry event carries `release`, `requestId`, redacted `authorization`.
- [ ] Manual: verify Cloud Monitoring shows non-zero values for `code_tasks_completed`.
