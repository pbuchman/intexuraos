# INT-1339 — Track 4: Move LLM Pricing Ownership into llm-usage-service

## Status
- Linear issue: INT-1339
- Parent epic: INT-1338
- Dependencies: none (independent — start immediately)
- Blocks: INT-1341 (Track 2, orchestrator cost calc), INT-1343 (Track 5, consumer rollout)
- Plan version: 1.0 (2026-04-10)

## Executive summary

Today, `app-settings-service` owns the `settings/llm_pricing/providers/{provider}` Firestore sub-collection and exposes `GET /internal/settings/pricing`. Every cost-emitting app (`chat-agent`, `actions-agent`, `web-agent`, `linear-agent`, `commands-agent`, `user-service`, `research-agent`, `image-service`, `todos-agent`, `data-insights-agent`, `calendar-agent`) pulls that payload at boot via `fetchAllPricing()` from `@intexuraos/llm-pricing` and hydrates a `PricingContext`. Track 2 (orchestrator cost calc, INT-1341) wants the same lookup from a worker that has no reason to talk to `app-settings-service` and no business holding an in-memory pricing table. Track 5 (INT-1343) wants to eventually let clients post token-only usage events and have the service fill in `cost.billedUsd` server-side. Both require pricing to live next to usage data.

This track transplants pricing ownership from `app-settings-service` into `llm-usage-service` as a new `llm_pricing` Firestore collection, adds a new `GET /internal/pricing` route that returns the existing `AllPricingResponse` shape (so clients can be flipped with a single URL env-var swap), adds server-side cost calculation inside `ingestUsageEvents` (opt-in via a `computeCost: true` flag on the route body, so existing strict-schema callers keep working), extends `@intexuraos/internal-clients/usage-service` with a `fetchAllPricing()` method that returns the same `Result<AllPricingResponse, UsageServiceError>` shape, redirects `fetchAllPricing()` in `@intexuraos/llm-pricing` to use the new URL env var, performs a one-time Firestore migration copying `settings/llm_pricing/providers/*` into `llm_pricing/{provider}`, then rolls consumers over one app at a time.

The end state: `llm-usage-service` owns pricing reads and writes, orchestrator can POST token-only events and get `cost.billedUsd` back, every consumer boots against `INTEXURAOS_LLM_USAGE_SERVICE_URL` for pricing, and the old `app-settings-service` endpoint is behind a 307 redirect for a week before deletion.

## Pre-flight checks (do these before writing any code)

1. From repo root, establish a green baseline: `pnpm run ci:tracked | tee /tmp/int-1339-baseline.txt`. Do not proceed if anything fails.
2. Re-verify every context file listed below still exists at the cited line number (files drift between planning and execution). If a line number has shifted by more than a few lines, update the plan before editing.
3. Run `pnpm build` from repo root so `packages/llm-pricing/dist/` and `packages/internal-clients/dist/` exist. Without this, the new imports in llm-usage-service will error with `Cannot find module`.
4. Grep the whole repo for stragglers this plan may have missed: `rg "settings/llm_pricing|settings\.llm_pricing|/internal/settings/pricing"` — anything that matches must either be updated in Phase 6 or explicitly listed in "Unchanged".
5. Grep: `rg "fetchAllPricing\("` — verify the list of 11 consumer apps in Phase 6 is still accurate. If new consumers have appeared, add them.
6. Read `apps/llm-usage-service/src/domain/models/usageEvent.ts:58-63` to confirm the `cost` block shape has not changed. Server-side cost calc must emit exactly this shape.
7. Read `packages/llm-contract/src/pricing.ts:36-67` (`ModelPricing`) and `packages/llm-contract/src/pricing.ts:75-82` (`ProviderPricing`). These are the types the new repository must return unchanged.
8. Confirm `firestore-collections.json:252-259` still lists `llm_usage_events` and `llm_usage_daily_aggregates` as owned by `llm-usage-service`. The new `llm_pricing` collection will be added to the same owner.

## Context files

- `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts:13-80` — existing ingest use case. Server-side cost calc hooks in at line 37 (right after the schema-validated input is cloned into `fullEvent`) and needs read access to a new `pricingRepository` dep.
- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts:25-195` — route file. Two new handlers will be added here: `GET /internal/pricing` and (optionally) `GET /internal/pricing/:provider`. The existing ingest handler at line 73 also needs to pass `pricingRepository` into the use case.
- `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts:120-133` — the strict `cost` block. Currently `required: ['billedUsd', 'providerReportedUsd', 'calculatedUsd', 'pricingSource']`. Phase 3 widens the schema: either (a) add a top-level `computeCost: true` flag on `IngestBody` so omitting `cost` is legal only when `computeCost === true`, or (b) make `cost` optional across the board. See the Phase 3 decision point.
- `apps/llm-usage-service/src/services.ts:6-10` — `ServiceContainer` interface, needs a new `pricingRepository` field. Tests will fail fast because `setServices({...})` calls currently don't provide it.
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts:1-27` — reference pattern for the new `FirestorePricingRepository`. Same style: constant `COLLECTION`, `getFirestore()` inside each method, narrow `try/catch` around Firestore errors, `Result` return type.
- `packages/llm-pricing/src/pricingClient.ts:125-169` — the current `fetchAllPricing()`. The URL `${baseUrl}/internal/settings/pricing` at line 129 is the only line that changes; its callers already pass a `baseUrl`. The intent in Phase 6 is for each consumer to pass the `llm-usage-service` URL instead of `app-settings-service`. The endpoint path becomes `/internal/pricing` (not `/internal/settings/pricing`). See Phase 5.
- `packages/llm-pricing/src/pricingClient.ts:217-285` — `PricingContext` class. Unchanged by this track.
- `packages/llm-pricing/src/index.ts:17-24` — existing exports. A new `fetchAllPricingFromUsageService()` may be added temporarily during the rollout (Phase 6), or the existing `fetchAllPricing()` may be updated in place. See the Phase 5 decision point.
- `apps/app-settings-service/src/routes/internalRoutes.ts:12-113` — the old pricing route, to be deprecated in Phase 7 (returns 307 redirect for 1 week, then removed).
- `apps/app-settings-service/src/infra/firestore/index.ts:20-41` — `FirestorePricingRepository` in the old service. Read-only; provides the migration source shape `settings/llm_pricing/providers/{provider}`. This file is deleted in Phase 7.
- `apps/app-settings-service/src/services.ts:5-27` — DI container. The `pricingRepository` field here is deleted in Phase 7 along with the route.
- `packages/internal-clients/src/usage-service/client.ts:19-61` — current usage-service client with `ingestEvents` and `queryUsage`. Phase 4 adds a third method `fetchPricing()` returning `Result<AllPricingResponse, UsageServiceError>`.
- `packages/internal-clients/src/usage-service/types.ts:171-181` — `UsageServiceClient` interface. Extended in Phase 4.
- `apps/llm-usage-service/src/index.ts:7-11` — `REQUIRED_ENV`. Unchanged: the service reads its own Firestore, no new env vars for llm-usage-service itself.
- `terraform/environments/dev/main.tf:302,310,1311` — existing `INTEXURAOS_APP_SETTINGS_SERVICE_URL` and `INTEXURAOS_LLM_USAGE_SERVICE_URL` definitions. No new env vars needed in Phase 6 — consumers swap which of the two existing URLs they pass to `fetchAllPricing()`.
- `ecosystem.config.cjs:47,57` — PM2 dev-env definitions of the same two URLs. Same: no new vars; only the value each consumer app hands to `fetchAllPricing()` changes.
- `firestore-collections.json:252-259` — ownership registry. Add a new `llm_pricing` entry owned by `llm-usage-service`.
- `migrations/002_initial-llm-pricing.mjs`, `migrations/012_new-pricing-structure.mjs` — reference for how pricing migrations have historically been structured. The new one follows the same pattern but reads from `settings/llm_pricing/providers/*` and writes to `llm_pricing/{provider}`.
- `scripts/migrate.mjs:29` — migrations directory is the top-level `migrations/` (NOT per-app). The new file goes there as `migrations/086_migrate_pricing_to_llm_usage_service.mjs`.
- `docs/superpowers/plans/2026-04-09-llm-usage-service-implementation-plan.md` — Phase 1 plan for format reference.
- `.claude/reference/env-vars-patterns.md` — the 3-location env-var rule (not relevant here because we reuse existing vars, but linked for reviewers).

## Endpoint changes

### Modified
- `POST /internal/usage/events` on `llm-usage-service` — body schema widens so `cost` becomes optional when a new top-level `computeCost: true` flag is set. When `cost` is omitted and `computeCost === true`, the service calculates it from tokens + pricing and fills the `cost` block before persisting. Existing strict-schema callers that supply `cost` continue to work unchanged.

### Created
- `GET /internal/pricing` on `llm-usage-service` — returns the `AllPricingResponse` shape (`{ google, openai, anthropic, perplexity }`), wrapped in `{ success, data }`. Requires `X-Internal-Auth`. This replaces `GET /internal/settings/pricing` on `app-settings-service`.
- `GET /internal/pricing/:provider` on `llm-usage-service` — returns a single `ProviderPricing`. Used by Track 2 workers that only need one provider's table. Requires `X-Internal-Auth`. **⚠ DECISION NEEDED:** do we actually need the per-provider endpoint in v1, or is the bulk endpoint enough? Track 2's orchestrator cost calc can just fetch-all-and-cache; the per-provider endpoint adds a second code path for little benefit. Recommend deferring unless Track 2 explicitly asks for it.

### Removed
None in this track. `GET /internal/settings/pricing` on `app-settings-service` is DEPRECATED in Phase 7 (returns 307 → usage service) but physical removal is out of scope (happens after 2 weeks of stability, tracked separately).

### Unchanged
- `POST /internal/usage/events` — behavior unchanged for callers who keep supplying a complete `cost` block.
- `POST /internal/webhooks/usage-events` — orchestrator webhook. NOT touched in this track; Track 2 (INT-1341) wires it up to use `computeCost: true` once this track lands.
- `POST /internal/usage/query` — unaffected.
- `GET /internal/settings/pricing` — physically still there and still serving the same data during Phases 1-6. Only deprecated (307) in Phase 7.

## Step-by-step implementation

### Phase 1 — Domain model and repository (server-side)

#### Step 1.1: Failing test for the `PricingRepository` port

Create the test file **before** the interface, using the repo's "test first" rule.

- Test file: `apps/llm-usage-service/src/__tests__/fakePricingRepository.ts`
- Test file: `apps/llm-usage-service/src/__tests__/infra/firestore/firestorePricingRepository.test.ts`

The fake:

```ts
// apps/llm-usage-service/src/__tests__/fakePricingRepository.ts
import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../domain/repositories/pricingRepository.js';

export class FakePricingRepository implements PricingRepository {
  readonly byProvider: Map<LlmProvider, ProviderPricing> = new Map();

  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    return this.byProvider.get(provider) ?? null;
  }

  async getAll(): Promise<Record<LlmProvider, ProviderPricing>> {
    const result: Partial<Record<LlmProvider, ProviderPricing>> = {};
    for (const [p, pricing] of this.byProvider) {
      result[p] = pricing;
    }
    return result as Record<LlmProvider, ProviderPricing>;
  }
}
```

The Firestore test asserts three things: (a) `getByProvider` returns `null` for a missing doc, (b) `getByProvider` returns a typed `ProviderPricing` for a present doc, (c) `getAll` reads all four providers in parallel and returns a fully-populated `Record<LlmProvider, ProviderPricing>`. Use the repo's Firestore emulator pattern from `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts` as the template.

Expected failure: tests import `../domain/repositories/pricingRepository.js` and `./firestorePricingRepository.js`, neither of which exists yet. Vitest reports `Cannot find module`.

#### Step 1.2: Implement the `PricingRepository` interface

- File: `apps/llm-usage-service/src/domain/repositories/pricingRepository.ts`

```ts
import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';

export interface PricingRepository {
  /** Fetch a single provider's pricing. Returns null if no document exists. */
  getByProvider(provider: LlmProvider): Promise<ProviderPricing | null>;

  /**
   * Fetch all four provider pricing docs in parallel.
   * Throws if any required provider is missing - this is a service-level
   * invariant (pricing must be complete or the service is broken).
   */
  getAll(): Promise<Record<LlmProvider, ProviderPricing>>;
}
```

Note: `getAll` throws on missing-provider rather than returning `Result<...>`. Rationale: if pricing is incomplete the service is fundamentally broken and should fast-fail rather than leak a partial response. The route handler converts the thrown error into a 500.

#### Step 1.3: Implement `FirestorePricingRepository`

- File: `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts`

```ts
import { getFirestore } from '@intexuraos/infra-firestore';
import { LlmProviders, type LlmProvider, type ProviderPricing } from '@intexuraos/llm-contract';
import type { PricingRepository } from '../../domain/repositories/pricingRepository.js';

const COLLECTION = 'llm_pricing';

interface ProviderPricingDoc {
  provider: LlmProvider;
  models: ProviderPricing['models'];
  updatedAt: string;
}

export class FirestorePricingRepository implements PricingRepository {
  async getByProvider(provider: LlmProvider): Promise<ProviderPricing | null> {
    const db = getFirestore();
    const snap = await db.collection(COLLECTION).doc(provider).get();
    if (!snap.exists) return null;
    const data = snap.data() as ProviderPricingDoc;
    return { provider: data.provider, models: data.models, updatedAt: data.updatedAt };
  }

  async getAll(): Promise<Record<LlmProvider, ProviderPricing>> {
    const providers = [
      LlmProviders.Google,
      LlmProviders.OpenAI,
      LlmProviders.Anthropic,
      LlmProviders.Perplexity,
    ] as const;
    const results = await Promise.all(providers.map((p) => this.getByProvider(p)));
    const out: Partial<Record<LlmProvider, ProviderPricing>> = {};
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const pricing = results[i];
      if (provider === undefined || pricing === null || pricing === undefined) {
        throw new Error(`Missing pricing for provider: ${String(provider)}`);
      }
      out[provider] = pricing;
    }
    return out as Record<LlmProvider, ProviderPricing>;
  }
}
```

Note the collection path: `llm_pricing/{provider}` — **flat, not nested**. The old `app-settings-service` uses `settings/llm_pricing/providers/{provider}` (4 segments) because it shared the `settings` parent doc with other subtrees. The usage service doesn't need that nesting, so we use the simpler flat shape. The migration in Phase 5 does the copy.

#### Step 1.4: Wire the repo into `services.ts`

- File: `apps/llm-usage-service/src/services.ts:6-40`

```ts
import type { PricingRepository } from './domain/repositories/pricingRepository.js';
import { FirestorePricingRepository } from './infra/firestore/firestorePricingRepository.js';

export interface ServiceContainer {
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  pricingRepository: PricingRepository;          // NEW
  orchestratorSecret: string;
}

// inside initializeServices():
container = {
  usageEventRepository: new FirestoreUsageEventRepository(),
  usageAggregateRepository: new FirestoreUsageAggregateRepository(),
  pricingRepository: new FirestorePricingRepository(),  // NEW
  orchestratorSecret,
};
```

Pre-flight: before editing, `rg "setServices\(" apps/llm-usage-service/src` to enumerate every test that builds a fake container. Each one currently lacks `pricingRepository` — they MUST all be updated to pass a `FakePricingRepository()` or the test file won't compile. Expected locations:

- `apps/llm-usage-service/src/__tests__/domain/usecases/ingestUsageEvents.test.ts`
- `apps/llm-usage-service/src/__tests__/routes/internalUsageRoutes.test.ts`
- `apps/llm-usage-service/src/__tests__/routes/webhookUsageRoutes.test.ts`
- Any `helpers.ts` in `__tests__/`.

#### Step 1.5: Register the collection in `firestore-collections.json`

- File: `firestore-collections.json:259` (append inside the `collections` object)

```json
"llm_pricing": {
  "owner": "llm-usage-service",
  "description": "LLM pricing per provider (one doc per provider, keyed by provider ID). Read by ingestUsageEvents for server-side cost calc and exposed via GET /internal/pricing."
}
```

This enforces the one-owner rule. No other service may read or write `llm_pricing` directly — cross-service reads go through the new HTTP endpoint.

### Phase 2 — HTTP routes

#### Step 2.1: Failing test for `GET /internal/pricing`

- File: `apps/llm-usage-service/src/__tests__/routes/internalPricingRoutes.test.ts` (new)

Test cases:
1. Missing `X-Internal-Auth` → 401 with `error.code === 'UNAUTHORIZED'`.
2. Valid auth + fake repo populated with all 4 providers → 200 with body `{ success: true, data: { google, openai, anthropic, perplexity } }`, each matching `AllPricingResponse` shape.
3. Valid auth + fake repo missing `anthropic` → 500 with `error.code === 'INTERNAL_ERROR'` and the message mentions the missing provider.
4. Fastify route schema validation: response body is checked against the schema (`additionalProperties: false`) so any accidental leak of extra fields fails the test.

The test uses `app.inject()` per the project testing rules. Use `setServices({ ...defaults, pricingRepository: fake })` in `beforeEach`, `resetServices()` in `afterEach`.

Expected failure: the route does not exist yet, Fastify returns 404.

#### Step 2.2: Implement the route

- File: `apps/llm-usage-service/src/routes/internalPricingRoutes.ts` (new)

```ts
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const internalPricingRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get(
    '/internal/pricing',
    {
      schema: {
        operationId: 'internalGetAllPricing',
        summary: 'Get all LLM pricing (internal)',
        description: 'Returns pricing for google, openai, anthropic, and perplexity.',
        tags: ['pricing'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                required: ['google', 'openai', 'anthropic', 'perplexity'],
                properties: {
                  google: { $ref: 'ProviderPricing#' },
                  openai: { $ref: 'ProviderPricing#' },
                  anthropic: { $ref: 'ProviderPricing#' },
                  perplexity: { $ref: 'ProviderPricing#' },
                },
              },
            },
            required: ['success', 'data'],
          },
          401: { /* same shape as other routes in internalUsageRoutes.ts */ },
          500: { /* same */ },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal pricing read' });
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }
      const { pricingRepository } = getServices();
      try {
        const all = await pricingRepository.getAll();
        return await reply.ok(all);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to read pricing');
        return await reply.fail('INTERNAL_ERROR', 'Failed to read pricing');
      }
    },
  );

  done();
};
```

#### Step 2.3: Register the `ProviderPricing` schema with the app Ajv instance

The route uses `$ref: 'ProviderPricing#'`, which must be registered before the route is registered.

- File: `apps/llm-usage-service/src/routes/schemas/pricingSchema.ts` (new)

```ts
import type { FastifyInstance } from 'fastify';

export const providerPricingSchema = {
  $id: 'ProviderPricing',
  type: 'object',
  required: ['provider', 'models', 'updatedAt'],
  properties: {
    provider: { type: 'string', enum: ['google', 'openai', 'anthropic', 'perplexity'] },
    models: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['inputPricePerMillion', 'outputPricePerMillion'],
        properties: {
          inputPricePerMillion: { type: 'number', minimum: 0 },
          outputPricePerMillion: { type: 'number', minimum: 0 },
          cacheReadMultiplier: { type: 'number', minimum: 0 },
          cacheWriteMultiplier: { type: 'number', minimum: 0 },
          webSearchCostPerCall: { type: 'number', minimum: 0 },
          groundingCostPerRequest: { type: 'number', minimum: 0 },
          imagePricing: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
          useProviderCost: { type: 'boolean' },
        },
      },
    },
    updatedAt: { type: 'string' },
  },
} as const;

export function registerPricingSchemas(app: FastifyInstance): void {
  app.addSchema(providerPricingSchema);
}
```

- Edit `apps/llm-usage-service/src/server.ts:170-171` to call `registerPricingSchemas(app)` right after `registerUsageSchemas(app)`.

#### Step 2.4: Register the route plugin

- Edit `apps/llm-usage-service/src/routes/index.ts:1-9` to add:

```ts
import { internalPricingRoutes } from './internalPricingRoutes.js';
// ...
await app.register(internalPricingRoutes);
```

### Phase 3 — Server-side cost calculation

#### Step 3.1: Decide on the compute flag

**⚠ DECISION NEEDED:** two options for how callers opt into server-side cost calc:

- **Option A — `computeCost` flag on request body.** `IngestBody` gains `computeCost?: boolean`. When true, each event's `cost` block may be omitted (schema becomes `required: ['...', 'usage', 'correlation', 'error']` with `cost` moved out) and the use case fills it in. Existing strict callers keep sending `cost` and are unaffected.
- **Option B — Always make `cost` optional.** Schema drops `cost` from `required`, use case fills in a zero-cost placeholder if absent. Simpler but silently hides bugs (caller forgot to send cost → we write $0).

Recommend Option A. Option B violates the repo's strict-schema philosophy (see `usageEventSchema.ts:19-20` `additionalProperties: false`).

The rest of this phase assumes Option A.

#### Step 3.2: Failing test for the cost calculator

- File: `apps/llm-usage-service/src/__tests__/domain/usecases/calculateEventCost.test.ts` (new)

Test cases for a new pure function `calculateEventCost(event, pricing): { billedUsd, calculatedUsd, pricingSource }`:

1. Claude with cached reads: `inputTokens=1000, cacheReadTokens=500, outputTokens=200, cacheWriteTokens=0`, pricing from `migrations/012_new-pricing-structure.mjs` (`claude-sonnet-4-5`: `$3/M in`, `$15/M out`, `cacheReadMultiplier=0.1`, `cacheWriteMultiplier=1.25`). Expected billed = `(1000/1e6 * 3) + (500/1e6 * 3 * 0.1) + (200/1e6 * 15)` = `0.003 + 0.00015 + 0.003` = `$0.00615`.
2. OpenAI `gpt-5.2` simple text: `inputTokens=1000, outputTokens=500`, no cache fields → `(1000/1e6 * 1.75) + (500/1e6 * 14)` = `0.00175 + 0.007` = `$0.00875`.
3. Perplexity with `useProviderCost=true` and `providerReportedUsd=0.042`: the function returns `{ billedUsd: 0.042, calculatedUsd: null, pricingSource: 'provider_reported' }` (bypasses math).
4. Model not in pricing table: throws `PricingNotFoundError` with the provider/model in the message.
5. Image generation: `model=gemini-2.5-flash-image, imageCount=2, imagePricing['1024x1024']=0.03` → `$0.06` and pricingSource `calculated`.
6. Web search: `model=claude-opus-4-5-20251101, webSearchCalls=3, webSearchCostPerCall=0.03`, plus token cost → billed = token cost + `0.09`.
7. Grounding enabled for Gemini: `groundingEnabled=true, groundingCostPerRequest=0.035` → billed += `0.035` once (flat per-request).

Expected failure: `calculateEventCost` doesn't exist yet.

#### Step 3.3: Implement `calculateEventCost`

- File: `apps/llm-usage-service/src/domain/usecases/calculateEventCost.ts` (new)

```ts
import type { LLMModel, ModelPricing, ProviderPricing } from '@intexuraos/llm-contract';
import type { UsageEventInput } from '../models/usageEvent.js';

export class PricingNotFoundError extends Error {
  constructor(readonly provider: string, readonly model: string) {
    super(`Pricing not found for ${provider}/${model}`);
    this.name = 'PricingNotFoundError';
  }
}

export interface CalculatedCost {
  billedUsd: number;
  calculatedUsd: number | null;
  pricingSource: 'calculated' | 'provider_reported';
}

export function calculateEventCost(
  event: Pick<UsageEventInput, 'request' | 'usage' | 'cost'>,
  pricing: Record<string, ProviderPricing>,
): CalculatedCost {
  const providerPricing = pricing[event.request.provider];
  if (providerPricing === undefined) {
    throw new PricingNotFoundError(event.request.provider, event.request.model);
  }
  const model: ModelPricing | undefined = providerPricing.models[event.request.model];
  if (model === undefined) {
    throw new PricingNotFoundError(event.request.provider, event.request.model);
  }

  // Provider-reported bypass (Perplexity)
  if (model.useProviderCost === true && event.cost?.providerReportedUsd != null) {
    return {
      billedUsd: event.cost.providerReportedUsd,
      calculatedUsd: null,
      pricingSource: 'provider_reported',
    };
  }

  const u = event.usage;
  let cost = 0;
  cost += (u.inputTokens / 1_000_000) * model.inputPricePerMillion;
  cost += (u.outputTokens / 1_000_000) * model.outputPricePerMillion;
  if (model.cacheReadMultiplier !== undefined) {
    cost += (u.cacheReadTokens / 1_000_000) * model.inputPricePerMillion * model.cacheReadMultiplier;
  }
  if (model.cacheWriteMultiplier !== undefined) {
    cost += (u.cacheWriteTokens / 1_000_000) * model.inputPricePerMillion * model.cacheWriteMultiplier;
  }
  if (model.webSearchCostPerCall !== undefined && u.webSearchCalls > 0) {
    cost += u.webSearchCalls * model.webSearchCostPerCall;
  }
  if (model.groundingCostPerRequest !== undefined && u.groundingEnabled) {
    cost += model.groundingCostPerRequest;
  }
  if (model.imagePricing !== undefined && u.imageCount > 0) {
    // Default to 1024x1024 for v1; per-size pricing is a follow-up.
    // ⚠ DECISION NEEDED: do we need a `size` hint on UsageEventUsage, or is 1024x1024 good enough?
    const perImage = model.imagePricing['1024x1024'] ?? 0;
    cost += u.imageCount * perImage;
  }

  return { billedUsd: cost, calculatedUsd: cost, pricingSource: 'calculated' };
}
```

The `imagePricing` default-to-1024 is an explicit simplification — note the DECISION NEEDED marker. Current consumers only generate at 1024x1024, so this is a safe default; if/when other sizes are used, add a `request.imageSize` field to the event schema.

#### Step 3.4: Failing test for ingest with `computeCost: true`

- File: `apps/llm-usage-service/src/__tests__/domain/usecases/ingestUsageEvents.test.ts` (extend)

Add a test: when called with `computeCost: true` and an event whose `cost` block is absent, the use case calls `pricingRepository.getAll()` once per batch (cached for the whole batch, not per event), fills in `cost` via `calculateEventCost`, then delegates to `usageEventRepository.createEvent` with the filled event. Assert the persisted event has `cost.pricingSource === 'calculated'` and `cost.billedUsd > 0`.

Also test: `computeCost: true` + model missing from pricing table → event is rejected (not stored), returned in the `rejected` array with `code: 'PRICING_NOT_FOUND'`, but other events in the same batch still process successfully.

Also test: when called with `computeCost: false` (or omitted), the existing code path runs unchanged — no call to `pricingRepository.getAll()`.

#### Step 3.5: Update `ingestUsageEvents` signature and body

- File: `apps/llm-usage-service/src/domain/usecases/ingestUsageEvents.ts:7-80`

```ts
export interface IngestUsageEventsDeps {
  logger: Logger;
  usageEventRepository: UsageEventRepository;
  usageAggregateRepository: UsageAggregateRepository;
  pricingRepository: PricingRepository;  // NEW
}

export async function ingestUsageEvents(
  deps: IngestUsageEventsDeps,
  events: (UsageEventInput | TokenOnlyUsageEventInput)[],
  ingress: 'internal' | 'orchestrator_webhook',
  options: { computeCost?: boolean } = {},
): Promise<UsageIngestResponse> {
  // ...
  // If computeCost is true, fetch pricing once up front:
  let pricingSnapshot: Record<LlmProvider, ProviderPricing> | null = null;
  if (options.computeCost === true) {
    pricingSnapshot = await deps.pricingRepository.getAll();
  }

  for (let i = 0; i < events.length; i++) {
    const input = events[i];
    if (input === undefined) continue;

    let costBlock = 'cost' in input ? input.cost : undefined;
    if (costBlock === undefined || options.computeCost === true) {
      if (pricingSnapshot === null) {
        rejected.push({ index: i, code: 'INVALID_REQUEST', message: 'cost is required when computeCost is false' });
        continue;
      }
      try {
        const calculated = calculateEventCost(input as UsageEventInput, pricingSnapshot);
        costBlock = {
          billedUsd: calculated.billedUsd,
          providerReportedUsd: null,
          calculatedUsd: calculated.calculatedUsd,
          pricingSource: calculated.pricingSource,
        };
      } catch (e) {
        if (e instanceof PricingNotFoundError) {
          rejected.push({ index: i, code: 'PRICING_NOT_FOUND', message: e.message });
          continue;
        }
        throw e;
      }
    }

    const fullEvent: UsageEvent = { ...input, cost: costBlock, receivedAt, ingress };
    // ... existing createEvent + aggregate flow
  }
}
```

Note: `TokenOnlyUsageEventInput` is a new type alias: `Omit<UsageEventInput, 'cost'>`. Add it to `apps/llm-usage-service/src/domain/models/usageEvent.ts`.

#### Step 3.6: Widen the Fastify route schema

- File: `apps/llm-usage-service/src/routes/schemas/usageEventSchema.ts:16-164`

Add a second exported schema `$id: 'TokenOnlyUsageEventInput'` that is a copy of `UsageEventInput` with `cost` removed from `required`. The existing strict schema stays. The route body in `internalUsageRoutes.ts` becomes:

```ts
body: {
  type: 'object',
  required: ['schemaVersion', 'events'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    computeCost: { type: 'boolean', default: false },
    events: {
      type: 'array',
      items: { anyOf: [{ $ref: 'UsageEventInput#' }, { $ref: 'TokenOnlyUsageEventInput#' }] },
    },
  },
}
```

**⚠ DECISION NEEDED:** the `anyOf` approach allows mixed batches (some events with `cost`, some without) in a single request. If we want stricter behavior — "if `computeCost: true`, ALL events must omit `cost`" — the schema gets more complex (a top-level `if/then/else`). Recommend starting with `anyOf` for simplicity; Track 5 can tighten later if needed.

#### Step 3.7: Pass `pricingRepository` and `computeCost` through the route handler

- File: `apps/llm-usage-service/src/routes/internalUsageRoutes.ts:85-94`

```ts
const { usageEventRepository, usageAggregateRepository, pricingRepository } = getServices();
const result = await ingestUsageEvents(
  { logger: request.log, usageEventRepository, usageAggregateRepository, pricingRepository },
  body.events,
  'internal',
  { computeCost: body.computeCost === true },
);
```

Do the same in `apps/llm-usage-service/src/routes/webhookUsageRoutes.ts` so the orchestrator webhook can opt in once Track 2 wires it up. **Default `computeCost: false`** on the webhook for now — Track 2 flips it to `true` when ready.

### Phase 4 — Internal client extension

#### Step 4.1: Failing test for the new client method

- File: `packages/internal-clients/src/usage-service/__tests__/client.test.ts`

Add a test for `fetchPricing()`: mocks a successful `GET /internal/pricing` response via `nock`, asserts the client returns `ok({ google, openai, anthropic, perplexity })`. Add a failure test for 401 → `err({ code: 'API_ERROR' })`. Add a network failure test → `err({ code: 'NETWORK_ERROR' })`.

#### Step 4.2: Extend the client

- File: `packages/internal-clients/src/usage-service/types.ts:171-181`

```ts
import type { AllPricingResponse } from '@intexuraos/llm-pricing';

export interface UsageServiceClient {
  ingestEvents(...): Promise<Result<UsageIngestResponse, UsageServiceError>>;
  queryUsage(...): Promise<Result<UsageQueryResponse, UsageServiceError>>;
  fetchPricing(options?: { traceId?: string }): Promise<Result<AllPricingResponse, UsageServiceError>>;  // NEW
}
```

- File: `packages/internal-clients/src/usage-service/client.ts:19-61`

```ts
async fetchPricing(
  options?: { traceId?: string },
): Promise<Result<AllPricingResponse, UsageServiceError>> {
  const result = await fetchWithAuth<ApiResponse<AllPricingResponse>>(
    config,
    '/internal/pricing',
    {
      method: 'GET',
      ...(options?.traceId !== undefined ? { traceId: options.traceId } : {}),
    },
  );
  if (!result.ok) return err({ code: result.error.code, message: result.error.message });
  return ok(result.value.data);
}
```

Pre-flight: before adding the `AllPricingResponse` import, confirm `@intexuraos/llm-pricing` is already a dependency of `packages/internal-clients`: `rg '"@intexuraos/llm-pricing"' packages/internal-clients/package.json`. If not, add it as a `dependencies` entry. Running `pnpm install` is required before the build will succeed.

### Phase 5 — One-time migration from `app-settings-service`

#### Step 5.1: Write the migration

- File: `migrations/086_migrate_pricing_to_llm_usage_service.mjs` (new)

```js
/**
 * Migration 086: Copy LLM pricing from app-settings-service to llm-usage-service.
 *
 * Source: settings/llm_pricing/providers/{provider}     (owner: app-settings-service)
 * Target: llm_pricing/{provider}                         (owner: llm-usage-service)
 *
 * Idempotent: re-running this is safe. Overwrites the target doc with the
 * source doc each time. The SOURCE is NOT deleted — that happens in a later
 * cleanup migration after the app-settings-service endpoint is removed.
 */

export const metadata = {
  id: '086',
  name: 'migrate_pricing_to_llm_usage_service',
  description: 'Copy LLM pricing into the new llm_pricing collection owned by llm-usage-service',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity'];
  const batch = context.firestore.batch();
  let copied = 0;

  for (const p of providers) {
    const srcSnap = await context.firestore.doc(`settings/llm_pricing/providers/${p}`).get();
    if (!srcSnap.exists) {
      throw new Error(`Source pricing missing for provider: ${p}`);
    }
    batch.set(context.firestore.doc(`llm_pricing/${p}`), srcSnap.data());
    copied++;
  }

  await batch.commit();
  console.log(`  Copied ${copied} provider pricing docs to llm_pricing/*`);
}
```

**Migrations are IMMUTABLE** — if this migration has a bug, you write migration 087 to fix it. Do NOT edit 086 after it has been applied anywhere.

#### Step 5.2: Test the migration against the emulator

Run `node scripts/migrate.mjs` against the emulator (see Phase 1 instructions in the plan reference) and confirm `llm_pricing/google`, `llm_pricing/openai`, `llm_pricing/anthropic`, `llm_pricing/perplexity` all exist with the same model data as the source. Assert via a spot check: `anthropic.models['claude-sonnet-4-5-20250929'].inputPricePerMillion === 3`.

#### Step 5.3: Parity verification script

- File: `apps/llm-usage-service/scripts/verify-pricing-parity.mjs` (new)

Standalone node script that starts no server — it opens Firestore directly, reads both `settings/llm_pricing/providers/*` and `llm_pricing/*`, and asserts deep-equality per provider. Prints a diff if mismatch. This script is NOT a migration; it's a manual verification tool, rerun after every pricing update until old endpoint is removed.

Run this against dev Firestore after 5.2 lands and before Phase 6 starts.

### Phase 6 — Redirect all consumers

This phase is mechanical: every consumer that calls `fetchAllPricing(APP_SETTINGS_SERVICE_URL, ...)` is updated to call it with the new URL **and** a different endpoint path. There are two ways to do this:

**Option A — Update `fetchAllPricing()` in place.** Change `packages/llm-pricing/src/pricingClient.ts:129` from `${baseUrl}/internal/settings/pricing` to `${baseUrl}/internal/pricing`. Then update each consumer to pass the llm-usage-service URL instead of app-settings-service URL. PRO: no new symbol, no deprecations. CON: big-bang — all 11 consumers must be updated and deployed together.

**Option B — Add a new symbol.** Add a second function `fetchAllPricingFromUsageService(baseUrl, token)` that hits `/internal/pricing`, keeping the old `fetchAllPricing()` unchanged. Flip consumers one at a time. PRO: incremental rollout. CON: two functions doing the same thing for the duration of the rollout.

**⚠ DECISION NEEDED:** Recommend **Option B** because the repo's dev environment has PM2 restarting services independently and prod has Cloud Run rolling deploys. Big-bang requires all 11 apps to redeploy atomically, which the infrastructure doesn't guarantee. The `fetchAllPricing()` vs `fetchAllPricingFromUsageService()` split is short-lived (1-2 weeks) and deleted in Phase 7.

The rest of this phase assumes Option B.

#### Step 6.1: Add `fetchAllPricingFromUsageService` to `@intexuraos/llm-pricing`

- File: `packages/llm-pricing/src/pricingClient.ts` (append)

```ts
export async function fetchAllPricingFromUsageService(
  baseUrl: string,
  authToken: string,
): Promise<Result<AllPricingResponse, PricingClientError>> {
  const url = `${baseUrl}/internal/pricing`;
  try {
    const response = await fetch(url, { headers: { 'X-Internal-Auth': authToken } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return err({ code: 'API_ERROR', message: `HTTP ${String(response.status)}: ${body.slice(0, 200)}` });
    }
    const data = (await response.json()) as { success: boolean; data: AllPricingResponse };
    if (!data.success) return err({ code: 'API_ERROR', message: 'Response success is false' });
    return ok(data.data);
  } catch (error) {
    return err({ code: 'NETWORK_ERROR', message: getErrorMessage(error) });
  }
}
```

Export from `packages/llm-pricing/src/index.ts:17-24`. Add a test in `packages/llm-pricing/src/__tests__/pricingClient.test.ts` mirroring the existing `fetchAllPricing` tests.

#### Step 6.2: Flip consumers one at a time

Rollout order (safest first — the services least likely to break if pricing fetch fails):

1. `apps/image-service/src/index.ts:44-48` — image service (narrow blast radius: only affects image generation cost calc).
2. `apps/research-agent/src/index.ts:64-68` — research agent.
3. `apps/data-insights-agent/src/index.ts:51-53` — data insights.
4. `apps/calendar-agent/src/index.ts:43-45` — calendar.
5. `apps/linear-agent/src/index.ts:45-47` — linear.
6. `apps/commands-agent/src/services.ts:67` — commands.
7. `apps/actions-agent/src/services.ts:176-186` — actions.
8. `apps/todos-agent/src/services.ts:31` — todos.
9. `apps/user-service/src/index.ts:48-52` — user-service (wider impact: every user login touches it).
10. `apps/web-agent/src/index.ts:35-45` — web-agent.
11. `apps/chat-agent/src/services.ts:80-109` — chat-agent (highest traffic; last).

For each, the change is:

```ts
// BEFORE
import { fetchAllPricing, createPricingContext } from '@intexuraos/llm-pricing';
const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';
const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);

// AFTER
import { fetchAllPricingFromUsageService, createPricingContext } from '@intexuraos/llm-pricing';
const usageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '';
const pricingResult = await fetchAllPricingFromUsageService(usageServiceUrl, internalAuthToken);
```

**Env var check for each consumer:**

- `apps/<name>/src/index.ts` `REQUIRED_ENV` array — if the consumer previously required `INTEXURAOS_APP_SETTINGS_SERVICE_URL` **only for pricing** (not for anything else), remove it from `REQUIRED_ENV` and add `INTEXURAOS_LLM_USAGE_SERVICE_URL`. Run `rg "APP_SETTINGS_SERVICE_URL" apps/<name>` first — if it's still used elsewhere (e.g. todos-agent uses it for saving model preferences), KEEP it.
- `terraform/environments/dev/main.tf` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL = module.llm_usage_service.service_url` to each consumer's env map IF NOT ALREADY PRESENT (it already is for services that call the usage service for ingest; check before editing).
- `ecosystem.config.cjs` — same check. `INTEXURAOS_LLM_USAGE_SERVICE_URL` is already defined globally at line 57, so it should flow to every PM2 app that imports the shared env.

**Per-consumer test updates.** Each consumer that mocks pricing in its test suite (e.g. `apps/chat-agent/src/__tests__/services.test.ts:47`) needs its mock updated from `mockFetchAllPricing` → `mockFetchAllPricingFromUsageService`. Grep each consumer's `__tests__/` for `fetchAllPricing` before editing the source.

#### Step 6.3: Run `ci:tracked` per consumer after each flip

Do not batch multiple consumers into one commit. Each commit is:
1. Flip one consumer.
2. `pnpm run verify:workspace:tracked -- <app-name>`.
3. `pnpm run ci:tracked`.
4. Commit with title like `INT-1339: migrate chat-agent pricing fetch to llm-usage-service`.
5. Open PR targeting `development`, merge, wait for dev deploy, smoke-test the consumer's health endpoint.

This is slow by design — we're swapping a startup-critical dependency on 11 apps.

### Phase 7 — Deprecate the old endpoint

#### Step 7.1: Return 307 from `app-settings-service`

Only do this after Phase 6 has been stable for 1 week.

- File: `apps/app-settings-service/src/routes/internalRoutes.ts:58-112`

Replace the handler body with a 307 redirect to `${INTEXURAOS_LLM_USAGE_SERVICE_URL}/internal/pricing`. Keep the auth check (so unauthenticated callers still get 401, not a misleading 307). Log a warning on every hit so we can see which caller still uses the old endpoint.

**⚠ DECISION NEEDED:** 307 vs 410-gone. 307 lets any unmigrated caller keep working transparently (fetch follows redirects by default). 410 forces a failure. Recommend 307 for 1 week to catch stragglers, then 410 for 1 week, then delete the route. Aggressive but safer than silently serving stale data.

#### Step 7.2: Delete dead code

After 2 weeks of 307+410 with zero hits in logs:

- Delete `apps/app-settings-service/src/routes/internalRoutes.ts` handler (or the file if nothing else lives there).
- Delete `apps/app-settings-service/src/infra/firestore/index.ts` `FirestorePricingRepository`.
- Delete `apps/app-settings-service/src/services.ts` `pricingRepository` field.
- Delete `apps/app-settings-service/src/__tests__/infra/FirestorePricingRepository.test.ts`.
- Delete `apps/app-settings-service/src/domain/ports/index.ts` `PricingRepository`, `ModelPricing`, `ProviderPricing`, `ImageSize` (keep any usage-stats types still in use).
- Delete the old `fetchAllPricing()` function from `packages/llm-pricing/src/pricingClient.ts:125-169` (only `fetchAllPricingFromUsageService` remains). Then rename it back to `fetchAllPricing` in a follow-up PR once there's no chance of confusion.
- Write migration 087 (or whatever is next) to DELETE `settings/llm_pricing/providers/*` from Firestore.

None of the Phase 7 deletions happen inside INT-1339 itself — they are follow-up tickets (e.g. INT-1339a, INT-1339b). This plan leaves the old endpoint in place behind a 307.

## Test plan

New test files:

- `apps/llm-usage-service/src/__tests__/fakePricingRepository.ts` — in-memory fake used by multiple downstream tests.
- `apps/llm-usage-service/src/__tests__/infra/firestore/firestorePricingRepository.test.ts` — Firestore integration. Asserts missing-doc returns null, present-doc round-trips, `getAll` throws on partial data.
- `apps/llm-usage-service/src/__tests__/routes/internalPricingRoutes.test.ts` — route-level tests: 401 on missing auth, 200 on success, 500 on missing provider, schema validation.
- `apps/llm-usage-service/src/__tests__/domain/usecases/calculateEventCost.test.ts` — pure unit tests for the cost formula. Covers the 7 scenarios in Step 3.2.
- `apps/llm-usage-service/src/__tests__/domain/usecases/ingestUsageEvents.test.ts` — extended with 3 new cases: `computeCost: true` happy path, `computeCost: true` + unknown model → rejected, `computeCost: false` → no pricing fetch.
- `packages/internal-clients/src/usage-service/__tests__/client.test.ts` — extended with `fetchPricing()` tests using `nock`.
- `packages/llm-pricing/src/__tests__/pricingClient.test.ts` — extended with `fetchAllPricingFromUsageService()` tests that mirror the existing `fetchAllPricing()` suite (success, 4xx, 5xx, network error, invalid JSON, `success: false` body).

Coverage targets:

- `apps/llm-usage-service`: 95% branch coverage including the new files. The image-pricing branch (only-1024) is exercised. The `useProviderCost` branch is exercised.
- `packages/internal-clients`: 95% branch coverage including `fetchPricing()`.
- `packages/llm-pricing`: 95% branch coverage including `fetchAllPricingFromUsageService()`.
- No `v8 ignore` pragmas are needed. If you find yourself writing one, stop and ask — every branch in this track is testable with the in-memory fake or `nock`.

Per-consumer test updates (11 apps, Phase 6):

- For each consumer, update mocks from `fetchAllPricing` to `fetchAllPricingFromUsageService`. No new test files needed.

## Rollout plan

1. **Phases 1-5 ship as one PR** targeting `development`. This adds the new route/repo/migration but does NOT touch any consumer. After merge, dev deploys, migration runs. Parity script from Step 5.3 passes.
2. **Smoke test**: manually `curl` `https://llm-usage-service.<dev>/internal/pricing` with `X-Internal-Auth`. Confirm response shape matches `AllPricingResponse`. Compare against `GET /internal/settings/pricing` on app-settings-service — they must be byte-for-byte equal.
3. **Phase 6 ships as 11 separate PRs**, one per consumer, in the order listed in Step 6.2. Each PR:
   - Waits for previous consumer to be stable in dev for at least 1 hour.
   - Runs `pnpm run ci:tracked`.
   - After merge + dev deploy, tail the consumer's logs for startup errors and confirm it boots with pricing loaded.
4. **Stability window**: after all 11 consumers are on the new endpoint, wait 1 week. During this week both endpoints serve the same data (from different Firestore collections, kept in sync by re-running migration 086 if needed).
5. **Phase 7.1 ships as a single PR**: flip `GET /internal/settings/pricing` on app-settings-service to return 307. Tail logs for any hits.
6. **Second stability window**: 1 week of 307. Any hits in logs are investigated — the caller is missing from Phase 6 and must be flipped.
7. **Phase 7.2** (follow-up ticket): delete dead code and write the cleanup Firestore migration.

## Acceptance criteria

- [ ] `apps/llm-usage-service/src/domain/repositories/pricingRepository.ts` exists and is a domain port.
- [ ] `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts` exists and reads from `llm_pricing/{provider}`.
- [ ] `GET /internal/pricing` on llm-usage-service returns `AllPricingResponse` and requires `X-Internal-Auth`.
- [ ] `POST /internal/usage/events` accepts `computeCost: true` and fills `cost` server-side.
- [ ] `calculateEventCost` handles cache multipliers, web search, grounding, image generation, and `useProviderCost` bypass.
- [ ] `migrations/086_migrate_pricing_to_llm_usage_service.mjs` has been applied in dev and parity verified.
- [ ] `firestore-collections.json` lists `llm_pricing` owned by `llm-usage-service`.
- [ ] `packages/internal-clients/src/usage-service/client.ts` has `fetchPricing()` method.
- [ ] `packages/llm-pricing/src/pricingClient.ts` exports `fetchAllPricingFromUsageService`.
- [ ] All 11 consumer apps have been migrated and each boots cleanly against `INTEXURAOS_LLM_USAGE_SERVICE_URL`.
- [ ] `pnpm run ci:tracked` green at repo root.
- [ ] New backend code has 95% branch coverage with no `v8 ignore` additions.
- [ ] Every new test was written before its implementation (verifiable in git history).
- [ ] `GET /internal/settings/pricing` on app-settings-service returns 307 (Phase 7.1 merged).
- [ ] No consumer code references `fetchAllPricing` directly anymore (only `fetchAllPricingFromUsageService`).
- [ ] No Firestore read/write to `settings/llm_pricing/providers/*` from any code path outside the migration script.

## Risks and mitigations

| Risk                                                                                                                                                                                       | Likelihood  | Impact   | Mitigation                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 086 runs before llm-usage-service has the new route deployed, leaving a window where pricing is duplicated but not served.                                                       | Low         | Low      | Phases 1-5 ship as one PR so route + repo + migration go live together. The old endpoint keeps serving during this window.                                                                                                   |
| A consumer silently fails to fetch pricing and boots with a broken `PricingContext`.                                                                                                       | Medium      | High     | Each consumer's bootstrap path already throws on pricing fetch failure (`fetchAllPricing` error → `throw new Error`). Don't relax that — fail loud. Tail logs after each Phase 6 PR.                                         |
| `calculateEventCost` disagrees with the old client-side calculators (e.g. `infra-claude`), leading to cost drift between Track 2 (server-calc) and Phases 1 consumers (still client-calc). | High        | Medium   | Track 2 is the only caller who uses `computeCost: true` in the near term. Existing consumers keep supplying their own `cost` block. We accept a small Track-2-only drift for now; Track 5 (INT-1343) centralizes everything. |
| Schema widening (`anyOf` on event item) breaks Fastify's strict validation for some edge case.                                                                                             | Low         | Medium   | Add a regression test in `internalUsageRoutes.test.ts` that posts a mixed batch (1 event with cost, 1 without + `computeCost: true`) and asserts both succeed.                                                               |
| The new `llm_pricing` Firestore collection drifts from `settings/llm_pricing/providers/*` because the old endpoint keeps getting updates.                                                  | High        | High     | No pricing writes happen during this track. If pricing changes are needed mid-rollout, write a new migration (087) that updates BOTH collections until Phase 7 is done.                                                      |
| Per-size image pricing (1024x1536, 1536x1024) is ignored — all image calls billed at 1024x1024 price.                                                                                      | Low today   | Medium   | Accepted: `DECISION NEEDED` marker on Step 3.3. Current consumers only use 1024x1024. If that changes, add `request.imageSize` to the event schema in a follow-up.                                                           |
| The orchestrator (Track 2) starts calling `computeCost: true` before Phase 2 is deployed.                                                                                                  | Low         | High     | Track 2 is explicitly BLOCKED on INT-1339 per the plan header. Do not merge any Track 2 PR until INT-1339 Phase 1-5 is in dev.                                                                                               |
| Rolling back a consumer mid-rollout leaves it pointing at the wrong URL.                                                                                                                   | Medium      | Low      | Each consumer PR is atomic (one commit, one app, one URL change). Revert = single `git revert`.                                                                                                                              |

## Out of scope

- User-scoped pricing endpoints (pricing stays internal-only).
- Per-user pricing overrides or promotional pricing.
- Caching `GET /internal/pricing` in consumers beyond the existing `PricingContext` (that's already per-process in-memory; no Redis).
- Per-image-size event tracking — all image generation billed at 1024x1024 price in v1.
- Historical backfill of `cost.billedUsd` on events that were stored with wrong prices before this track landed.
- Deleting the `settings/llm_pricing/providers/*` Firestore subtree — that's a cleanup migration in a follow-up ticket.
- Physically removing `GET /internal/settings/pricing` from app-settings-service — Phase 7.2 tracks deletion but ships separately.
- Migrating the web app's settings UI (`apps/web/src/services/settingsApi.ts`) — the web app reads pricing for display, not calculation, and can stay pointed at `app-settings-service` indefinitely. If it ever needs to move, it's a separate ticket.
- Track 2 (orchestrator cost calc) work itself — this plan only unblocks it.
- Track 5 (full client rollout of `computeCost: true`) — this plan only provides the capability.
