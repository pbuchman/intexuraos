# INT-1529 — Refactor: Backend apps — consolidate service bootstrap, DI, and routing conventions

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (inline checkpoints) or `superpowers:subagent-driven-development` to execute this plan phase-by-phase. Each phase compiles, tests, and commits independently. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1529](https://linear.app/pbuchman/issue/INT-1529/refactor-backend-apps-consolidate-service-bootstrap-di-and-routing)
**Parent:** [INT-1473](https://linear.app/pbuchman/issue/INT-1473)
**Evidence:** `docs/reviews/2026-04-24-refactoring-analysis.md` §1

**Goal:** Collapse ~4,500 LoC of duplicated Fastify bootstrap, three DI-init styles, three use-case directory names, duplicated internal-auth helpers, and two oversized route files (3,260 + 1,630 LoC) into a single, shared, typed backend convention — without changing any public HTTP surface or Firestore ownership.

**Architecture:** Extract cross-cutting Fastify/OpenAPI/health/shutdown boilerplate into two new exports from `@intexuraos/http-server` (`createFastifyApp`, `startFastifyService`). Canonicalize ServiceContainer init via a shared factory exported from `@intexuraos/common-core`. Move duplicated internal-auth helpers into `@intexuraos/common-http/auth`. Introduce a typed `loadEnv` keyed helper and a generic `createFirestoreCrudRepository<T>` in `@intexuraos/infra-firestore`. Each app is then ported in isolation, preserving its existing routes, OpenAPI tags, REQUIRED_ENV list, and health checks.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), Fastify 4/5, `@fastify/swagger`, `@fastify/cors`, `@fastify/formbody`, Firestore, Pub/Sub, vitest, nock, `@intexuraos/{common-core,common-http,http-server,http-contracts,infra-firestore,infra-sentry}`.

---

## Scope & Non-Goals

**In scope (this plan):**
- Shared Fastify bootstrap helpers (`createFastifyApp`, `startFastifyService`) in `@intexuraos/http-server`.
- Shared DI factory (`createServiceContainer`) and typed env loader (`loadEnv`) in `@intexuraos/common-core`.
- Shared internal-auth helpers (`authenticateInternalScheduler`, `authenticateInternalPubSub`) moved to `@intexuraos/common-http/auth`.
- Shared generic `createFirestoreCrudRepository<T>` in `@intexuraos/infra-firestore`.
- Port of all 21 `apps/*/src/server.ts` + `apps/*/src/index.ts` + `apps/*/src/services.ts` to the new shape.
- Rename `useCases` → `usecases` (calendar-agent) and `use-cases` → `usecases` (cron-agent). No rename needed for linear-agent (already `usecases`).
- Removal of all local `MinimalLogger` declarations in `apps/`.
- Removal of `as string` casts and `?? ''` fallbacks after `validateRequiredEnv` in every `apps/*/src/index.ts`.
- Split of `apps/code-agent/src/routes/code/task-routes.ts` (3,260 LoC) and `apps/research-agent/src/routes/researchRoutes.ts` (1,630 LoC) by resource.
- Move direct Firestore access in `apps/code-agent/src/routes/webhooks/complianceReport.ts` into a repository.
- Migration of `apps/{notes-agent,todos-agent,bookmarks-agent,commands-agent}` CRUD repositories onto `createFirestoreCrudRepository<T>`.

**Out of scope (addressed by sibling issues INT-1530..INT-1538):**
- Workers layer (INT-1530), S2S HTTP clients (INT-1531), Firestore migration immutability (INT-1532), LLM factory (INT-1533), web app (INT-1534), testing gate (INT-1535), env/IaC drift (INT-1536), shared packages leaf contract (INT-1537), observability (INT-1538).
- Public HTTP surface changes, new endpoints, new Firestore collections, Sentry DSN policy changes.

**Constraints:**
- Every `/api/**` and `/internal/**` endpoint keeps the same path + method + request/response shape.
- Each app must keep compiling and testing independently after its own phase. No cross-app Big Bang.
- `pnpm run ci:tracked` must pass after every commit (Commit Gate in CLAUDE.md).
- 100% branch coverage retained per-package; no new `v8 ignore` categories.

---

## Endpoint Changes

| Category      | Description                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modified**  | None (public surface preserved)                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Created**   | None                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Removed**   | None                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Unchanged** | All `/health`, `/openapi.json`, `/docs`, `/api/**`, `/internal/**`, `/webhooks/**` endpoints on every app. Route handlers are re-registered via shared helpers but paths, methods, schemas, and auth strategies are identical. `apps/code-agent/src/routes/code/task-routes.ts` and `apps/research-agent/src/routes/researchRoutes.ts` are split into multiple files but every registered endpoint keeps the same path and method. |

---

## File Structure

### New files (shared packages)

| Path                                                                | Responsibility                                                                                                               | Exports                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/http-server/src/createFastifyApp.ts`                      | Own Fastify logger/cors/formbody/auth/sentry/quiet-health/swagger/`/health`/`/openapi.json` wiring                           | `createFastifyApp(opts): Promise<FastifyInstance>`                                   |
| `packages/http-server/src/startFastifyService.ts`                   | Own `main()` scaffold: `validateRequiredEnv` + `initSentry` + `initServices` + `app.listen` + SIGTERM/SIGINT/SIGUSR2         | `startFastifyService(opts): Promise<void>`                                           |
| `packages/http-server/src/__tests__/createFastifyApp.test.ts`       | Branch-coverage tests for `createFastifyApp`                                                                                 | —                                                                                    |
| `packages/http-server/src/__tests__/startFastifyService.test.ts`    | Branch-coverage tests for `startFastifyService`                                                                              | —                                                                                    |
| `packages/common-core/src/loadEnv.ts`                               | Typed env reader: `loadEnv(['A','B'] as const)` returns `{A: string; B: string}`                                             | `loadEnv<K>(keys: readonly K[]): Record<K, string>`                                  |
| `packages/common-core/src/__tests__/loadEnv.test.ts`                | Tests that missing keys throw, empty strings throw, narrow typing is exercised                                               | —                                                                                    |
| `packages/common-core/src/serviceContainer.ts`                      | Generic `createServiceContainer<T>(factory)` yielding `{init, get, set, reset}`                                              | `createServiceContainer<T>(factory: (cfg: unknown) => T): ServiceContainerHandle<T>` |
| `packages/common-core/src/__tests__/serviceContainer.test.ts`       | Tests init/get/set/reset lifecycle                                                                                           | —                                                                                    |
| `packages/common-http/src/auth/internalAuthStrategies.ts`           | `authenticateInternalScheduler`, `authenticateInternalPubSub`, `InternalAuthStrategy` type                                   | 3 exports                                                                            |
| `packages/common-http/src/__tests__/internalAuthStrategies.test.ts` | Tests for scheduler/PubSub/token strategies                                                                                  | —                                                                                    |
| `packages/infra-firestore/src/crudRepository.ts`                    | `createFirestoreCrudRepository<T>({collection, toFirestore, fromFirestore})` returning `{get, list, create, update, delete}` | 1 export                                                                             |
| `packages/infra-firestore/src/__tests__/crudRepository.test.ts`     | Tests with `firestoreFake`                                                                                                   | —                                                                                    |

### Modified files (shared packages)

| Path                                    | Change                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/http-server/src/index.ts`     | Re-export `createFastifyApp`, `startFastifyService`                     |
| `packages/common-core/src/index.ts`     | Re-export `loadEnv`, `createServiceContainer`                           |
| `packages/common-http/src/index.ts`     | Re-export `authenticateInternalScheduler`, `authenticateInternalPubSub` |
| `packages/infra-firestore/src/index.ts` | Re-export `createFirestoreCrudRepository`                               |

### Modified files (apps — per-app port, 21 services)

For every service in `apps/{actions-agent, api-docs-hub, app-settings-service, bookmarks-agent, calendar-agent, chat-agent, code-agent, commands-agent, cron-agent, hellscript-agent, image-service, linear-agent, llm-usage-service, mobile-notifications-service, notes-agent, notion-service, research-agent, todos-agent, user-service, web-agent, whatsapp-service}`:

| Path                                    | Change                                                                                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/<svc>/src/index.ts`               | Replace bespoke `main()` + `as string` casts + `?? ''` with `startFastifyService({ serviceName, serviceVersion, requiredEnv, initServices, buildServer })`. Use `loadEnv(REQUIRED_ENV as const)` for typed access.                              |
| `apps/<svc>/src/server.ts`              | Delete per-service logger/cors/formbody/auth/sentry/swagger/openapi/health boilerplate; call `createFastifyApp({ serviceName, serviceVersion, openapiInfo, openapiServers, openapiTags, requiredSecrets, extraHealthChecks, registerRoutes })`. |
| `apps/<svc>/src/services.ts`            | Convert to `createServiceContainer<ServiceContainer>(initFactory)` producing `{initServices, getServices, setServices, resetServices}`. Delete ad-hoc module-level `let container = null`.                                                      |
| `apps/<svc>/src/__tests__/**/*.test.ts` | Update imports to match canonical names `initServices`/`setServices({...})`/`resetServices()`.                                                                                                                                                  |

### Service-specific files (local cleanup)

| Path                                                                      | Change                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/todos-agent/src/domain/usecases/*.ts` (13 files)                    | Remove local `interface MinimalLogger { … }` declarations; import `Logger` from `@intexuraos/common-core`.                                |
| `apps/notes-agent/src/domain/usecases/*.ts`                               | Same as todos-agent (if present).                                                                                                         |
| `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts` | Replace `type MinimalLogger = pino.Logger` with `import type { Logger } from '@intexuraos/common-core'` and use `Logger`.                 |
| `apps/calendar-agent/src/domain/useCases/**`                              | Rename directory → `apps/calendar-agent/src/domain/usecases/`.                                                                            |
| `apps/calendar-agent/src/__tests__/domain/useCases/**`                    | Rename directory → `apps/calendar-agent/src/__tests__/domain/usecases/`.                                                                  |
| `apps/cron-agent/src/domain/use-cases/**`                                 | Rename directory → `apps/cron-agent/src/domain/usecases/`.                                                                                |
| `apps/cron-agent/src/domain/use-cases/__tests__/**`                       | Rename directory → `apps/cron-agent/src/domain/usecases/__tests__/`.                                                                      |
| `apps/linear-agent/src/__tests__/domain/useCases/**`                      | Rename directory → `apps/linear-agent/src/__tests__/domain/usecases/`.                                                                    |
| `apps/code-agent/src/routes/helpers/internalAuth.ts`                      | Delete; update imports to `@intexuraos/common-http`.                                                                                      |
| `apps/commands-agent/src/routes/helpers/internalAuth.ts`                  | Delete; update imports.                                                                                                                   |
| `apps/linear-agent/src/routes/internalRoutes.ts`                          | Replace local auth helpers with `@intexuraos/common-http` imports.                                                                        |
| `apps/actions-agent/src/routes/pubsubAuth.ts`                             | Delete; update imports.                                                                                                                   |
| `apps/mobile-notifications-service/src/routes/digestRoutes.ts`            | Replace inline `process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN']` reads with `validateInternalAuth(request)` from `@intexuraos/common-http`. |
| `apps/actions-agent/src/index.ts:38-51`                                   | Delete `as string` casts; use `loadEnv` for typed access.                                                                                 |
| `apps/todos-agent/src/index.ts`                                           | Same cleanup.                                                                                                                             |
| `apps/linear-agent/src/index.ts`                                          | Same cleanup.                                                                                                                             |

### Oversized route splits

#### `apps/code-agent/src/routes/code/task-routes.ts` (3,260 LoC) → split into:

| Path                                                   | Responsibility                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/code-agent/src/routes/code/task/create.ts`       | `POST /api/code/tasks`                                                                                                       |
| `apps/code-agent/src/routes/code/task/list.ts`         | `GET /api/code/tasks`                                                                                                        |
| `apps/code-agent/src/routes/code/task/detail.ts`       | `GET /api/code/tasks/:id`, `GET /api/code/tasks/:id/events`, `GET /api/code/tasks/:id/transcript`                            |
| `apps/code-agent/src/routes/code/task/mutate.ts`       | `PATCH /api/code/tasks/:id`, `DELETE /api/code/tasks/:id`, `POST /api/code/tasks/:id/cancel`, retry/restart                  |
| `apps/code-agent/src/routes/code/task/subresources.ts` | Compliance reports, PR links, feedback, actions subcollections                                                               |
| `apps/code-agent/src/routes/code/task/index.ts`        | Aggregator plugin registering all task sub-plugins                                                                           |
| `apps/code-agent/src/routes/code/task-routes.ts`       | Delete (import path migrated to `./task/index.js`)                                                                           |
| `apps/code-agent/src/domain/usecases/*`                | Extract validation + orchestration previously inline in route handlers (names must match the route files that consume them). |

#### `apps/research-agent/src/routes/researchRoutes.ts` (1,630 LoC) → split into:

| Path                                                | Responsibility                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/research-agent/src/routes/research/create.ts` | `POST /api/research`                                                |
| `apps/research-agent/src/routes/research/list.ts`   | `GET /api/research`                                                 |
| `apps/research-agent/src/routes/research/detail.ts` | `GET /api/research/:id`, `GET /api/research/:id/events`             |
| `apps/research-agent/src/routes/research/mutate.ts` | `PATCH /api/research/:id`, `DELETE /api/research/:id`, cancel/retry |
| `apps/research-agent/src/routes/research/index.ts`  | Aggregator plugin                                                   |
| `apps/research-agent/src/routes/researchRoutes.ts`  | Delete (registration moves to aggregator)                           |

#### `apps/code-agent/src/routes/webhooks/complianceReport.ts:188-200`:

| Path                                                                | Change                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/code-agent/src/infra/firestore/complianceReportRepository.ts` | New — owns `code_tasks/{taskId}/compliance_reports` writes.                                                        |
| `apps/code-agent/src/domain/ports/complianceReportRepository.ts`    | New — port/interface.                                                                                              |
| `apps/code-agent/src/routes/webhooks/complianceReport.ts`           | Replace inline `firestore.collection('code_tasks')…` with `getServices().complianceReportRepository.save(report)`. |
| `apps/code-agent/src/services.ts`                                   | Register new repo in container.                                                                                    |

### CRUD repository consolidation

Each of `apps/{notes-agent,todos-agent,bookmarks-agent,commands-agent}/src/infra/firestore/firestore*Repository.ts` keeps its file path but is reimplemented to delegate to `createFirestoreCrudRepository<T>`. External imports unchanged.

---

## Task Decomposition

Phases are **strictly sequential**: later phases depend on helpers landed by earlier phases. Inside a phase, individual steps commit after each TDD cycle. Every phase ends with `pnpm run ci:tracked`.

> **Executor note:** Each numbered task below is one commit (or a small group — test, impl, commit). Do not batch commits across tasks. After the last task in a phase, run `pnpm run ci:tracked` from the repo root; no merging until green.

---

## Phase 1 — Shared primitives

### Task 1.1: `loadEnv` typed env reader

**Files:**
- Create: `packages/common-core/src/loadEnv.ts`
- Test: `packages/common-core/src/__tests__/loadEnv.test.ts`
- Modify: `packages/common-core/src/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/common-core/src/__tests__/loadEnv.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../loadEnv.js';

describe('loadEnv', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('returns typed record when all keys are present and non-empty', () => {
    process.env['A_URL'] = 'https://a';
    process.env['B_TOKEN'] = 'tok';
    const result = loadEnv(['A_URL', 'B_TOKEN'] as const);
    expect(result).toEqual({ A_URL: 'https://a', B_TOKEN: 'tok' });
    // Compile-time: result.A_URL is string, not string | undefined
    const a: string = result.A_URL;
    expect(a).toBe('https://a');
  });

  it('throws when a key is missing', () => {
    delete process.env['MISSING'];
    expect(() => loadEnv(['MISSING'] as const)).toThrow(/Missing required environment variables: MISSING/);
  });

  it('throws when a key is empty string', () => {
    process.env['EMPTY'] = '';
    expect(() => loadEnv(['EMPTY'] as const)).toThrow(/Missing required environment variables: EMPTY/);
  });

  it('lists all missing keys in the thrown error', () => {
    delete process.env['A'];
    process.env['B'] = '';
    expect(() => loadEnv(['A', 'B'] as const)).toThrow(/A, B/);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intexuraos/common-core test -- loadEnv`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/common-core/src/loadEnv.ts
/**
 * Typed environment variable loader. Call AFTER validateRequiredEnv so
 * type-narrowing is sound.
 */
export function loadEnv<K extends string>(keys: readonly K[]): Record<K, string> {
  const missing: string[] = [];
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = process.env[key];
    if (value === undefined || value === '') {
      missing.push(key);
      continue;
    }
    result[key] = value;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
  return result;
}
```

- [ ] **Step 4: Re-export**

Edit `packages/common-core/src/index.ts`:

```ts
export { loadEnv } from './loadEnv.js';
```

- [ ] **Step 5: Verify test passes**

Run: `pnpm --filter @intexuraos/common-core test -- loadEnv`
Expected: PASS, 100% branch coverage on `loadEnv.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/common-core/src/loadEnv.ts packages/common-core/src/__tests__/loadEnv.test.ts packages/common-core/src/index.ts
git commit -m "feat(common-core): add typed loadEnv helper (INT-1529)"
```

### Task 1.2: `createServiceContainer<T>` generic DI factory

**Files:**
- Create: `packages/common-core/src/serviceContainer.ts`
- Test: `packages/common-core/src/__tests__/serviceContainer.test.ts`
- Modify: `packages/common-core/src/index.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createServiceContainer } from '../serviceContainer.js';

interface Deps { foo: string; bar: number }

describe('createServiceContainer', () => {
  it('throws from get() before init', () => {
    const h = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    expect(() => h.get()).toThrow(/not initialized/);
  });

  it('init() then get() returns container', () => {
    const h = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    h.init();
    expect(h.get()).toEqual({ foo: 'a', bar: 1 });
  });

  it('set() merges partial override', () => {
    const h = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    h.init();
    h.set({ foo: 'b' });
    expect(h.get()).toEqual({ foo: 'b', bar: 1 });
  });

  it('reset() clears the container', () => {
    const h = createServiceContainer<Deps>(() => ({ foo: 'a', bar: 1 }));
    h.init();
    h.reset();
    expect(() => h.get()).toThrow(/not initialized/);
  });

  it('passes config to factory', () => {
    interface Cfg { n: number }
    const h = createServiceContainer<Deps, Cfg>((cfg) => ({ foo: 'a', bar: cfg.n }));
    h.init({ n: 42 });
    expect(h.get().bar).toBe(42);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intexuraos/common-core test -- serviceContainer`

- [ ] **Step 3: Implement**

```ts
// packages/common-core/src/serviceContainer.ts
export interface ServiceContainerHandle<T, C = void> {
  init: (config?: C) => void;
  get: () => T;
  set: (override: Partial<T>) => void;
  reset: () => void;
}

export function createServiceContainer<T, C = void>(
  factory: (config: C) => T
): ServiceContainerHandle<T, C> {
  let container: T | null = null;
  return {
    init: (config?: C) => {
      container = factory((config ?? undefined) as C);
    },
    get: () => {
      if (container === null) {
        throw new Error('Service container not initialized. Call init() first.');
      }
      return container;
    },
    set: (override) => {
      if (container === null) {
        throw new Error('Service container not initialized. Call init() first.');
      }
      container = { ...container, ...override };
    },
    reset: () => {
      container = null;
    },
  };
}
```

- [ ] **Step 4: Re-export**

Edit `packages/common-core/src/index.ts`:

```ts
export { createServiceContainer, type ServiceContainerHandle } from './serviceContainer.js';
```

- [ ] **Step 5: Verify test passes**

Run: `pnpm --filter @intexuraos/common-core test -- serviceContainer`
Expected: PASS, 100% branch coverage.

- [ ] **Step 6: Commit**

```bash
git add packages/common-core/src/serviceContainer.ts packages/common-core/src/__tests__/serviceContainer.test.ts packages/common-core/src/index.ts
git commit -m "feat(common-core): add generic createServiceContainer factory (INT-1529)"
```

### Task 1.3: Internal-auth strategies in `@intexuraos/common-http`

**Files:**
- Create: `packages/common-http/src/auth/internalAuthStrategies.ts`
- Test: `packages/common-http/src/__tests__/internalAuthStrategies.test.ts`
- Modify: `packages/common-http/src/index.ts`

- [ ] **Step 1: Failing test**

Copy the existing tests from `apps/commands-agent/src/__tests__/routes/helpers/internalAuth.test.ts` and `apps/code-agent/src/__tests__/routes/helpers/internalAuth.test.ts` as source material; test both strategies against a `FastifyRequest` fake:

```ts
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  authenticateInternalScheduler,
  authenticateInternalPubSub,
} from '../auth/internalAuthStrategies.js';

function req(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('authenticateInternalScheduler', () => {
  it('accepts Bearer OIDC token (scheduler-oidc)', () => {
    const r = authenticateInternalScheduler(req({ authorization: 'Bearer abc' }));
    expect(r).toEqual({ authenticated: true, strategy: 'scheduler-oidc' });
  });
  it('falls back to internal-token via x-internal-auth', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalScheduler(req({ 'x-internal-auth': 'secret' }));
    expect(r).toEqual({ authenticated: true, strategy: 'internal-token' });
  });
  it('rejects when neither is valid', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalScheduler(req({}));
    expect(r).toEqual({ authenticated: false });
  });
});

describe('authenticateInternalPubSub', () => {
  it('accepts Pub/Sub push (from=noreply@google.com)', () => {
    const r = authenticateInternalPubSub(req({ from: 'noreply@google.com' }));
    expect(r).toEqual({ authenticated: true, strategy: 'pubsub-oidc' });
  });
  it('falls back to internal-token', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalPubSub(req({ 'x-internal-auth': 'secret' }));
    expect(r).toEqual({ authenticated: true, strategy: 'internal-token' });
  });
  it('rejects when neither is valid', () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'secret';
    const r = authenticateInternalPubSub(req({}));
    expect(r).toEqual({ authenticated: false });
  });
});
```

- [ ] **Step 2: Implement**

Port the logic verbatim from `apps/commands-agent/src/routes/helpers/internalAuth.ts`:

```ts
// packages/common-http/src/auth/internalAuthStrategies.ts
import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from './internalAuth.js';

export type InternalAuthStrategy = 'pubsub-oidc' | 'scheduler-oidc' | 'internal-token';

export type AuthResult =
  | { authenticated: true; strategy: InternalAuthStrategy }
  | { authenticated: false };

export function authenticateInternalScheduler(request: FastifyRequest): AuthResult {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return { authenticated: true, strategy: 'scheduler-oidc' };
  }
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) return { authenticated: false };
  return { authenticated: true, strategy: 'internal-token' };
}

export function authenticateInternalPubSub(request: FastifyRequest): AuthResult {
  const fromHeader = request.headers.from;
  if (typeof fromHeader === 'string' && fromHeader === 'noreply@google.com') {
    return { authenticated: true, strategy: 'pubsub-oidc' };
  }
  const authResult = validateInternalAuth(request);
  if (!authResult.valid) return { authenticated: false };
  return { authenticated: true, strategy: 'internal-token' };
}
```

- [ ] **Step 3: Re-export**

Edit `packages/common-http/src/index.ts`:

```ts
export {
  authenticateInternalScheduler,
  authenticateInternalPubSub,
  type InternalAuthStrategy,
  type AuthResult,
} from './auth/internalAuthStrategies.js';
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @intexuraos/common-http test -- internalAuthStrategies`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/common-http/src/auth/internalAuthStrategies.ts packages/common-http/src/__tests__/internalAuthStrategies.test.ts packages/common-http/src/index.ts
git commit -m "feat(common-http): add shared internal auth strategies (INT-1529)"
```

### Task 1.4: `createFirestoreCrudRepository<T>` generic repository

**Files:**
- Create: `packages/infra-firestore/src/crudRepository.ts`
- Test: `packages/infra-firestore/src/__tests__/crudRepository.test.ts`
- Modify: `packages/infra-firestore/src/index.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FakeFirestore } from '../testing/firestoreFake.js';
import { createFirestoreCrudRepository } from '../crudRepository.js';

interface Note { id: string; title: string; body: string; createdAt: string }

describe('createFirestoreCrudRepository', () => {
  const fake = new FakeFirestore();
  const repo = createFirestoreCrudRepository<Note>({
    firestore: fake,
    collection: 'notes',
    toFirestore: (n) => ({ title: n.title, body: n.body, createdAt: n.createdAt }),
    fromFirestore: (id, data) => ({
      id,
      title: String(data['title']),
      body: String(data['body']),
      createdAt: String(data['createdAt']),
    }),
  });

  it('creates and reads back', async () => {
    await repo.create({ id: 'n1', title: 't', body: 'b', createdAt: '2026-04-24' });
    const got = await repo.get('n1');
    expect(got).toEqual({ id: 'n1', title: 't', body: 'b', createdAt: '2026-04-24' });
  });

  it('returns null for missing id', async () => {
    expect(await repo.get('missing')).toBeNull();
  });

  it('updates existing doc', async () => {
    await repo.create({ id: 'n2', title: 't', body: 'b', createdAt: '2026-04-24' });
    await repo.update('n2', { body: 'b2' });
    const got = await repo.get('n2');
    expect(got?.body).toBe('b2');
  });

  it('lists all', async () => {
    const all = await repo.list();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('deletes', async () => {
    await repo.create({ id: 'n3', title: 't', body: 'b', createdAt: '2026-04-24' });
    await repo.delete('n3');
    expect(await repo.get('n3')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/infra-firestore/src/crudRepository.ts
import type { Firestore } from '@google-cloud/firestore';

export interface CrudRepositoryOptions<T> {
  firestore: Firestore;
  collection: string;
  toFirestore: (entity: T) => Record<string, unknown>;
  fromFirestore: (id: string, data: Record<string, unknown>) => T;
}

export interface CrudRepository<T extends { id: string }> {
  get: (id: string) => Promise<T | null>;
  list: () => Promise<T[]>;
  create: (entity: T) => Promise<void>;
  update: (id: string, patch: Partial<T>) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

export function createFirestoreCrudRepository<T extends { id: string }>(
  opts: CrudRepositoryOptions<T>
): CrudRepository<T> {
  const { firestore, collection, toFirestore, fromFirestore } = opts;
  return {
    get: async (id) => {
      const snap = await firestore.collection(collection).doc(id).get();
      if (!snap.exists) return null;
      return fromFirestore(id, snap.data() ?? {});
    },
    list: async () => {
      const snap = await firestore.collection(collection).get();
      return snap.docs.map((d) => fromFirestore(d.id, d.data() ?? {}));
    },
    create: async (entity) => {
      await firestore.collection(collection).doc(entity.id).set(toFirestore(entity));
    },
    update: async (id, patch) => {
      await firestore.collection(collection).doc(id).set(patch, { merge: true });
    },
    delete: async (id) => {
      await firestore.collection(collection).doc(id).delete();
    },
  };
}
```

- [ ] **Step 3: Re-export**

```ts
// packages/infra-firestore/src/index.ts
export {
  createFirestoreCrudRepository,
  type CrudRepository,
  type CrudRepositoryOptions,
} from './crudRepository.js';
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @intexuraos/infra-firestore test -- crudRepository`
Expected: PASS, 100% branch coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-firestore/src/crudRepository.ts packages/infra-firestore/src/__tests__/crudRepository.test.ts packages/infra-firestore/src/index.ts
git commit -m "feat(infra-firestore): add generic createFirestoreCrudRepository (INT-1529)"
```

### Task 1.5: `createFastifyApp` shared bootstrap

**Files:**
- Create: `packages/http-server/src/createFastifyApp.ts`
- Test: `packages/http-server/src/__tests__/createFastifyApp.test.ts`
- Modify: `packages/http-server/src/index.ts`

- [ ] **Step 1: Failing test**

Test that the returned app:
- Registers `fastifyCors`, `fastifyFormbody`, `intexuraFastifyPlugin`, `fastifyAuthPlugin`, `registerQuietHealthCheckLogging`, Sentry error handler, `registerCoreSchemas`, `fastifySwagger`, `fastifySwaggerUi` at `/docs`, the `/openapi.json` route, and the `/health` route.
- Invokes the consumer-provided `registerRoutes(app)` callback.
- Uses `buildHealthResponse(serviceName, serviceVersion, [checkSecrets(requiredSecrets), ...extraHealthChecks])` on `/health`.
- Returns HTTP 200 + JSON health payload on `/health` (use `app.inject`).

```ts
import { describe, it, expect } from 'vitest';
import { createFastifyApp } from '../createFastifyApp.js';

describe('createFastifyApp', () => {
  it('serves /health with serviceName and version', async () => {
    const app = await createFastifyApp({
      serviceName: 'test-svc',
      serviceVersion: '1.2.3',
      openapiInfo: { title: 'test', description: 'test', version: '1.2.3' },
      openapiServers: [{ url: 'http://local', description: 'Local' }],
      openapiTags: [{ name: 'system', description: 'sys' }],
      requiredSecrets: [],
      extraHealthChecks: [],
      registerRoutes: async () => {},
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.serviceName).toBe('test-svc');
    expect(body.version).toBe('1.2.3');
    await app.close();
  });

  it('serves /openapi.json', async () => {
    const app = await createFastifyApp({ /* same as above */ });
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    await app.close();
  });

  it('invokes registerRoutes callback with the app', async () => {
    let registered = false;
    const app = await createFastifyApp({ /* … */ registerRoutes: async (a) => { registered = true; a.get('/custom', async () => ({ ok: true })); } });
    expect(registered).toBe(true);
    const res = await app.inject({ method: 'GET', url: '/custom' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/http-server/src/createFastifyApp.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  fastifyAuthPlugin,
  intexuraFastifyPlugin,
  registerQuietHealthCheckLogging,
} from '@intexuraos/common-http';
import { registerCoreSchemas } from '@intexuraos/http-contracts';
import { createLogStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
import {
  buildHealthResponse,
  checkSecrets,
  type HealthCheck,
} from './health.js';

export interface CreateFastifyAppOptions {
  serviceName: string;
  serviceVersion: string;
  openapiInfo: { title: string; description: string; version: string };
  openapiServers: { url: string; description: string }[];
  openapiTags: { name: string; description: string }[];
  requiredSecrets: string[];
  extraHealthChecks: (() => Promise<HealthCheck> | HealthCheck)[];
  registerRoutes: (app: FastifyInstance) => Promise<void>;
  additionalOpenapiSchemas?: Record<string, unknown>;
}

export async function createFastifyApp(opts: CreateFastifyAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env['NODE_ENV'] === 'test'
        ? false
        : { level: process.env['LOG_LEVEL'] ?? 'info', stream: createLogStream() },
    disableRequestLogging: true,
  });

  registerQuietHealthCheckLogging(app);
  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  });
  await app.register(fastifyFormbody);
  await app.register(intexuraFastifyPlugin);
  await app.register(fastifyAuthPlugin);
  setupSentryErrorHandler(app as unknown as FastifyInstance);
  registerCoreSchemas(app);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.1',
      info: opts.openapiInfo,
      servers: opts.openapiServers,
      tags: opts.openapiTags,
      components: { schemas: opts.additionalOpenapiSchemas ?? {} },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await opts.registerRoutes(app);

  app.get('/openapi.json', { schema: { tags: ['system'], hide: true } }, async (_req, reply) => {
    return await reply.type('application/json').send(app.swagger());
  });

  app.get('/health', { schema: { tags: ['system'], operationId: 'getHealth' } }, async (_req, reply) => {
    const checks: HealthCheck[] = [checkSecrets(opts.requiredSecrets)];
    for (const check of opts.extraHealthChecks) {
      checks.push(await Promise.resolve(check()));
    }
    return await reply
      .type('application/json')
      .send(buildHealthResponse(opts.serviceName, opts.serviceVersion, checks));
  });

  return app;
}
```

- [ ] **Step 3: Re-export**

```ts
// packages/http-server/src/index.ts
export { createFastifyApp, type CreateFastifyAppOptions } from './createFastifyApp.js';
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @intexuraos/http-server test -- createFastifyApp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/http-server/src/createFastifyApp.ts packages/http-server/src/__tests__/createFastifyApp.test.ts packages/http-server/src/index.ts
git commit -m "feat(http-server): add createFastifyApp shared bootstrap (INT-1529)"
```

### Task 1.6: `startFastifyService` shared `main()` scaffold

**Files:**
- Create: `packages/http-server/src/startFastifyService.ts`
- Test: `packages/http-server/src/__tests__/startFastifyService.test.ts`
- Modify: `packages/http-server/src/index.ts`

- [ ] **Step 1: Failing test**

Test:
- Calls `validateRequiredEnv` with provided `requiredEnv` before starting.
- Calls `initSentry` with serviceName + optional DSN.
- Calls `initServices()` user-supplied hook.
- Calls `buildServer()` user-supplied hook.
- Registers SIGTERM + SIGINT handlers that close the app with timeout.
- Exits with code 1 when `buildServer` rejects.

```ts
import { describe, it, expect, vi } from 'vitest';
import { startFastifyService } from '../startFastifyService.js';

describe('startFastifyService', () => {
  it('validates env before listening', async () => {
    delete process.env['REQ_ENV_VAR'];
    await expect(
      startFastifyService({
        serviceName: 'x', requiredEnv: ['REQ_ENV_VAR'],
        initServices: () => {}, buildServer: async () => ({} as never),
      })
    ).rejects.toThrow(/Missing required environment variables: REQ_ENV_VAR/);
  });

  it('initializes services then builds server then listens', async () => {
    process.env['REQ_ENV_VAR'] = 'x';
    const order: string[] = [];
    const app = {
      listen: vi.fn(async () => { order.push('listen'); }),
      close: vi.fn(async () => {}),
    };
    await startFastifyService({
      serviceName: 'x', requiredEnv: ['REQ_ENV_VAR'],
      initServices: () => { order.push('initServices'); },
      buildServer: async () => { order.push('buildServer'); return app as never; },
      port: 0, host: '127.0.0.1',
    });
    expect(order).toEqual(['initServices', 'buildServer', 'listen']);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/http-server/src/startFastifyService.ts
import type { FastifyInstance } from 'fastify';
import { initSentry } from '@intexuraos/infra-sentry';
import { getErrorMessage } from '@intexuraos/common-core';
import { validateRequiredEnv } from './health.js';

export interface StartFastifyServiceOptions {
  serviceName: string;
  requiredEnv: string[];
  initServices: () => void | Promise<void>;
  buildServer: () => Promise<FastifyInstance>;
  port?: number;
  host?: string;
}

export async function startFastifyService(opts: StartFastifyServiceOptions): Promise<void> {
  validateRequiredEnv(opts.requiredEnv);

  const sentryDsn = process.env['INTEXURAOS_SENTRY_DSN'];
  initSentry({
    ...(sentryDsn !== undefined && sentryDsn !== '' ? { dsn: sentryDsn } : {}),
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
    serviceName: opts.serviceName,
  });

  await opts.initServices();
  const app = await opts.buildServer();

  const port = opts.port ?? Number(process.env['PORT'] ?? 8080);
  const host = opts.host ?? process.env['HOST'] ?? '0.0.0.0';

  const close = (): void => {
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  try {
    await app.listen({ port, host });
  } catch (error: unknown) {
    process.stderr.write(`Failed to start ${opts.serviceName}: ${getErrorMessage(error, String(error))}\n`);
    throw error;
  }
}
```

- [ ] **Step 3: Re-export**

```ts
export { startFastifyService, type StartFastifyServiceOptions } from './startFastifyService.js';
```

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @intexuraos/http-server test -- startFastifyService
git add packages/http-server/src/startFastifyService.ts packages/http-server/src/__tests__/startFastifyService.test.ts packages/http-server/src/index.ts
git commit -m "feat(http-server): add startFastifyService lifecycle scaffold (INT-1529)"
```

### Task 1.7: Build and CI gate

- [ ] Run `pnpm build` at repo root and verify `packages/{common-core,common-http,http-server,infra-firestore}/dist/` updated.
- [ ] Run `pnpm run ci:tracked` from repo root.
- [ ] Expected: all workspace tests + lint + typecheck pass; no coverage regressions.
- [ ] Commit any needed tsconfig or package.json export updates under a single commit: `chore(packages): export new helpers from package barrels (INT-1529)`.

---

## Phase 2 — Port `user-service` (pilot)

`user-service` is the pilot because it has the largest `server.ts` boilerplate, a straightforward service container, and is covered by route + services tests. If this port cannot be done cleanly, the shared helpers need a revision before touching other services.

### Task 2.1: Port `user-service/src/services.ts`

**Files:**
- Modify: `apps/user-service/src/services.ts`
- Modify: `apps/user-service/src/__tests__/**/*.test.ts` (only if they import the old names)

- [ ] **Step 1: Update tests first (red)**

Change any test that imports `initializeServices`/`setServices(full)` to use `initServices`/`setServices(partial)`:

```ts
import { initServices, setServices, resetServices } from '../../services.js';

beforeEach(() => {
  initServices();
  setServices({ authTokenRepository: fakeRepo });
});
afterEach(() => { resetServices(); });
```

- [ ] **Step 2: Rewrite `services.ts` using `createServiceContainer`**

```ts
// apps/user-service/src/services.ts
import { createServiceContainer, type Logger } from '@intexuraos/common-core';
import { createAppLogger } from '@intexuraos/infra-sentry';
// (keep existing adapter imports unchanged)

export interface ServiceContainer { /* unchanged */ }

function buildContainer(): ServiceContainer {
  const logger: Logger = createAppLogger({ name: 'user-service' });
  // …existing logic from initializeServices body…
  return { authTokenRepository: new FirestoreAuthTokenRepository(), /* … */ };
}

const handle = createServiceContainer<ServiceContainer>(buildContainer);
export const initServices = handle.init;
export const getServices = handle.get;
export const setServices = handle.set;
export const resetServices = handle.reset;
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter user-service test` → all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/user-service/src/services.ts apps/user-service/src/__tests__
git commit -m "refactor(user-service): adopt createServiceContainer (INT-1529)"
```

### Task 2.2: Port `user-service/src/server.ts` onto `createFastifyApp`

**Files:**
- Modify: `apps/user-service/src/server.ts`

- [ ] **Step 1: Update tests that assert on HTTP surface**

Sanity-check the existing `__tests__/server.test.ts` (if present). No assertions should need changing — endpoints are identical.

- [ ] **Step 2: Rewrite `server.ts`**

```ts
// apps/user-service/src/server.ts
import type { FastifyInstance } from 'fastify';
import { createFastifyApp, checkFirestore } from '@intexuraos/http-server';
import { authRoutes } from './routes/routes.js';

const SERVICE_NAME = 'user-service';
const SERVICE_VERSION = '0.0.4';

const REQUIRED_SECRETS = [
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
];

export async function buildServer(): Promise<FastifyInstance> {
  return createFastifyApp({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    openapiInfo: {
      title: SERVICE_NAME,
      description: 'IntexuraOS Authentication Service - Device Authorization Flow helpers',
      version: SERVICE_VERSION,
    },
    openapiServers: [
      { url: 'https://intexuraos-user-service-cj44trunra-lm.a.run.app', description: 'Cloud (Development)' },
      { url: 'http://localhost:8110', description: 'Local' },
    ],
    openapiTags: [
      { name: 'system', description: 'System endpoints (health, docs)' },
      { name: 'auth', description: 'Device Authorization Flow helpers' },
    ],
    requiredSecrets: REQUIRED_SECRETS,
    extraHealthChecks: [checkFirestore],
    registerRoutes: async (app) => { await app.register(authRoutes); },
  });
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter user-service test && pnpm --filter user-service verify`
Expected: PASS, coverage ≥ previous levels.

- [ ] **Step 4: Commit**

```bash
git add apps/user-service/src/server.ts
git commit -m "refactor(user-service): adopt createFastifyApp (INT-1529)"
```

### Task 2.3: Port `user-service/src/index.ts` onto `startFastifyService`

**Files:**
- Modify: `apps/user-service/src/index.ts`

- [ ] **Step 1: Rewrite**

```ts
// apps/user-service/src/index.ts
import { startFastifyService } from '@intexuraos/http-server';
import { loadEnv } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { initServices } from './services.js';

const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH0_DOMAIN',
  'INTEXURAOS_AUTH0_CLIENT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  'INTEXURAOS_ENCRYPTION_KEY',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_WEB_APP_URL',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID',
  'INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_ID',
  'INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET',
] as const;

// loadEnv is called for type-safe access elsewhere if needed; presence is enforced here.
void loadEnv(REQUIRED_ENV);

await startFastifyService({
  serviceName: 'user-service',
  requiredEnv: [...REQUIRED_ENV],
  initServices,
  buildServer,
});
```

- [ ] **Step 2: Verify**

Run: `pnpm run verify:workspace:tracked -- user-service`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/user-service/src/index.ts
git commit -m "refactor(user-service): adopt startFastifyService + loadEnv (INT-1529)"
```

### Task 2.4: Phase-2 acceptance gate

- [ ] Run `pnpm run ci:tracked`. Must be fully green.
- [ ] Manual sanity: `/health`, `/openapi.json`, `/docs` and at least one `authRoutes` endpoint respond under `pm2 start user-service` dev shell.
- [ ] If anything is red: STOP, fix the shared helpers, do not migrate further apps.

---

## Phase 3 — Port the remaining 20 apps

Every service is ported using the **same 3-step pattern** from Phase 2 (services → server → index), each in its own commit. The order below is chosen to batch "easy" services first (no internal-auth or Pub/Sub) and leave `code-agent` + `research-agent` until Phase 5 (after their route files are split).

### Services ordered by complexity

**3.A — No internal-auth coupling (one commit per service per step = 3 commits each):**

1. `app-settings-service`
2. `bookmarks-agent`
3. `chat-agent`
4. `image-service`
5. `llm-usage-service`
6. `notes-agent`
7. `notion-service`
8. `todos-agent`
9. `web-agent`
10. `whatsapp-service`
11. `api-docs-hub` (note: currently lacks `services.ts`; only server + index get migrated)

**3.B — With internal-auth / Pub/Sub (must be done after Task 4.1 lands the shared helpers):**

12. `calendar-agent`
13. `cron-agent`
14. `linear-agent`
15. `commands-agent`
16. `actions-agent`
17. `mobile-notifications-service`
18. `hellscript-agent`

### Task 3.X.1 (for each service): port `services.ts`

- [ ] Mirror Task 2.1: rewrite using `createServiceContainer`; update only the tests that break on import names.
- [ ] Verify: `pnpm --filter <svc> test`.
- [ ] Commit: `refactor(<svc>): adopt createServiceContainer (INT-1529)`.

### Task 3.X.2: port `server.ts`

- [ ] Mirror Task 2.2: replace entire bespoke bootstrap with `createFastifyApp({…})`. Preserve exactly the current REQUIRED_SECRETS, openapiTags, openapiServers, extraHealthChecks.
- [ ] Verify: `pnpm --filter <svc> verify`.
- [ ] Commit: `refactor(<svc>): adopt createFastifyApp (INT-1529)`.

### Task 3.X.3: port `index.ts`

- [ ] Mirror Task 2.3: replace bespoke `main()` with `startFastifyService`; remove `as string` casts and `?? ''` fallbacks by using `loadEnv`.
- [ ] Verify: `pnpm run verify:workspace:tracked -- <svc>`.
- [ ] Commit: `refactor(<svc>): adopt startFastifyService + loadEnv (INT-1529)`.

### Task 3.Y (intermediate gate, every 4 services)

- [ ] After every 4 services migrated, run `pnpm run ci:tracked` at repo root.
- [ ] If CI fails, STOP and fix before continuing.

---

## Phase 4 — Cross-cutting cleanup

### Task 4.1: Remove all `MinimalLogger` declarations

**Files (confirmed via grep):**
- `apps/todos-agent/src/domain/usecases/*.ts` (13 files)
- `apps/calendar-agent/src/infra/gemini/calendarActionExtractionService.ts`
- Any other matches from `grep -rn "MinimalLogger" apps/` at plan-execution time (re-run; the list may include notes-agent if new code has been added).

- [ ] **Step 1: Replace each declaration**

For every file:
```ts
// Remove:
// interface MinimalLogger { info(…); error(…); warn(…); debug(…) }
// Replace with:
import type { Logger } from '@intexuraos/common-core';
```

Update the `Deps` type: `logger: Logger`.

- [ ] **Step 2: Verify**

Run `grep -rn "MinimalLogger" apps/` → must return zero matches.
Run: `pnpm run ci:tracked`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps
git commit -m "refactor(apps): replace local MinimalLogger with common-core Logger (INT-1529)"
```

### Task 4.2: Canonicalize `usecases/` directory names

**Files:**
- `apps/calendar-agent/src/domain/useCases/` → `apps/calendar-agent/src/domain/usecases/`
- `apps/calendar-agent/src/__tests__/domain/useCases/` → `apps/calendar-agent/src/__tests__/domain/usecases/`
- `apps/cron-agent/src/domain/use-cases/` → `apps/cron-agent/src/domain/usecases/`
- `apps/cron-agent/src/domain/use-cases/__tests__/` → `apps/cron-agent/src/domain/usecases/__tests__/`
- `apps/linear-agent/src/__tests__/domain/useCases/` → `apps/linear-agent/src/__tests__/domain/usecases/`

- [ ] **Step 1: Rename via git**

```bash
git mv apps/calendar-agent/src/domain/useCases apps/calendar-agent/src/domain/usecases
git mv apps/calendar-agent/src/__tests__/domain/useCases apps/calendar-agent/src/__tests__/domain/usecases
git mv apps/cron-agent/src/domain/use-cases apps/cron-agent/src/domain/usecases
git mv apps/linear-agent/src/__tests__/domain/useCases apps/linear-agent/src/__tests__/domain/usecases
```

- [ ] **Step 2: Update all imports**

Run:
```bash
grep -rln "domain/useCases\|domain/use-cases" apps/ packages/ | xargs sed -i 's#domain/useCases#domain/usecases#g; s#domain/use-cases#domain/usecases#g'
grep -rln "__tests__/domain/useCases" apps/ | xargs sed -i 's#__tests__/domain/useCases#__tests__/domain/usecases#g'
```

Review `git diff` to confirm no over-matching.

- [ ] **Step 3: Verify**

```bash
grep -rn "use-cases\|useCases" apps/ packages/ | grep -v node_modules | grep -v dist
```
Expected: zero application-code matches (documentation hits are ok).

Run: `pnpm run ci:tracked`.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(apps): canonicalize domain/usecases directory name (INT-1529)"
```

### Task 4.3: Migrate internal-auth helpers to `@intexuraos/common-http`

**Files to delete:**
- `apps/code-agent/src/routes/helpers/internalAuth.ts`
- `apps/commands-agent/src/routes/helpers/internalAuth.ts`
- `apps/actions-agent/src/routes/pubsubAuth.ts`

**Files to update (replace imports):**
- `apps/linear-agent/src/routes/internalRoutes.ts`
- `apps/code-agent/src/routes/{internalRoutes.ts, internal/cleanup-routes.ts, code/queue-routes.ts, code/task-routes.ts, merge-queue/mergeQueueTickRoute.ts}`
- `apps/code-agent/src/__tests__/routes/internalRoutes.test.ts`
- `apps/commands-agent/src/routes/internalRoutes.ts`
- `apps/actions-agent/src/routes/internalRoutes.ts`
- `apps/mobile-notifications-service/src/routes/digestRoutes.ts`

- [ ] **Step 1: Update consumers**

Replace all local imports with:
```ts
import {
  authenticateInternalScheduler,
  authenticateInternalPubSub,
  validateInternalAuth,
} from '@intexuraos/common-http';
```

- [ ] **Step 2: Fix `mobile-notifications-service/digestRoutes.ts`**

Replace three occurrences of:
```ts
const token = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
```
with:
```ts
const authResult = validateInternalAuth(request);
if (!authResult.valid) return reply.fail({ code: 'UNAUTHORIZED', message: 'invalid internal auth' }, 401);
```

- [ ] **Step 3: Delete the local helpers**

```bash
git rm apps/code-agent/src/routes/helpers/internalAuth.ts
git rm apps/commands-agent/src/routes/helpers/internalAuth.ts
git rm apps/actions-agent/src/routes/pubsubAuth.ts
git rm apps/code-agent/src/__tests__/routes/helpers/internalAuth.test.ts 2>/dev/null || true
git rm apps/commands-agent/src/__tests__/routes/helpers/internalAuth.test.ts 2>/dev/null || true
```

- [ ] **Step 4: Verify**

Run: `pnpm run ci:tracked`.
Expected: PASS (tests now exercise the shared helper via route-level tests; the unit tests moved to `packages/common-http`).

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(apps): consolidate internal auth helpers in common-http (INT-1529)"
```

### Task 4.4: Replace `reply.status(n).send({ error })` / `reply.code(n).send({ error })` with `reply.fail(...)`

- [ ] **Step 1: Audit**

Run:
```bash
grep -rn "reply\s*\.\s*code\s*(\s*[0-9][0-9][0-9]\s*)\s*\.\s*send\s*(\s*{\s*error" apps/
grep -rn "\.status(\s*[0-9][0-9][0-9]\s*)\s*\.\s*send\s*(\s*{\s*error" apps/
```

- [ ] **Step 2: Replace each match**

For each match, use the pattern:
```ts
// Before:
reply.code(401).send({ error: 'unauthorized' });
// After:
return reply.fail({ code: 'UNAUTHORIZED', message: 'unauthorized' }, 401);
```

- [ ] **Step 3: Verify**

Re-run the greps → zero matches. Run `pnpm run ci:tracked`.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(apps): standardize error replies on reply.fail (INT-1529)"
```

---

## Phase 5 — Route file splits

### Task 5.1: Split `apps/code-agent/src/routes/code/task-routes.ts` (3,260 LoC)

**Files:**
- Create: `apps/code-agent/src/routes/code/task/{create,list,detail,mutate,subresources,index}.ts`
- Delete: `apps/code-agent/src/routes/code/task-routes.ts`
- Update: `apps/code-agent/src/routes/routes.ts` (or wherever it is registered) to import from `./code/task/index.js`.
- Test: `apps/code-agent/src/__tests__/routes/code/task-routes.test.ts` — split into per-resource test files or keep as-is if it only exercises the public surface.

- [ ] **Step 1: Inventory**

Read `apps/code-agent/src/routes/code/task-routes.ts`; build a map `method + path → line range`. Categorize each endpoint into one of: `create`, `list`, `detail`, `mutate`, `subresources`.

- [ ] **Step 2: Create the aggregator**

```ts
// apps/code-agent/src/routes/code/task/index.ts
import type { FastifyPluginAsync } from 'fastify';
import { createTaskRoutes } from './create.js';
import { listTaskRoutes } from './list.js';
import { detailTaskRoutes } from './detail.js';
import { mutateTaskRoutes } from './mutate.js';
import { subresourceTaskRoutes } from './subresources.js';

export const taskRoutes: FastifyPluginAsync = async (app) => {
  await app.register(createTaskRoutes);
  await app.register(listTaskRoutes);
  await app.register(detailTaskRoutes);
  await app.register(mutateTaskRoutes);
  await app.register(subresourceTaskRoutes);
};
```

- [ ] **Step 3: Extract each resource**

For each resource file (`create.ts`, `list.ts`, `detail.ts`, `mutate.ts`, `subresources.ts`):
1. Move the matching endpoint blocks verbatim (identical schema, preHandler, handler bodies) from `task-routes.ts`.
2. Export a `FastifyPluginAsync` named `<resource>TaskRoutes`.
3. Keep shared helpers used by multiple resources in a new sibling `apps/code-agent/src/routes/code/task/shared.ts` (imported by siblings only).

- [ ] **Step 4: Extract domain orchestration to use-cases**

Where a handler does more than "validate → repo call → map", lift the logic into a new file in `apps/code-agent/src/domain/usecases/<name>.ts` and keep the handler as: `parse body → call use-case → reply.ok(...)`.

- [ ] **Step 5: Delete the original**

```bash
git rm apps/code-agent/src/routes/code/task-routes.ts
```

- [ ] **Step 6: Update registration**

In whatever file currently imports `task-routes.ts`, replace with `./code/task/index.js`.

- [ ] **Step 7: Verify endpoints unchanged**

Run: `pnpm --filter code-agent test`.
Compare openapi output before/after: `pnpm --filter code-agent build && diff <(prev openapi.json) <(new openapi.json)` → must be identical at paths + methods level.

- [ ] **Step 8: Commit**

One commit per resource file extracted (5 commits total):
```
refactor(code-agent): extract task create route (INT-1529)
refactor(code-agent): extract task list route (INT-1529)
refactor(code-agent): extract task detail routes (INT-1529)
refactor(code-agent): extract task mutation routes (INT-1529)
refactor(code-agent): extract task subresource routes; delete task-routes.ts (INT-1529)
```

### Task 5.2: Split `apps/research-agent/src/routes/researchRoutes.ts` (1,630 LoC)

Mirror Task 5.1 but with:
- Target files: `apps/research-agent/src/routes/research/{create,list,detail,mutate,index}.ts`
- Delete: `apps/research-agent/src/routes/researchRoutes.ts`
- Use-case extraction to `apps/research-agent/src/domain/research/usecases/*.ts`.

- [ ] **Step 1-8:** same as 5.1.
- [ ] One commit per resource file (4 commits total).

### Task 5.3: Move direct Firestore access in `complianceReport.ts` into a repository

**Files:**
- Create: `apps/code-agent/src/domain/ports/complianceReportRepository.ts`
- Create: `apps/code-agent/src/infra/firestore/complianceReportRepository.ts`
- Modify: `apps/code-agent/src/routes/webhooks/complianceReport.ts:185-205`
- Modify: `apps/code-agent/src/services.ts` — add new repo.
- Test: `apps/code-agent/src/infra/firestore/__tests__/complianceReportRepository.test.ts`

- [ ] **Step 1: Define the port**

```ts
// apps/code-agent/src/domain/ports/complianceReportRepository.ts
export interface StoredComplianceReport {
  taskId: string;
  prNumber: number;
  report: Record<string, unknown>;
  model: string;
  createdAt: string;
}

export interface ComplianceReportRepository {
  save: (report: StoredComplianceReport) => Promise<void>;
}
```

- [ ] **Step 2: Test the adapter with `FakeFirestore`**

```ts
import { describe, it, expect } from 'vitest';
import { FakeFirestore } from '@intexuraos/infra-firestore/testing';
import { FirestoreComplianceReportRepository } from '../complianceReportRepository.js';

describe('FirestoreComplianceReportRepository', () => {
  it('writes to code_tasks/{taskId}/compliance_reports', async () => {
    const fake = new FakeFirestore();
    const repo = new FirestoreComplianceReportRepository(fake);
    await repo.save({ taskId: 't1', prNumber: 1, report: { ok: true }, model: 'claude', createdAt: '2026-04-24' });
    const snap = await fake.collection('code_tasks').doc('t1').collection('compliance_reports').get();
    expect(snap.docs.length).toBe(1);
  });
});
```

- [ ] **Step 3: Implement**

```ts
// apps/code-agent/src/infra/firestore/complianceReportRepository.ts
import type { Firestore } from '@google-cloud/firestore';
import type { ComplianceReportRepository, StoredComplianceReport } from '../../domain/ports/complianceReportRepository.js';

export class FirestoreComplianceReportRepository implements ComplianceReportRepository {
  constructor(private readonly firestore: Firestore) {}
  async save(report: StoredComplianceReport): Promise<void> {
    await this.firestore
      .collection('code_tasks')
      .doc(report.taskId)
      .collection('compliance_reports')
      .add(report);
  }
}
```

- [ ] **Step 4: Wire into services**

Add `complianceReportRepository: new FirestoreComplianceReportRepository(getFirestore())` to the service-container factory and extend `ServiceContainer`.

- [ ] **Step 5: Update route handler**

`apps/code-agent/src/routes/webhooks/complianceReport.ts`:
```ts
const { complianceReportRepository, logger } = getServices();
await complianceReportRepository.save({ taskId, prNumber, report, model, createdAt: new Date().toISOString() });
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter code-agent test
git add apps/code-agent
git commit -m "refactor(code-agent): extract compliance report Firestore access into repository (INT-1529)"
```

---

## Phase 6 — CRUD repository consolidation

### Task 6.1 — 6.4: Migrate each CRUD repo

For each of:
- `apps/notes-agent/src/infra/firestore/firestoreNoteRepository.ts`
- `apps/todos-agent/src/infra/firestore/firestoreTodoRepository.ts`
- `apps/bookmarks-agent/src/infra/firestore/firestoreBookmarkRepository.ts`
- `apps/commands-agent/src/infra/firestore/firestoreCommandRepository.ts`

- [ ] **Step 1:** Keep the file and the class name. Keep the public method signatures on the class (since tests and callers import them).
- [ ] **Step 2:** Inside the class, delegate to `createFirestoreCrudRepository<T>`. Example:

```ts
// apps/notes-agent/src/infra/firestore/firestoreNoteRepository.ts
import { createFirestoreCrudRepository } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Note } from '../../domain/models/note.js';
import type { NoteRepository } from '../../domain/ports/noteRepository.js';

export class FirestoreNoteRepository implements NoteRepository {
  private readonly crud = createFirestoreCrudRepository<Note>({
    firestore: this.firestore,
    collection: 'notes',
    toFirestore: (n) => ({ title: n.title, body: n.body, /* … */ }),
    fromFirestore: (id, d) => ({ id, title: String(d['title']), body: String(d['body']) /* … */ }),
  });
  constructor(private readonly firestore: Firestore) {}
  get = this.crud.get;
  list = this.crud.list;
  create = this.crud.create;
  update = this.crud.update;
  delete = this.crud.delete;
  // …domain-specific methods stay in this class…
}
```

- [ ] **Step 3:** Run the existing adapter tests (the ones in `__tests__/firestore*Repository.test.ts`) — zero behavior change, all must PASS without modification.
- [ ] **Step 4:** One commit per service: `refactor(<svc>): delegate CRUD repo to createFirestoreCrudRepository (INT-1529)`.

---

## Phase 7 — Final verification

- [ ] Run `pnpm run ci:tracked` from repo root.
- [ ] Confirm LoC reduction with:
```bash
wc -l apps/*/src/server.ts | tail -1
wc -l apps/code-agent/src/routes/code/task-routes.ts 2>/dev/null || echo "deleted OK"
wc -l apps/research-agent/src/routes/researchRoutes.ts 2>/dev/null || echo "deleted OK"
```
- [ ] Diff the generated OpenAPI for every service and confirm no endpoint changes:
```bash
for svc in apps/*; do
  [ -d "$svc" ] || continue
  pnpm --filter "$(basename "$svc")" run build >/dev/null 2>&1 || true
done
```
- [ ] Cross-package `pnpm build` at repo root succeeds.
- [ ] Grep sweeps all return zero matches:
```bash
grep -rn "MinimalLogger" apps/
grep -rn "use-cases\|useCases" apps/ | grep -v dist | grep -v node_modules
grep -rn "initializeServices\b" apps/
grep -rn "reply\s*\.\s*code\s*(\s*[0-9][0-9][0-9]\s*)\s*\.\s*send\s*(\s*{\s*error" apps/
grep -rn "as string" apps/*/src/index.ts
grep -rn "?? ''" apps/*/src/index.ts
```
- [ ] PR description lists all 21 services migrated plus shared-package changes.

---

## Acceptance Criteria

1. `pnpm run ci:tracked` passes at repo root after every phase.
2. `wc -l apps/*/src/server.ts | tail -1` shows ≤ 1,500 total (down from 4,568).
3. Every `apps/*/src/server.ts` calls `createFastifyApp` as its primary action.
4. Every `apps/*/src/index.ts` calls `startFastifyService` and uses `loadEnv` for typed env access; zero `as string` or `?? ''` fallbacks after `validateRequiredEnv`.
5. Every `apps/*/src/services.ts` exports `initServices`, `getServices`, `setServices(Partial<T>)`, `resetServices` via `createServiceContainer`.
6. All apps use `Logger` from `@intexuraos/common-core`; zero `MinimalLogger` matches in `apps/`.
7. All apps use `apps/*/src/domain/usecases/` (lowercase, plural); zero `useCases` or `use-cases` directory matches.
8. Internal-auth helpers live only in `packages/common-http/src/auth/internalAuthStrategies.ts`; zero per-service duplicates.
9. `apps/code-agent/src/routes/code/task-routes.ts` and `apps/research-agent/src/routes/researchRoutes.ts` deleted; split into per-resource files each ≤ 600 LoC.
10. `apps/code-agent/src/routes/webhooks/complianceReport.ts` does not call `firestore.collection(…)` directly; uses `complianceReportRepository`.
11. All four CRUD repos (notes, todos, bookmarks, commands) delegate to `createFirestoreCrudRepository<T>`; external interfaces unchanged.
12. OpenAPI spec for every service is unchanged at the paths + methods level (diffable script in Phase 7 verification).

---

## Test Plan

- **Shared packages:** new unit tests for `loadEnv`, `createServiceContainer`, `internalAuthStrategies`, `createFirestoreCrudRepository`, `createFastifyApp`, `startFastifyService` in their respective `__tests__` folders. 100% branch coverage (per CLAUDE.md rule).
- **Per-app:** existing test suites run unmodified. Where imports change (`initializeServices` → `initServices`, local `MinimalLogger` → shared `Logger`), update the import line only; no assertion changes should be necessary.
- **Code-agent & research-agent:** route-level tests (`__tests__/routes/**/*.test.ts`) must continue to pass without modification — the route paths and handler behavior are preserved.
- **Mobile-notifications:** `digestRoutes.test.ts` must be updated to inject `INTEXURAOS_INTERNAL_AUTH_TOKEN` via `setEnvVar` helper rather than testing the inline `?? ''` behavior.
- **Coverage:** no new `v8 ignore` categories; the shared helpers must be exercised via real `app.inject()` tests.

---

## Risk & Rollback

- **Risk:** shared `createFastifyApp` misses an app-specific register step (e.g., a bespoke plugin order). **Mitigation:** Phase 2 is a single-service pilot that must pass `ci:tracked` before Phase 3 fans out.
- **Risk:** OpenAPI schema drift breaks contracts. **Mitigation:** Phase 7 diffs OpenAPI per service.
- **Risk:** Pub/Sub PushHandler auth regressions. **Mitigation:** Task 1.3 ports the logic verbatim and tests both strategies; Task 4.3 leaves Pub/Sub push auth identical.
- **Rollback:** every phase is a commit set; revert the latest phase with `git revert` — shared helpers remain usable because new symbols are additive until Phase 3 starts consuming them.

---

## Decision Log

*No Linear comments influenced this plan — the issue description was complete.*
