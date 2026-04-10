# INT-1339 — Track 4: Move LLM Pricing Ownership into llm-usage-service

## Status
- Linear issue: INT-1339
- Parent epic: INT-1338
- Dependencies: none (independent — start immediately)
- Blocks: INT-1343 (Track 5, pricing UI move)
- Plan version: 2.0 (2026-04-10)

## Executive summary

Today, `app-settings-service` owns the `settings/llm_pricing/providers/{provider}` Firestore sub-collection and exposes `GET /internal/settings/pricing`. Every cost-emitting app (`chat-agent`, `actions-agent`, `web-agent`, `linear-agent`, `commands-agent`, `user-service`, `research-agent`, `image-service`, `todos-agent`, `data-insights-agent`, `calendar-agent`) pulls that payload at boot via `fetchAllPricing()` from `@intexuraos/llm-pricing` and hydrates a `PricingContext`. Track 5 (INT-1343) wants to surface pricing in the UI via a public endpoint on `llm-usage-service`.

This track transplants pricing ownership from `app-settings-service` into `llm-usage-service` as a new `llm_pricing` Firestore collection, adds a new internal `POST /internal/pricing` write route and a public `GET /llm-usage/pricing` read route (Auth0 bearer, for the pricing UI), performs a one-time Firestore migration copying `settings/llm_pricing/providers/*` into `llm_pricing/{provider}`, updates all 11 consumers' `fetchAllPricing()` callers to point at the new endpoint (in-place URL swap, not a new symbol), and **atomically deletes** the old `GET /internal/settings/pricing` endpoint in the same PR.

**Server-side cost calculation is NOT in scope for this track.** All existing and new callers compute cost client-side. The `computeCost` flag, `calculateEventCost` use case, schema `anyOf` widening, and image-pricing defaults were dropped per the INT-1338 decisions doc.

The end state: `llm-usage-service` owns pricing reads and writes, the public `GET /llm-usage/pricing` endpoint serves Track 5's UI, every consumer boots against `INTEXURAOS_LLM_USAGE_SERVICE_URL` for pricing, and the old `app-settings-service` endpoint is deleted in the same PR as the consumer migration.

## Pre-flight checks (do these before writing any code)

1. From repo root, establish a green baseline: `pnpm run ci:tracked | tee /tmp/int-1339-baseline.txt`. Do not proceed if anything fails.
2. Re-verify every context file listed below still exists at the cited line number (files drift between planning and execution). If a line number has shifted by more than a few lines, update the plan before editing.
3. Run `pnpm build` from repo root so `packages/llm-pricing/dist/` and `packages/internal-clients/dist/` exist. Without this, the new imports in llm-usage-service will error with `Cannot find module`.
4. Grep the whole repo for stragglers this plan may have missed: `rg "settings/llm_pricing|settings\.llm_pricing|/internal/settings/pricing"` — anything that matches must either be updated in Phase 6 or explicitly listed in "Unchanged".
5. Grep: `rg "fetchAllPricing\("` — verify the list of 11 consumer apps in Phase 6 is still accurate. If new consumers have appeared, add them.
6. Read `packages/llm-contract/src/pricing.ts:36-67` (`ModelPricing`) and `packages/llm-contract/src/pricing.ts:75-82` (`ProviderPricing`). These are the types the new repository must return unchanged.
7. Confirm `firestore-collections.json:252-259` still lists `llm_usage_events` and `llm_usage_daily_aggregates` as owned by `llm-usage-service`. The new `llm_pricing` collection will be added to the same owner.

## Context files

- `apps/llm-usage-service/src/routes/internalUsageRoutes.ts:25-195` — existing route file. New `POST /internal/pricing` handler goes here (or a new route file alongside it).
- `apps/llm-usage-service/src/services.ts:6-10` — `ServiceContainer` interface, needs a new `pricingRepository` field. Tests will fail fast because `setServices({...})` calls currently don't provide it.
- `apps/llm-usage-service/src/infra/firestore/firestoreUsageEventRepository.ts:1-27` — reference pattern for the new `FirestorePricingRepository`. Same style: constant `COLLECTION`, `getFirestore()` inside each method, narrow `try/catch` around Firestore errors, `Result` return type.
- `packages/llm-pricing/src/pricingClient.ts:125-169` — the current `fetchAllPricing()`. The URL `${baseUrl}/internal/settings/pricing` at line 129 is the only line that changes. The intent in Phase 6 is for each consumer to pass the `llm-usage-service` URL instead of `app-settings-service`. The endpoint path becomes `/internal/pricing` (not `/internal/settings/pricing`). This is an in-place edit of `fetchAllPricing()` — no new symbol is added.
- `packages/llm-pricing/src/pricingClient.ts:217-285` — `PricingContext` class. Unchanged by this track.
- `apps/app-settings-service/src/routes/internalRoutes.ts:12-113` — the old pricing route, **deleted** in Phase 7 (atomic, same PR as consumer migration).
- `apps/app-settings-service/src/infra/firestore/index.ts:20-41` — `FirestorePricingRepository` in the old service. Deleted in Phase 7.
- `apps/app-settings-service/src/services.ts:5-27` — DI container. The `pricingRepository` field here is deleted in Phase 7.
- `migrations/002_initial-llm-pricing.mjs`, `migrations/012_new-pricing-structure.mjs` — reference for how pricing migrations have historically been structured. The new one follows the same pattern but reads from `settings/llm_pricing/providers/*` and writes to `llm_pricing/{provider}`.
- `scripts/migrate.mjs:29` — migrations directory is the top-level `migrations/` (NOT per-app). The new file goes there as `migrations/086_migrate_pricing_to_llm_usage_service.mjs`.
- `docs/superpowers/plans/2026-04-09-llm-usage-service-implementation-plan.md` — Phase 1 plan for format reference.
- `.claude/reference/env-vars-patterns.md` — the 3-location env-var rule (not relevant here because we reuse existing vars, but linked for reviewers).

## Endpoint changes

### Modified
None. `POST /internal/usage/events` on `llm-usage-service` is NOT modified — no `computeCost` flag, no schema widening.

### Created
- `POST /internal/pricing` on `llm-usage-service` — write pricing (for the migration script and future admin operations). Requires `X-Internal-Auth`.
- `GET /llm-usage/pricing` on `llm-usage-service` — returns the `AllPricingResponse` shape (`{ google, openai, anthropic, perplexity, openrouter }`), wrapped in `{ success, data }`. Requires Auth0 bearer auth. This is the public read endpoint used by Track 5's pricing UI.

### Removed
- `GET /internal/settings/pricing` on `app-settings-service` — **deleted** in Phase 7 (same PR as the consumer migration). No 307 redirect, no 410 period.

### Unchanged
- `POST /internal/usage/events` — unaffected. Behavior, schema, and callers unchanged.
- `POST /internal/usage/query` — unaffected.

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

The Firestore test asserts three things: (a) `getByProvider` returns `null` for a missing doc, (b) `getByProvider` returns a typed `ProviderPricing` for a present doc, (c) `getAll` reads all five providers in parallel and returns a fully-populated `Record<LlmProvider, ProviderPricing>`. Use the repo's Firestore emulator pattern from `apps/llm-usage-service/src/__tests__/infra/firestore/firestoreUsageEventRepository.test.ts` as the template.

Expected failure: tests import `../domain/repositories/pricingRepository.js` and `./firestorePricingRepository.js`, neither of which exists yet. Vitest reports `Cannot find module`.

#### Step 1.2: Implement the `PricingRepository` interface

- File: `apps/llm-usage-service/src/domain/repositories/pricingRepository.ts`

```ts
import type { LlmProvider, ProviderPricing } from '@intexuraos/llm-contract';

export interface PricingRepository {
  /** Fetch a single provider's pricing. Returns null if no document exists. */
  getByProvider(provider: LlmProvider): Promise<ProviderPricing | null>;

  /**
   * Fetch all five provider pricing docs in parallel.
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
      LlmProviders.OpenRouter,
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

Note on providers: 5 providers total — `google`, `openai`, `anthropic`, `perplexity`, `openrouter`. `zai` has been dropped entirely (per INT-1338 decisions). For OpenRouter, pricing table entries may be informational only since cost comes from the provider API response (`cost.pricingSource = 'provider_reported'`). Verify what is actually stored during implementation; do not throw if OpenRouter pricing is absent if the design settles on informational-only.

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
  "description": "LLM pricing per provider (one doc per provider, keyed by provider ID). Exposed via GET /llm-usage/pricing for the pricing UI and POST /internal/pricing for admin writes."
}
```

This enforces the one-owner rule. No other service may read or write `llm_pricing` directly — cross-service reads go through the new HTTP endpoint.

### Phase 2 — HTTP routes

#### Step 2.1: Failing tests for the new pricing routes

- File: `apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts` (new)

Test cases for `POST /internal/pricing` (write):
1. Missing `X-Internal-Auth` → 401 with `error.code === 'UNAUTHORIZED'`.
2. Valid auth + valid body → 200, data persisted via `pricingRepository`.
3. Invalid body (missing required fields) → 400 schema validation error.

Test cases for `GET /llm-usage/pricing` (public read):
1. Missing Auth0 bearer → 401 with `error.code === 'UNAUTHORIZED'`.
2. Valid Auth0 bearer + fake repo populated with all 5 providers → 200 with body `{ success: true, data: { google, openai, anthropic, perplexity, openrouter } }`, each matching `AllPricingResponse` shape.
3. Valid auth + fake repo missing `anthropic` → 500 with `error.code === 'INTERNAL_ERROR'` and the message mentions the missing provider.
4. Fastify route schema validation: response body is checked against the schema (`additionalProperties: false`) so any accidental leak of extra fields fails the test.

The test uses `app.inject()` per the project testing rules. Use `setServices({ ...defaults, pricingRepository: fake })` in `beforeEach`, `resetServices()` in `afterEach`.

Expected failure: the routes do not exist yet, Fastify returns 404.

#### Step 2.2: Implement the routes

- File: `apps/llm-usage-service/src/routes/pricingRoutes.ts` (new)

```ts
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, validateAuth0Bearer, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const pricingRoutes: FastifyPluginCallback = (app, _opts, done) => {
  // Write: internal only
  app.post(
    '/internal/pricing',
    {
      schema: {
        operationId: 'internalWritePricing',
        summary: 'Write LLM pricing for a provider (internal)',
        tags: ['pricing'],
        // body schema: ProviderPricing shape
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Internal pricing write' });
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }
      const { pricingRepository } = getServices();
      // ... persist the body via pricingRepository
      return await reply.ok({});
    },
  );

  // Read: public, Auth0 bearer
  app.get(
    '/llm-usage/pricing',
    {
      schema: {
        operationId: 'getAllPricing',
        summary: 'Get all LLM pricing',
        description: 'Returns pricing for google, openai, anthropic, perplexity, and openrouter.',
        tags: ['pricing'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                required: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'],
                properties: {
                  google: { $ref: 'ProviderPricing#' },
                  openai: { $ref: 'ProviderPricing#' },
                  anthropic: { $ref: 'ProviderPricing#' },
                  perplexity: { $ref: 'ProviderPricing#' },
                  openrouter: { $ref: 'ProviderPricing#' },
                },
              },
            },
            required: ['success', 'data'],
          },
          401: { /* same shape as other routes */ },
          500: { /* same */ },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Public pricing read' });
      const authResult = validateAuth0Bearer(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Auth failed');
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
    provider: { type: 'string', enum: ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'] },
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
import { pricingRoutes } from './pricingRoutes.js';
// ...
await app.register(pricingRoutes);
```

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
 * Providers: google, openai, anthropic, perplexity, openrouter (zai dropped)
 *
 * Idempotent: re-running this is safe. Overwrites the target doc with the
 * source doc each time.
 */

export const metadata = {
  id: '086',
  name: 'migrate_pricing_to_llm_usage_service',
  description: 'Copy LLM pricing into the new llm_pricing collection owned by llm-usage-service',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'];
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

Run `node scripts/migrate.mjs` against the emulator (see Phase 1 instructions in the plan reference) and confirm `llm_pricing/google`, `llm_pricing/openai`, `llm_pricing/anthropic`, `llm_pricing/perplexity`, `llm_pricing/openrouter` all exist with the same model data as the source. Assert via a spot check: `anthropic.models['claude-sonnet-4-5-20250929'].inputPricePerMillion === 3`.

### Phase 6 — Migrate all consumers and delete old endpoint (atomic)

This phase is a **single PR** that:
1. Updates all 11 consumers' `fetchAllPricing()` callers (in-place URL swap).
2. Deletes the old `GET /internal/settings/pricing` route on `app-settings-service`.

No staged rollout. All consumers flip at once, then the old endpoint is gone. Ship during a low-traffic window with standard rollback readiness.

#### Step 6.1: Update `fetchAllPricing()` in place

- File: `packages/llm-pricing/src/pricingClient.ts:129`

Change the URL from `${baseUrl}/internal/settings/pricing` to `${baseUrl}/internal/pricing`. This is an in-place edit of the existing `fetchAllPricing()` — **do not** add a new symbol (`fetchAllPricingFromUsageService` is NOT created).

Export is unchanged. Callers change only the URL they pass (from `app-settings-service` URL to `llm-usage-service` URL).

Update tests in `packages/llm-pricing/src/__tests__/pricingClient.test.ts` to reflect the new path.

#### Step 6.2: Flip all 11 consumers

For each consumer, the change is:

```ts
// BEFORE
const appSettingsUrl = process.env['INTEXURAOS_APP_SETTINGS_SERVICE_URL'] ?? '';
const pricingResult = await fetchAllPricing(appSettingsUrl, internalAuthToken);

// AFTER
const usageServiceUrl = process.env['INTEXURAOS_LLM_USAGE_SERVICE_URL'] ?? '';
const pricingResult = await fetchAllPricing(usageServiceUrl, internalAuthToken);
```

All 11 consumers:

1. `apps/image-service/src/index.ts:44-48`
2. `apps/research-agent/src/index.ts:64-68`
3. `apps/data-insights-agent/src/index.ts:51-53`
4. `apps/calendar-agent/src/index.ts:43-45`
5. `apps/linear-agent/src/index.ts:45-47`
6. `apps/commands-agent/src/services.ts:67`
7. `apps/actions-agent/src/services.ts:176-186`
8. `apps/todos-agent/src/services.ts:31`
9. `apps/user-service/src/index.ts:48-52`
10. `apps/web-agent/src/index.ts:35-45`
11. `apps/chat-agent/src/services.ts:80-109`

**Env var check for each consumer:**

- `apps/<name>/src/index.ts` `REQUIRED_ENV` array — if the consumer previously required `INTEXURAOS_APP_SETTINGS_SERVICE_URL` **only for pricing** (not for anything else), remove it from `REQUIRED_ENV` and add `INTEXURAOS_LLM_USAGE_SERVICE_URL`. Run `rg "APP_SETTINGS_SERVICE_URL" apps/<name>` first — if it's still used elsewhere (e.g. todos-agent uses it for saving model preferences), KEEP it.
- `terraform/environments/dev/main.tf` — add `INTEXURAOS_LLM_USAGE_SERVICE_URL = module.llm_usage_service.service_url` to each consumer's env map IF NOT ALREADY PRESENT.
- `ecosystem.config.cjs` — same check. `INTEXURAOS_LLM_USAGE_SERVICE_URL` is already defined globally at line 57, so it should flow to every PM2 app that imports the shared env.

**Per-consumer test updates.** Each consumer that mocks pricing in its test suite needs its mock URL updated to point at `/internal/pricing` (new path) rather than `/internal/settings/pricing` (old path). Grep each consumer's `__tests__/` for `fetchAllPricing` and `settings/pricing` before editing the source.

#### Step 6.3: Delete the old endpoint on `app-settings-service` (same PR)

In the same PR as Step 6.1 and 6.2:

- Delete the `GET /internal/settings/pricing` route handler from `apps/app-settings-service/src/routes/internalRoutes.ts`.
- Delete `apps/app-settings-service/src/infra/firestore/index.ts` `FirestorePricingRepository` (or the whole file if nothing else lives there).
- Delete `apps/app-settings-service/src/services.ts` `pricingRepository` field and its wiring in `initializeServices()`.
- Delete `apps/app-settings-service/src/__tests__/infra/FirestorePricingRepository.test.ts` if it exists.
- Delete `apps/app-settings-service/src/domain/ports/index.ts` `PricingRepository`, `ModelPricing`, `ProviderPricing`, `ImageSize` (keep any usage-stats types still in use).
- Write migration 087 to DELETE `settings/llm_pricing/providers/*` from Firestore (now that the source is no longer needed).

No 307 redirect. No 410. The old endpoint is simply deleted.

#### Step 6.4: Run `ci:tracked` before committing

Run `pnpm run ci:tracked` from repo root. Every workspace must pass. Only then commit and open the PR.

### Phase 7 — Cleanup migration

#### Step 7.1: Write the cleanup migration

- File: `migrations/087_delete_old_pricing_source.mjs` (new)

```js
/**
 * Migration 087: Delete the old pricing source docs from app-settings-service.
 *
 * Now that llm-usage-service owns pricing and all consumers have been migrated,
 * the source collection is no longer needed.
 */

export const metadata = {
  id: '087',
  name: 'delete_old_pricing_source',
  description: 'Delete settings/llm_pricing/providers/* (app-settings-service no longer owns pricing)',
  createdAt: '2026-04-10',
};

export async function up(context) {
  const providers = ['google', 'openai', 'anthropic', 'perplexity', 'openrouter'];
  const batch = context.firestore.batch();

  for (const p of providers) {
    batch.delete(context.firestore.doc(`settings/llm_pricing/providers/${p}`));
  }

  await batch.commit();
  console.log(`  Deleted ${providers.length} old pricing docs from settings/llm_pricing/providers/*`);
}
```

This migration ships in the same PR as Phase 6 (atomic deletion). Migrations 086 and 087 together form the complete move.

## Test plan

New test files:

- `apps/llm-usage-service/src/__tests__/fakePricingRepository.ts` — in-memory fake used by multiple downstream tests.
- `apps/llm-usage-service/src/__tests__/infra/firestore/firestorePricingRepository.test.ts` — Firestore integration. Asserts missing-doc returns null, present-doc round-trips, `getAll` throws on partial data.
- `apps/llm-usage-service/src/__tests__/routes/pricingRoutes.test.ts` — route-level tests: 401 on missing auth (both routes), 200 on success, 500 on missing provider (GET), schema validation.

Updated test files:

- `packages/llm-pricing/src/__tests__/pricingClient.test.ts` — update mocked URL from `/internal/settings/pricing` to `/internal/pricing`. No new test cases needed (same behavior, different path).
- Per-consumer test updates (11 apps): update mock URLs from `/internal/settings/pricing` to `/internal/pricing`.

Coverage targets:

- `apps/llm-usage-service`: 95% branch coverage including the new files.
- `packages/llm-pricing`: 95% branch coverage.
- No `v8 ignore` pragmas are needed. If you find yourself writing one, stop and ask.

## Rollout plan

1. **Phases 1-2 + 5 ship as one PR** targeting `development`. This adds the new routes/repo/migration but does NOT touch any consumer. After merge, dev deploys, migration 086 runs. Verify manually: `curl https://llm-usage-service.<dev>/llm-usage/pricing` with Auth0 bearer. Confirm response shape matches `AllPricingResponse` with 5 providers.
2. **Phase 6 + 7 ship as a single PR** (atomic): flip all 11 consumers + delete old endpoint + run migration 087. Deploy during a low-traffic window. After merge + deploy, tail logs for startup errors on all 11 consumers.
3. **No stability window needed** — atomic delete eliminates the dual-endpoint drift window entirely.

## Acceptance criteria

- [ ] `apps/llm-usage-service/src/domain/repositories/pricingRepository.ts` exists and is a domain port.
- [ ] `apps/llm-usage-service/src/infra/firestore/firestorePricingRepository.ts` exists and reads from `llm_pricing/{provider}`.
- [ ] `POST /internal/pricing` on llm-usage-service requires `X-Internal-Auth` and writes pricing.
- [ ] `GET /llm-usage/pricing` on llm-usage-service returns `AllPricingResponse` (5 providers: google, openai, anthropic, perplexity, openrouter) and requires Auth0 bearer auth.
- [ ] `POST /internal/usage/events` is unmodified — no `computeCost` flag, no schema changes.
- [ ] `migrations/086_migrate_pricing_to_llm_usage_service.mjs` has been applied in dev (5 providers copied).
- [ ] `migrations/087_delete_old_pricing_source.mjs` has been applied (old source docs deleted).
- [ ] `firestore-collections.json` lists `llm_pricing` owned by `llm-usage-service`.
- [ ] `packages/llm-pricing/src/pricingClient.ts` `fetchAllPricing()` hits `/internal/pricing` (not `/internal/settings/pricing`).
- [ ] All 11 consumer apps pass `llm-usage-service` URL to `fetchAllPricing()`.
- [ ] `GET /internal/settings/pricing` on `app-settings-service` is deleted (no 307, no 410).
- [ ] `app-settings-service` `pricingRepository` DI wiring is deleted.
- [ ] `pnpm run ci:tracked` green at repo root.
- [ ] New backend code has 95% branch coverage with no `v8 ignore` additions.
- [ ] Every new test was written before its implementation (verifiable in git history).
- [ ] No Firestore read/write to `settings/llm_pricing/providers/*` from any code path outside the migration scripts.

## Risks and mitigations

| Risk                                                                                                                                 | Likelihood | Impact | Mitigation                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 086 runs before llm-usage-service has the new route deployed, leaving a window where pricing is duplicated but not served. | Low        | Low    | Phases 1-2+5 ship as one PR so route + repo + migration go live together. The old endpoint keeps serving during this window.                                           |
| A consumer silently fails to fetch pricing and boots with a broken `PricingContext`.                                                 | Medium     | High   | Each consumer's bootstrap path already throws on pricing fetch failure. Don't relax that — fail loud. Tail logs after Phase 6 PR.                                      |
| OpenRouter pricing table is absent from the old `app-settings-service` collection, causing migration 086 to throw.                   | Medium     | Medium | Verify during pre-flight: `rg "openrouter" apps/app-settings-service/src`. If OpenRouter pricing is not stored there, handle gracefully (skip or write a placeholder). |
| Rolling back Phase 6 mid-deploy — old endpoint is already deleted.                                                                   | Low        | High   | Rollback = revert the PR (restores old endpoint + old consumer URLs in one revert commit). Prepare the revert commit locally before deploying.                         |
| `fetchAllPricing()` URL change in `packages/llm-pricing` breaks a consumer that still points at `app-settings-service` URL.          | Low        | High   | All 11 consumers are updated in the same PR. There is no window where the old URL is used with the new path.                                                           |
