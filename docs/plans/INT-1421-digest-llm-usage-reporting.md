# INT-1421 — Restore LLM usage reporting for regenerated notification digests

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `mobile-notifications-service` digest LLM calls to the `llm-usage-service` so regenerations (and scheduled runs + backfills) appear in the LLM Usage view.

**Architecture:** Replace the hard-coded no-op `usageSink` inside `apps/mobile-notifications-service/src/routes/digestRoutes.ts` with a real `HttpInternalAuthUsageSink` (already used by every other service — chat-agent, user-service, research-agent, image-service, etc.). Add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `REQUIRED_ENV`. Sink identifies the events as `service: 'mobile-notifications-service', component: 'digest'`.

**Tech Stack:** TypeScript (strict), Fastify, `@intexuraos/llm-factory`, `@intexuraos/llm-pricing` (`HttpInternalAuthUsageSink`, `FakeUsageSink`), Vitest, `nock`.

---

## Investigation Summary

### Symptom
User invoked the digest regeneration action from `#/notifications/digests` (`POST /notifications/digests/run`). Digests were regenerated successfully, but the LLM Usage view (`#/llm-usage`) shows zero usage for the corresponding calls.

### Root cause — definitive
File: `apps/mobile-notifications-service/src/routes/digestRoutes.ts`, lines 148-162.

```ts
function buildLlmClient(userId: string): ReturnType<typeof createLlmClient> {
  const model = getDigestModel();
  const apiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';
  const config: LlmClientConfig = {
    apiKey,
    model: model as LlmClientConfig['model'],
    userId,
    logger,
    usageSink: { log: () => Promise.resolve() },  // <-- NO-OP SINK
    ownerType: 'system',
  };
  return createLlmClient(config);
}
```

Every LLM call that the digest pipeline makes (`aggregateDigest` → `callAndParse` → `llmClient.generate(...)`, covering both `whatsapp-digest-aggregate` and up to 3 `whatsapp-digest-repair` prompts per run) is routed through an `LlmClient` whose `usageSink.log(...)` is a Promise-returning no-op. The underlying provider client (e.g. `createOpenRouterGenerateClient`) still fires the sink after every successful call, but the sink discards the event silently. No HTTP traffic ever reaches `llm-usage-service`.

### Evidence
1. **Code**: `usageSink: { log: () => Promise.resolve() }` in `digestRoutes.ts:158` — the only `usageSink` reference in the entire `apps/mobile-notifications-service` tree (`grep -r usageSink apps/mobile-notifications-service` returns exactly one hit, and that hit is the no-op).
2. **Contract**: `packages/llm-factory/src/llmClientFactory.ts:63-64` says "`usageSink` — Required. Pass `NoopUsageSink` to explicitly opt out." — so the field is mandatory; somebody wrote a bespoke inline no-op rather than deliberately opting out via the documented helper.
3. **Prod logs**: `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="intexuraos-llm-usage-service" AND jsonPayload.source.service="mobile-notifications-service"'` returns `[]` — the ingest endpoint has **never** received an event tagged with `source.service = "mobile-notifications-service"`.
4. **Cross-service comparison**: Every other app that uses `createLlmClient`/`createToolCallingClient` wires `new HttpInternalAuthUsageSink({ usageServiceUrl, internalAuthToken, service: '<svc>', component: '<area>', logger })` (see `apps/chat-agent/src/services.ts:102-116`, `apps/research-agent/src/services.ts`, `apps/user-service/src/infra/llm/LlmValidatorImpl.ts`, etc.).
5. **Env var already available**: `INTEXURAOS_LLM_USAGE_SERVICE_URL` is declared in Terraform `common_service_env_vars` (`terraform/environments/dev/main.tf:302`) and in PM2 `COMMON_SERVICE_URLS` (`ecosystem.config.cjs:59`). Both environments already inject it into `mobile-notifications-service`; the service just never reads it.

### Endpoint Changes
- **Modified:** `POST /internal/notifications/digest/run`, `POST /internal/notifications/digest/run-yesterday`, `POST /notifications/digests/run`, `POST /notifications/digests/backfill` (internal `chainPost` fan-out). No request/response schema changes — only observability side-effects (usage events now POSTed to `llm-usage-service`).
- **Created:** None.
- **Removed:** None.
- **Unchanged:** All read endpoints (`GET /notifications/digests`, `GET /notifications/digests/:groupKey/:date`, `GET /notifications/digests/backfill/:runId`, `GET /notifications/digests/:groupKey/:date/state`).

### File Structure
- Modify: `apps/mobile-notifications-service/src/index.ts` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL` to `REQUIRED_ENV`.
- Modify: `apps/mobile-notifications-service/src/routes/digestRoutes.ts` — import `HttpInternalAuthUsageSink`, build a module-level sink reading env, pass it into `buildLlmClient`.
- Modify: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts` — set the new env var in `beforeEach`; add tests that verify a usage event is emitted per successful digest run (via `FakeUsageSink` + `createLlmClient` mock, or `nock` against the usage ingest URL).
- Read for context only: `packages/llm-pricing/src/httpInternalAuthUsageSink.ts`, `packages/llm-factory/src/llmClientFactory.ts`, `apps/chat-agent/src/services.ts`, `apps/mobile-notifications-service/src/domain/usecases/aggregateDigest.ts`.

---

## Task 1: Test-drive the env var requirement

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/config.test.ts`
- Modify: `apps/mobile-notifications-service/src/index.ts:5-16`

- [ ] **Step 1: Locate the existing REQUIRED_ENV coverage.**

Run: `rg -n "REQUIRED_ENV|validateRequiredEnv" apps/mobile-notifications-service`
Expected: test in `config.test.ts` iterating the required env list.

- [ ] **Step 2: Add a failing test row for `INTEXURAOS_LLM_USAGE_SERVICE_URL`.**

Open `apps/mobile-notifications-service/src/__tests__/config.test.ts`. Find the `required env vars` table/array (mirroring `REQUIRED_ENV`). Append `'INTEXURAOS_LLM_USAGE_SERVICE_URL'` to the expected list used by the test.

Example addition (adapt to local style):

```ts
const REQUIRED = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_DIGEST_LLM_MODEL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL', // new
];
```

- [ ] **Step 3: Run the test to confirm it fails.**

Run: `pnpm --filter @intexuraos/mobile-notifications-service test -- src/__tests__/config.test.ts`
Expected: FAIL — REQUIRED_ENV does not contain `INTEXURAOS_LLM_USAGE_SERVICE_URL`.

- [ ] **Step 4: Add the env var to `REQUIRED_ENV`.**

Edit `apps/mobile-notifications-service/src/index.ts`:

```ts
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_DIGEST_LLM_MODEL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
];
```

- [ ] **Step 5: Re-run the test; expect PASS.**

Run: `pnpm --filter @intexuraos/mobile-notifications-service test -- src/__tests__/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/mobile-notifications-service/src/index.ts \
        apps/mobile-notifications-service/src/__tests__/config.test.ts
git commit -m "feat(mobile-notifications-service): require INTEXURAOS_LLM_USAGE_SERVICE_URL at boot"
```

---

## Task 2: TDD — assert usage sink is wired for `POST /notifications/digests/run`

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`

- [ ] **Step 1: Import `FakeUsageSink` and set the new env var in `beforeEach`.**

Open `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`. Add at the top:

```ts
import { FakeUsageSink } from '@intexuraos/llm-pricing';
```

In `beforeEach`, add:

```ts
process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] = 'http://usage.test.local';
```

- [ ] **Step 2: Add a failing test for usage-event emission on `POST /notifications/digests/run`.**

Append to the suite. The test replaces the `createLlmClient` mock with one that captures the received `usageSink` and manually fires `usageSink.log(...)` to simulate a successful generation.

```ts
describe('POST /notifications/digests/run — LLM usage reporting', () => {
  it('forwards usage events to the injected usageSink', async () => {
    const sink = new FakeUsageSink();

    vi.doMock('@intexuraos/llm-factory', async (): Promise<typeof import('@intexuraos/llm-factory')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-factory')>('@intexuraos/llm-factory');
      return {
        ...actual,
        createLlmClient: (config) => ({
          generate: async (_prompt: string, options: { promptType: string }) => {
            await config.usageSink.log({
              provider: 'openrouter',
              model: 'or:google/gemini-3-flash-preview',
              userId: config.userId,
              callType: 'generate',
              promptType: options.promptType,
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.00001 },
              ownerType: config.ownerType ?? 'system',
            });
            return {
              ok: true as const,
              value: {
                content: JSON.stringify(COLD_START_EXAMPLE),
                usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.00001 },
              },
            };
          },
        }),
      } as typeof import('@intexuraos/llm-factory');
    });

    // Bind the fake sink to the module under test by replacing the real
    // HttpInternalAuthUsageSink with one that delegates to `sink`.
    vi.doMock('@intexuraos/llm-pricing', async (): Promise<typeof import('@intexuraos/llm-pricing')> => {
      const actual = await vi.importActual<typeof import('@intexuraos/llm-pricing')>('@intexuraos/llm-pricing');
      return {
        ...actual,
        HttpInternalAuthUsageSink: class {
          log(p: Parameters<typeof sink.log>[0]): Promise<void> { return sink.log(p); }
        },
      } as typeof import('@intexuraos/llm-pricing');
    });

    // ... existing setMockServices({...}) block, identical to the happy-path test above ...

    const { buildServer: freshBuild } = await import('../../server.js');
    const app = await freshBuild();
    const token = createToken({ sub: 'u' });
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/digests/run',
      headers: { authorization: `Bearer ${token}` },
      payload: { groupKey: 'g', date: '2026-04-15' },
    });

    expect(res.statusCode).toBe(200);
    expect(sink.records.length).toBeGreaterThanOrEqual(1);
    expect(sink.records[0]?.promptType).toBe('whatsapp-digest-aggregate');
    await app.close();
  });
});
```

- [ ] **Step 3: Run the test; expect FAIL.**

Run: `pnpm --filter @intexuraos/mobile-notifications-service test -- src/__tests__/routes/digestRoutes.test.ts`
Expected: FAIL — `sink.records` is empty because the production code currently creates a no-op sink inline and never touches `HttpInternalAuthUsageSink`.

---

## Task 3: Implement the real `HttpInternalAuthUsageSink` in `digestRoutes.ts`

**Files:**
- Modify: `apps/mobile-notifications-service/src/routes/digestRoutes.ts`

- [ ] **Step 1: Import `HttpInternalAuthUsageSink`.**

Add to the import block at the top of `digestRoutes.ts`:

```ts
import { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
```

- [ ] **Step 2: Add a module-level lazy accessor `getUsageSink()`.**

Insert near `getDigestModel()`:

```ts
let usageSinkSingleton: HttpInternalAuthUsageSink | null = null;
function getUsageSink(): HttpInternalAuthUsageSink {
  if (usageSinkSingleton !== null) return usageSinkSingleton;
  const url = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'];
  const token = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  /* v8 ignore start -- module-init: REQUIRED_ENV guarantees both vars at boot; the branch is unreachable in any booted test @preserve */
  if (url === undefined || url === '') throw new Error('INTEXURAOS_LLM_USAGE_SERVICE_URL not set');
  if (token === undefined || token === '') throw new Error('INTEXURAOS_INTERNAL_AUTH_TOKEN not set');
  /* v8 ignore stop @preserve */
  usageSinkSingleton = new HttpInternalAuthUsageSink({
    usageServiceUrl: url,
    internalAuthToken: token,
    service: 'mobile-notifications-service',
    component: 'digest',
    logger,
  });
  return usageSinkSingleton;
}
```

- [ ] **Step 3: Replace the no-op sink in `buildLlmClient`.**

Change the `usageSink: { log: () => Promise.resolve() }` line to:

```ts
usageSink: getUsageSink(),
```

Full function after the change:

```ts
function buildLlmClient(userId: string): ReturnType<typeof createLlmClient> {
  const model = getDigestModel();
  /* v8 ignore start -- ts-type: nullish coalescing fallback — REQUIRED_ENV guarantees INTEXURAOS_OPENROUTER_APP_API_KEY is always defined; the '' branch is unreachable @preserve */
  const apiKey = process.env['INTEXURAOS_OPENROUTER_APP_API_KEY'] ?? '';
  /* v8 ignore stop @preserve */
  const config: LlmClientConfig = {
    apiKey,
    model: model as LlmClientConfig['model'],
    userId,
    logger,
    usageSink: getUsageSink(),
    ownerType: 'system',
  };
  return createLlmClient(config);
}
```

- [ ] **Step 4: Add a test-only reset hook so singleton doesn't leak across tests.**

Append to `digestRoutes.ts` (exported for test use only):

```ts
export function __resetUsageSinkForTests(): void {
  usageSinkSingleton = null;
}
```

Call it from `afterEach` in the test file:

```ts
import { __resetUsageSinkForTests } from '../../routes/digestRoutes.js';
afterEach(() => { __resetUsageSinkForTests(); });
```

- [ ] **Step 5: Re-run the Task 2 test; expect PASS.**

Run: `pnpm --filter @intexuraos/mobile-notifications-service test -- src/__tests__/routes/digestRoutes.test.ts`
Expected: PASS — `sink.records` now receives the usage event.

- [ ] **Step 6: Commit.**

```bash
git add apps/mobile-notifications-service/src/routes/digestRoutes.ts \
        apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
git commit -m "fix(mobile-notifications-service): report digest LLM usage to llm-usage-service

Replace the no-op usageSink in digestRoutes with HttpInternalAuthUsageSink
tagged as service=mobile-notifications-service, component=digest. All digest
LLM calls (aggregate + up to 3 repair attempts) for both scheduled runs,
user-triggered regenerations, and backfills now emit usage events that the
LLM Usage view can display.

Fixes INT-1421"
```

---

## Task 4: Extend coverage to the other three entry points

**Files:**
- Modify: `apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts`

- [ ] **Step 1: Add parallel usage-sink assertions for:**
  - `POST /internal/notifications/digest/run`
  - `POST /internal/notifications/digest/run-yesterday`
  - `POST /notifications/digests/backfill` (verifies the first chained `chainPost` run emits an event — test by mocking the chain fetch and asserting `sink.records.length >= 1` after the kick-off completes).

Each test follows the Task 2 pattern: inject the `FakeUsageSink` via mocked `HttpInternalAuthUsageSink`, drive the endpoint, assert at least one record with `promptType === 'whatsapp-digest-aggregate'`.

- [ ] **Step 2: Run the suite; expect all tests green.**

Run: `pnpm --filter @intexuraos/mobile-notifications-service test`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile-notifications-service/src/__tests__/routes/digestRoutes.test.ts
git commit -m "test(mobile-notifications-service): assert usage reporting for all digest entry points"
```

---

## Task 5: Run the full tracked CI and fix any fallout

- [ ] **Step 1: Run tracked CI from repo root.**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-int-1421.txt`
Expected: PASS. If FAIL, `rg "error|FAIL" -C3 /tmp/ci-int-1421.txt` and fix (typically: coverage dip on the new branch, missing `v8 ignore` rationale — every ignore must use the `-- reason @preserve` form enumerated in CLAUDE.md).

- [ ] **Step 2: If CI dirty, iterate until clean, then amend the last relevant commit with `--no-verify=false` semantics (create a new commit — do not amend).**

---

## Task 6: Manual verification in dev after deploy

- [ ] **Step 1: Regenerate a digest via the UI (`#/notifications/digests` → Regenerate).**
- [ ] **Step 2: Query `llm-usage-service` logs:**

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="intexuraos-llm-usage-service" AND jsonPayload.source.service="mobile-notifications-service"' --project=intexuraos-dev-pbuchman --limit=5 --format=json
```

Expected: at least one event per regeneration with `promptType: 'whatsapp-digest-aggregate'` and the invoker's `userId`.

- [ ] **Step 3: Load `#/llm-usage` in the web app and confirm the row appears in the daily aggregate.**

---

## Why this is not complex
- Single service boundary — no cross-service contract changes.
- No Firestore schema or migration impact — `llm-usage-service` already accepts events from arbitrary `source.service` values.
- No new env vars in Terraform/PM2 — the plumbing already exists; the service simply wasn't reading from it.
- Test infrastructure (`FakeUsageSink`, `HttpInternalAuthUsageSink`) is well-established across the codebase.

## Risk
- **Low**: `HttpInternalAuthUsageSink.log` is explicitly non-fatal (see `httpInternalAuthUsageSink.ts:61-72` — network failures log a warning and swallow). A regression in `llm-usage-service` ingest cannot break digest generation.
