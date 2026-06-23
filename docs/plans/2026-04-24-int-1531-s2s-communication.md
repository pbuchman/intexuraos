# INT-1531 — Service-to-Service Communication Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Linear:** [INT-1531](https://linear.app/pbuchman/issue/INT-1531)
**Parent epic:** [INT-1473](https://linear.app/pbuchman/issue/INT-1473)
**Evidence source:** `docs/reviews/2026-04-24-refactoring-analysis.md` §3

**Goal:** Unify all inter-service HTTP calls onto a single `createInternalHttpClient` primitive with correct trace propagation, response-envelope handling, hardened auth (real OIDC + dual-token rotation), typed `/internal/*` contracts, and generated env-var wiring — enforced by CI so drift cannot return silently.

**Architecture:** Extract one shared thin-facade HTTP client in `@intexuraos/internal-clients/shared` that encapsulates `fetch + X-Internal-Auth + X-Request-Id + Content-Type + AbortController timeout + envelope unwrap + structured errors`, then migrate all app-level wrappers to compose it. Replace the permissive Bearer-prefix check with real Google OIDC verification via `jose`. Add dual-token (`CURRENT` + `PREVIOUS`) in `validateInternalAuth` for zero-downtime rotation. Promote `@intexuraos/http-contracts` to export Zod schemas + inferred TS types (JSON Schemas are derived, not hand-written). Introduce `apps/web/service-manifest.json` as the single source of truth consumed by Terraform, `cloudbuild.yaml`, `apps/web/src/config.ts`, and `ecosystem.config.cjs` via a generator.

**Tech Stack:** TypeScript (strict), Fastify, Node `fetch`, `jose` (Google OIDC), `zod`, `zod-to-json-schema`, Vitest, `nock`, `validateRequiredEnv`, Terraform, GCP Cloud Run, Secret Manager, Pub/Sub.

---

## Endpoint Changes

**Modified:** (auth behavior only — no route path / payload changes)
- `apps/code-agent/src/routes/helpers/internalAuth.ts::authenticateInternalScheduler` — replace Bearer-prefix check with `verifyGoogleOidcToken({ audience })`.
- `apps/commands-agent/src/routes/helpers/internalAuth.ts::authenticateInternalScheduler` — same replacement as above.
- `packages/common-http/src/auth/internalAuth.ts::validateInternalAuth` — accept `INTEXURAOS_INTERNAL_AUTH_TOKEN` **and** optional `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` for rotation window.

**Created:** (new shared primitives; no new business endpoints)
- `packages/internal-clients/src/shared/createInternalHttpClient.ts` — factory.
- `packages/internal-clients/src/shared/envelope.ts` — response-envelope guard + unwrap.
- `packages/internal-clients/src/shared/oidcVerifier.ts` — Google OIDC verifier.
- `packages/http-contracts/src/zod/*.ts` — one file per internal resource group; exports Zod schemas + TS types.
- `apps/web/service-manifest.json` — single-source list of Cloud Run services & env-var names.
- `scripts/verify-no-raw-fetch.mjs` — CI gate: fails on raw `fetch(` under `apps/*/src/infra/`.
- `scripts/verify-envelope.mjs` — CI gate: every `/internal/*` route returns `{success, data?, error?}`.
- `scripts/generate-service-wiring.mjs` — regenerates env wiring from `service-manifest.json`.

**Removed:** (after all consumers migrated)
- Per-app hand-rolled HTTP clients in `apps/*/src/infra/http/*HttpClient.ts` (10 files).
- Duplicated `ApiResponse` / `PreviewApiResponse` type literals embedded in each client.

**Unchanged:** All `/internal/*` route paths, all `/internal/*` request/response payloads, all Pub/Sub topic names, all Cloud Run service URLs.

---

## File Structure (target state)

```
packages/
  internal-clients/
    src/
      shared/
        createInternalHttpClient.ts   # the single factory (thin facade)
        envelope.ts                   # { success, data, error } guard + unwrap
        errors.ts                     # ServiceClientError taxonomy (existing, extend)
        oidcVerifier.ts               # Google OIDC verifier via `jose`
        traceContext.ts               # getCurrentRequestId() AsyncLocalStorage accessor
        index.ts                      # re-exports
      usage-service/                  # unchanged (already uses shared)
      user-service/                   # unchanged (already uses shared)
      code-agent/                     # NEW, consumer of shared
      commands-agent/                 # NEW
      linear-agent/                   # NEW
      calendar-service/               # NEW
      notes-agent/                    # NEW
      retired-checklist-service/                    # NEW
      bookmarks-agent/                # NEW
      github-pr/                      # NEW (moved from apps/code-agent/src/infra/http/github-pr/)
  http-contracts/
    src/
      zod/
        usageService.ts               # Zod schemas + TS types
        userService.ts
        calendarService.ts
        notesAgent.ts
        retiredChecklistService.ts
        bookmarksAgent.ts
        linearAgent.ts
        codeAgent.ts
        commandsAgent.ts
        index.ts                      # re-exports
      fastify-schemas.ts              # now GENERATED from zod via zod-to-json-schema
      openapi-schemas.ts              # now GENERATED from zod
  common-http/
    src/
      auth/
        internalAuth.ts               # dual-token support
      http/
        requestId.ts                  # add setCurrentRequestId/getCurrentRequestId ALS accessors
apps/
  <each-app>/
    src/
      infra/http/*HttpClient.ts       # thin wrappers that import internal-clients/<service>
  web/
    service-manifest.json             # single source of truth
scripts/
  verify-no-raw-fetch.mjs
  verify-envelope.mjs
  generate-service-wiring.mjs
docs/
  runbooks/
    internal-auth-rotation.md         # quarterly rotation procedure
  architecture/
    internal-oidc-phase-two.md        # design doc for SA-OIDC migration
```

**Why this decomposition:**
- Per **Execution Memory mem_1f7d0a83** ("Thin Facade Pattern for Large HTTP Clients"), the shared fetch utility lives in `internal-clients/shared`, and every service client is a thin facade that composes it. Per-service modules keep independent evolution of endpoint signatures without duplicating `fetch + auth + timeout + envelope + trace` boilerplate.
- `http-contracts` becomes the single source of truth for request/response shapes; Fastify/OpenAPI JSON schemas are derived, not authored.
- `common-http` stays transport-primitive (auth, request-id, logging plugin) — no domain types leak into it.

---

## Phases

The plan is divided into **five phases** that MUST land in order. Phases 1–3 introduce primitives; Phase 4 migrates every consumer; Phase 5 enforces the new rules via CI and seals the regression surface.

- Phase 1 — Primitives: shared HTTP client, envelope, trace context, dual-token, OIDC verifier, Zod contracts.
- Phase 2 — Per-service client modules in `@intexuraos/internal-clients`.
- Phase 3 — Service-manifest generator for env wiring.
- Phase 4 — Consumer migration (one commit per consumer app; `apps/*/src/infra/http/*HttpClient.ts` shrinks to a thin re-export of the package client).
- Phase 5 — CI enforcement + deletion of dead code + runbooks.

Each task is TDD-first: write failing test → verify red → implement → verify green → commit.

---

## Task 1: Introduce trace context helpers (AsyncLocalStorage)

**Rationale:** `X-Request-Id` is generated on ingress but never threaded to outbound calls. AsyncLocalStorage lets the shared HTTP client read the active request id without every caller passing it explicitly.

**Files:**
- Create: `packages/common-http/src/http/traceContext.ts`
- Create: `packages/common-http/src/__tests__/traceContext.test.ts`
- Modify: `packages/common-http/src/http/requestId.ts` (export `runWithRequestId`, `getCurrentRequestId`)
- Modify: `packages/common-http/src/http/fastifyPlugin.ts` (wrap request lifecycle in `runWithRequestId`)
- Modify: `packages/common-http/src/index.ts` (re-export new helpers)

- [ ] **Step 1: Write the failing test**

```ts
// packages/common-http/src/__tests__/traceContext.test.ts
import { describe, it, expect } from 'vitest';
import { runWithRequestId, getCurrentRequestId } from '../http/traceContext.js';

describe('traceContext', () => {
  it('returns undefined outside a scope', () => {
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it('returns the active request id inside runWithRequestId', async () => {
    const captured: (string | undefined)[] = [];
    await runWithRequestId('req-abc', async () => {
      captured.push(getCurrentRequestId());
      await Promise.resolve();
      captured.push(getCurrentRequestId());
    });
    expect(captured).toEqual(['req-abc', 'req-abc']);
  });

  it('isolates concurrent scopes', async () => {
    const results: string[] = [];
    await Promise.all([
      runWithRequestId('a', async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push(getCurrentRequestId() ?? '?');
      }),
      runWithRequestId('b', async () => {
        results.push(getCurrentRequestId() ?? '?');
      }),
    ]);
    expect(results.sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/common-http test -- traceContext`
Expected: FAIL — `runWithRequestId is not a function`.

- [ ] **Step 3: Implement `traceContext.ts`**

```ts
// packages/common-http/src/http/traceContext.ts
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run({ requestId }, fn);
}

export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
```

- [ ] **Step 4: Wire into `fastifyPlugin`**

In `packages/common-http/src/http/fastifyPlugin.ts`, wrap the `onRequest` hook body in `runWithRequestId(getRequestId(request.headers), async () => { ... })` so every downstream `await` inside a route handler can read `getCurrentRequestId()`.

- [ ] **Step 5: Re-export from `common-http/src/index.ts`**

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/common-http test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/common-http/src/http/traceContext.ts \
        packages/common-http/src/http/fastifyPlugin.ts \
        packages/common-http/src/__tests__/traceContext.test.ts \
        packages/common-http/src/index.ts
git commit -m "feat(common-http): add AsyncLocalStorage request-id trace context (INT-1531)"
```

---

## Task 2: Dual-token support in `validateInternalAuth`

**Rationale:** Today, rotating `INTEXURAOS_INTERNAL_AUTH_TOKEN` requires synchronized redeploy of ~23 services. Accepting `TOKEN` AND `TOKEN_PREVIOUS` for a rotation window enables zero-downtime rotation.

**Files:**
- Modify: `packages/common-http/src/auth/internalAuth.ts`
- Create: `packages/common-http/src/__tests__/internalAuth.dualToken.test.ts`
- Modify: `packages/common-http/src/__tests__/internalAuth.test.ts` (extend if present)
- Create: `docs/runbooks/internal-auth-rotation.md`

- [ ] **Step 1: Write the failing test**

```ts
// packages/common-http/src/__tests__/internalAuth.dualToken.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateInternalAuth } from '../auth/internalAuth.js';

function makeRequest(headerValue: string | undefined) {
  return {
    headers: headerValue === undefined ? {} : { 'x-internal-auth': headerValue },
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
  } as never;
}

describe('validateInternalAuth dual-token', () => {
  const origCurrent = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  const origPrev = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'];

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'current-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = 'old-secret';
  });
  afterEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = origCurrent ?? '';
    if (origPrev === undefined) delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'];
    else process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS'] = origPrev;
  });

  it('accepts the CURRENT token', () => {
    expect(validateInternalAuth(makeRequest('current-secret'))).toEqual({ valid: true });
  });

  it('accepts the PREVIOUS token during rotation window', () => {
    expect(validateInternalAuth(makeRequest('old-secret'))).toEqual({ valid: true, tokenUsed: 'previous' });
  });

  it('rejects anything that is neither CURRENT nor PREVIOUS', () => {
    expect(validateInternalAuth(makeRequest('wrong'))).toEqual({ valid: false, reason: 'token_mismatch' });
  });

  it('rejects when CURRENT is not configured even if PREVIOUS matches', () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    expect(validateInternalAuth(makeRequest('old-secret'))).toEqual({ valid: false, reason: 'not_configured' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/common-http test -- internalAuth.dualToken`
Expected: FAIL — PREVIOUS token rejected.

- [ ] **Step 3: Implement dual-token support**

```ts
// packages/common-http/src/auth/internalAuth.ts
import type { FastifyRequest } from 'fastify';

const ENV_CURRENT = 'INTEXURAOS_INTERNAL_AUTH_TOKEN';
const ENV_PREVIOUS = 'INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS';
const HEADER = 'x-internal-auth';

export interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
  tokenUsed?: 'current' | 'previous';
}

export function validateInternalAuth(request: FastifyRequest): InternalAuthResult {
  const current = process.env[ENV_CURRENT] ?? '';
  if (current === '') {
    request.log.warn(`Internal auth failed: ${ENV_CURRENT} not configured`);
    return { valid: false, reason: 'not_configured' };
  }
  const provided = request.headers[HEADER];
  if (provided === current) {
    return { valid: true, tokenUsed: 'current' };
  }
  const previous = process.env[ENV_PREVIOUS] ?? '';
  if (previous !== '' && provided === previous) {
    request.log.warn('Internal auth: PREVIOUS token accepted (rotation window active)');
    return { valid: true, tokenUsed: 'previous' };
  }
  request.log.warn('Internal auth failed: token mismatch');
  return { valid: false, reason: 'token_mismatch' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/common-http test`
Expected: PASS (including existing single-token tests).

- [ ] **Step 5: Write the rotation runbook**

Create `docs/runbooks/internal-auth-rotation.md` documenting:
1. Generate new 32-byte random token.
2. Set `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` = old token in Secret Manager for every service.
3. Set `INTEXURAOS_INTERNAL_AUTH_TOKEN` = new token in Secret Manager for every service.
4. Deploy ALL services (any order; both tokens accepted).
5. Wait 24h / observe `Internal auth: PREVIOUS token accepted` log volume → 0.
6. Remove `INTEXURAOS_INTERNAL_AUTH_TOKEN_PREVIOUS` from Secret Manager; redeploy.
7. Quarterly cadence tracked in a recurring Linear issue.

- [ ] **Step 6: Commit**

```bash
git add packages/common-http/src/auth/internalAuth.ts \
        packages/common-http/src/__tests__/internalAuth.dualToken.test.ts \
        docs/runbooks/internal-auth-rotation.md
git commit -m "feat(common-http): dual-token support for internal-auth rotation (INT-1531)"
```

---

## Task 3: Google OIDC verifier (`jose`)

**Rationale:** `authenticateInternalScheduler` in code-agent/commands-agent accepts any `Authorization: Bearer xxx`. This is a real authentication bypass in any future ingress configuration. Replace with verified OIDC tokens whose `iss=https://accounts.google.com`, `aud=<service-url>`, and `email_verified=true`.

**Files:**
- Add dependency: `pnpm --filter @intexuraos/internal-clients add jose`
- Create: `packages/internal-clients/src/shared/oidcVerifier.ts`
- Create: `packages/internal-clients/src/shared/__tests__/oidcVerifier.test.ts`
- Modify: `packages/internal-clients/src/shared/index.ts`

- [ ] **Step 1: Add `jose` to `packages/internal-clients/package.json` dependencies**

- [ ] **Step 2: Write the failing test**

```ts
// packages/internal-clients/src/shared/__tests__/oidcVerifier.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGoogleOidcVerifier } from '../oidcVerifier.js';

const verify = vi.hoisted(() => vi.fn());
vi.mock('jose', () => ({
  createRemoteJWKSet: () => vi.fn(),
  jwtVerify: verify,
}));

describe('createGoogleOidcVerifier', () => {
  beforeEach(() => verify.mockReset());

  it('rejects missing Bearer header', async () => {
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await expect(v('')).resolves.toEqual({ valid: false, reason: 'missing_bearer' });
  });

  it('rejects when audience does not match', async () => {
    verify.mockResolvedValue({ payload: { aud: 'https://other', iss: 'https://accounts.google.com', email_verified: true } });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await expect(v('Bearer tkn')).resolves.toEqual({ valid: false, reason: 'audience_mismatch' });
  });

  it('rejects when issuer is not Google', async () => {
    verify.mockResolvedValue({ payload: { aud: 'https://svc', iss: 'https://evil', email_verified: true } });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await expect(v('Bearer tkn')).resolves.toEqual({ valid: false, reason: 'issuer_mismatch' });
  });

  it('accepts a verified Google token with matching audience', async () => {
    verify.mockResolvedValue({ payload: { aud: 'https://svc', iss: 'https://accounts.google.com', email_verified: true, email: 'sa@proj.iam.gserviceaccount.com' } });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await expect(v('Bearer tkn')).resolves.toEqual({ valid: true, subject: 'sa@proj.iam.gserviceaccount.com' });
  });

  it('rejects when jose throws', async () => {
    verify.mockRejectedValue(new Error('bad sig'));
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await expect(v('Bearer tkn')).resolves.toEqual({ valid: false, reason: 'verification_failed' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @intexuraos/internal-clients test -- oidcVerifier`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `oidcVerifier.ts`**

```ts
// packages/internal-clients/src/shared/oidcVerifier.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleOidcResult {
  valid: boolean;
  reason?: 'missing_bearer' | 'audience_mismatch' | 'issuer_mismatch' | 'verification_failed';
  subject?: string;
}

export interface GoogleOidcVerifierConfig {
  audience: string;
  jwksUrl?: string; // defaults to Google's
}

const DEFAULT_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = 'https://accounts.google.com';

export function createGoogleOidcVerifier(config: GoogleOidcVerifierConfig) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl ?? DEFAULT_JWKS));
  return async function verify(authHeader: string | undefined): Promise<GoogleOidcResult> {
    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      return { valid: false, reason: 'missing_bearer' };
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const { payload } = await jwtVerify(token, jwks);
      if (payload.aud !== config.audience) return { valid: false, reason: 'audience_mismatch' };
      if (payload.iss !== GOOGLE_ISS) return { valid: false, reason: 'issuer_mismatch' };
      return { valid: true, subject: String(payload.email ?? payload.sub ?? '') };
    } catch {
      return { valid: false, reason: 'verification_failed' };
    }
  };
}
```

- [ ] **Step 5: Re-export from `packages/internal-clients/src/shared/index.ts`**

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @intexuraos/internal-clients test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/internal-clients/src/shared/oidcVerifier.ts \
        packages/internal-clients/src/shared/__tests__/oidcVerifier.test.ts \
        packages/internal-clients/src/shared/index.ts \
        packages/internal-clients/package.json \
        pnpm-lock.yaml
git commit -m "feat(internal-clients): Google OIDC verifier via jose (INT-1531)"
```

---

## Task 4: Wire OIDC verifier into code-agent / commands-agent scheduler auth

**Files:**
- Modify: `apps/code-agent/src/routes/helpers/internalAuth.ts`
- Modify: `apps/commands-agent/src/routes/helpers/internalAuth.ts`
- Modify: test fixtures for these files
- Modify: `apps/code-agent/src/index.ts` `REQUIRED_ENV` (add `INTEXURAOS_CODE_AGENT_SERVICE_URL` if missing)
- Modify: `apps/commands-agent/src/index.ts` `REQUIRED_ENV`
- Modify: `terraform/environments/dev/main.tf` (pass service's own URL as env var)
- Modify: `ecosystem.config.cjs` (same env var for dev)

- [ ] **Step 1: Write a failing test in `code-agent`**

```ts
// apps/code-agent/src/routes/helpers/__tests__/internalAuth.oidc.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
vi.mock('@intexuraos/internal-clients', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, createGoogleOidcVerifier: () => verify };
});

import { authenticateInternalScheduler } from '../internalAuth.js';

function makeRequest(auth?: string, internal?: string) {
  const headers: Record<string, string> = {};
  if (auth) headers['authorization'] = auth;
  if (internal) headers['x-internal-auth'] = internal;
  return { headers, log: { warn: () => {}, info: () => {} } } as never;
}

describe('authenticateInternalScheduler (OIDC)', () => {
  beforeEach(() => {
    verify.mockReset();
    process.env['INTEXURAOS_CODE_AGENT_SERVICE_URL'] = 'https://code-agent.example';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'shared-secret';
  });

  it('accepts a verified Google OIDC bearer', async () => {
    verify.mockResolvedValue({ valid: true, subject: 'sa@proj.iam' });
    const res = await authenticateInternalScheduler(makeRequest('Bearer good'));
    expect(res).toEqual({ authenticated: true, strategy: 'scheduler-oidc', subject: 'sa@proj.iam' });
  });

  it('rejects an unverifiable bearer', async () => {
    verify.mockResolvedValue({ valid: false, reason: 'verification_failed' });
    const res = await authenticateInternalScheduler(makeRequest('Bearer bad'));
    expect(res).toEqual({ authenticated: false });
  });

  it('falls through to x-internal-auth when no bearer', async () => {
    const res = await authenticateInternalScheduler(makeRequest(undefined, 'shared-secret'));
    expect(res).toMatchObject({ authenticated: true, strategy: 'internal-token' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

```ts
// apps/code-agent/src/routes/helpers/internalAuth.ts
import type { FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';
import { createGoogleOidcVerifier } from '@intexuraos/internal-clients';

export type InternalAuthStrategy = 'scheduler-oidc' | 'internal-token';

// Module-level verifier; audience is this service's Cloud Run URL.
const verifier = createGoogleOidcVerifier({
  audience: process.env['INTEXURAOS_CODE_AGENT_SERVICE_URL'] ?? '',
});

export async function authenticateInternalScheduler(
  request: FastifyRequest
): Promise<
  | { authenticated: true; strategy: InternalAuthStrategy; subject?: string }
  | { authenticated: false }
> {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const result = await verifier(authHeader);
    if (result.valid) {
      return { authenticated: true, strategy: 'scheduler-oidc', subject: result.subject };
    }
    request.log.warn({ reason: result.reason }, 'Scheduler OIDC verification failed');
    return { authenticated: false };
  }
  const res = validateInternalAuth(request);
  return res.valid ? { authenticated: true, strategy: 'internal-token' } : { authenticated: false };
}
```

Mirror change in `apps/commands-agent/src/routes/helpers/internalAuth.ts` substituting `INTEXURAOS_COMMANDS_AGENT_SERVICE_URL`.

- [ ] **Step 4: Thread `async` through call-sites**

Search with Grep for `authenticateInternalScheduler(` under each app's routes. Each call-site moves from `const res = authenticateInternalScheduler(request);` to `const res = await authenticateInternalScheduler(request);`. Update return types.

- [ ] **Step 5: Wire env vars**

Add `INTEXURAOS_CODE_AGENT_SERVICE_URL` to:
- `apps/code-agent/src/index.ts` `REQUIRED_ENV`
- `terraform/environments/dev/main.tf` (pass `google_cloud_run_v2_service.code_agent.uri`)
- `ecosystem.config.cjs` (dev stub `http://localhost:<port>`)

Repeat for commands-agent.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter code-agent test && pnpm --filter commands-agent test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(code-agent,commands-agent): real Google OIDC verification on scheduler auth (INT-1531)"
```

---

## Task 5: Shared envelope guard

**Rationale:** Every consumer re-declares the `{success, data, error}` shape inline (Calendar client: lines 25–42). A single guard + unwrap belongs in `internal-clients/shared`.

**Files:**
- Create: `packages/internal-clients/src/shared/envelope.ts`
- Create: `packages/internal-clients/src/shared/__tests__/envelope.test.ts`
- Modify: `packages/internal-clients/src/shared/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/internal-clients/src/shared/__tests__/envelope.test.ts
import { describe, it, expect } from 'vitest';
import { unwrapEnvelope } from '../envelope.js';

describe('unwrapEnvelope', () => {
  it('ok path: returns data', () => {
    expect(unwrapEnvelope({ success: true, data: { x: 1 } })).toEqual({ ok: true, value: { x: 1 } });
  });
  it('error path: returns error code + message', () => {
    expect(unwrapEnvelope({ success: false, error: { code: 'X', message: 'm' } })).toEqual({
      ok: false, error: { code: 'ENVELOPE_ERROR', message: 'X: m' },
    });
  });
  it('malformed: returns MALFORMED_ENVELOPE', () => {
    expect(unwrapEnvelope({ foo: 'bar' })).toEqual({
      ok: false, error: { code: 'MALFORMED_ENVELOPE', message: 'Response does not match {success, data?, error?} contract' },
    });
  });
  it('success=true but no data: returns MALFORMED_ENVELOPE', () => {
    expect(unwrapEnvelope({ success: true })).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

```ts
// packages/internal-clients/src/shared/envelope.ts
export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export type EnvelopeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE'; message: string } };

export function unwrapEnvelope<T>(body: unknown): EnvelopeResult<T> {
  if (body === null || typeof body !== 'object' || !('success' in body)) {
    return { ok: false, error: { code: 'MALFORMED_ENVELOPE', message: 'Response does not match {success, data?, error?} contract' } };
  }
  const env = body as Envelope<T>;
  if (env.success === true) {
    if (!('data' in env)) {
      return { ok: false, error: { code: 'MALFORMED_ENVELOPE', message: 'success=true but no `data`' } };
    }
    return { ok: true, value: env.data as T };
  }
  const msg = env.error ? `${env.error.code}: ${env.error.message}` : 'unknown';
  return { ok: false, error: { code: 'ENVELOPE_ERROR', message: msg } };
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(internal-clients): envelope unwrap helper (INT-1531)"
```

---

## Task 6: `createInternalHttpClient` — the single thin facade

**Rationale:** Implements Execution Memory mem_1f7d0a83 (Thin Facade Pattern) — one `fetchWithAuth`-style primitive handling AbortController timeout, `X-Internal-Auth`, `X-Request-Id` propagation (via `getCurrentRequestId`), Content-Type, JSON parse, envelope unwrap, and structured error mapping.

**Files:**
- Create: `packages/internal-clients/src/shared/createInternalHttpClient.ts`
- Create: `packages/internal-clients/src/shared/__tests__/createInternalHttpClient.test.ts`
- Modify: `packages/internal-clients/src/shared/index.ts`
- Add dev dependency: `pnpm --filter @intexuraos/internal-clients add -D nock`

- [ ] **Step 1: Write the failing test**

```ts
// packages/internal-clients/src/shared/__tests__/createInternalHttpClient.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { createInternalHttpClient } from '../createInternalHttpClient.js';
import { runWithRequestId } from '@intexuraos/common-http';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => nock.cleanAll());
afterEach(() => nock.cleanAll());

describe('createInternalHttpClient', () => {
  it('sends X-Internal-Auth and unwraps envelope on 200', async () => {
    nock('https://svc')
      .post('/internal/foo', { q: 1 })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('content-type', /application\/json/)
      .reply(200, { success: true, data: { y: 2 } });

    const c = createInternalHttpClient({ baseUrl: 'https://svc', token: 'secret', logger });
    const res = await c.request<{ y: number }>({ method: 'POST', path: '/internal/foo', body: { q: 1 } });
    expect(res).toEqual({ ok: true, value: { y: 2 } });
  });

  it('propagates X-Request-Id from AsyncLocalStorage', async () => {
    const scope = nock('https://svc')
      .get('/internal/bar')
      .matchHeader('x-request-id', 'req-xyz')
      .reply(200, { success: true, data: null });

    const c = createInternalHttpClient({ baseUrl: 'https://svc', token: 'secret', logger });
    await runWithRequestId('req-xyz', () => c.request({ method: 'GET', path: '/internal/bar' }));
    expect(scope.isDone()).toBe(true);
  });

  it('uses explicit requestId if provided (overrides ALS)', async () => {
    const scope = nock('https://svc').get('/x').matchHeader('x-request-id', 'override').reply(200, { success: true, data: null });
    const c = createInternalHttpClient({ baseUrl: 'https://svc', token: 'secret', logger });
    await runWithRequestId('als-id', () => c.request({ method: 'GET', path: '/x', requestId: 'override' }));
    expect(scope.isDone()).toBe(true);
  });

  it('maps non-2xx to API_ERROR', async () => {
    nock('https://svc').get('/e').reply(500, 'boom');
    const c = createInternalHttpClient({ baseUrl: 'https://svc', token: 't', logger });
    const res = await c.request({ method: 'GET', path: '/e' });
    expect(res).toEqual({ ok: false, error: { code: 'API_ERROR', message: 'HTTP 500' } });
  });

  it('maps AbortError to TIMEOUT after defaultTimeoutMs', async () => {
    nock('https://svc').get('/slow').delay(150).reply(200, { success: true, data: null });
    const c = createInternalHttpClient({ baseUrl: 'https://svc', token: 't', logger, defaultTimeoutMs: 50 });
    const res = await c.request({ method: 'GET', path: '/slow' });
    expect(res).toEqual({ ok: false, error: { code: 'TIMEOUT', message: 'Request exceeded 50ms' } });
  });

  it('maps network failure to NETWORK_ERROR', async () => {
    const c = createInternalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 't', logger, defaultTimeoutMs: 50 });
    const res = await c.request({ method: 'GET', path: '/nope' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NETWORK_ERROR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement**

```ts
// packages/internal-clients/src/shared/createInternalHttpClient.ts
import { getCurrentRequestId } from '@intexuraos/common-http';
import { unwrapEnvelope, type EnvelopeResult } from './envelope.js';

export interface InternalHttpClientConfig {
  baseUrl: string;
  token: string;
  logger: { info: Fn; warn: Fn; error: Fn; debug: Fn };
  defaultTimeoutMs?: number;
}
type Fn = (obj: unknown, msg?: string) => void;

export interface RequestArgs {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  timeoutMs?: number;
  requestId?: string;           // explicit override
  extraHeaders?: Record<string, string>;
}

export type ClientError =
  | { code: 'TIMEOUT'; message: string }
  | { code: 'NETWORK_ERROR'; message: string }
  | { code: 'API_ERROR'; message: string }
  | { code: 'ENVELOPE_ERROR' | 'MALFORMED_ENVELOPE'; message: string };

export interface InternalHttpClient {
  request<T>(args: RequestArgs): Promise<EnvelopeResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createInternalHttpClient(cfg: InternalHttpClientConfig): InternalHttpClient {
  return {
    async request<T>(args: RequestArgs) {
      const timeout = args.timeoutMs ?? cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'x-internal-auth': cfg.token,
        ...(args.extraHeaders ?? {}),
      };
      if (args.body !== undefined) headers['content-type'] = 'application/json';
      const rid = args.requestId ?? getCurrentRequestId();
      if (rid !== undefined) headers['x-request-id'] = rid;

      const url = `${cfg.baseUrl}${args.path}`;
      try {
        const res = await fetch(url, {
          method: args.method,
          headers,
          signal: controller.signal,
          ...(args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
        });
        if (!res.ok) {
          return { ok: false, error: { code: 'API_ERROR', message: `HTTP ${String(res.status)}` } } as const;
        }
        const json = (await res.json()) as unknown;
        return unwrapEnvelope<T>(json);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return { ok: false, error: { code: 'TIMEOUT', message: `Request exceeded ${String(timeout)}ms` } } as const;
        }
        cfg.logger.warn({ url, err }, 'internal-client network error');
        return { ok: false, error: { code: 'NETWORK_ERROR', message: (err as Error).message } } as const;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: 100% branch coverage (required per CLAUDE.md).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(internal-clients): createInternalHttpClient thin facade with timeout, trace propagation, envelope unwrap (INT-1531)"
```

---

## Task 7: Promote `http-contracts` to Zod

**Rationale:** `http-contracts` exports only JSON Schemas. Consumers redeclare response types. Move Zod schemas to `src/zod/<service>.ts`; derive Fastify / OpenAPI JSON Schemas from them via `zod-to-json-schema`. Consumers import the inferred TS type.

**Files:**
- Add dependencies: `pnpm --filter @intexuraos/http-contracts add zod zod-to-json-schema`
- Create per-service file under `packages/http-contracts/src/zod/` (one per callee listed in Task 2 of §3 of the analysis).
- Modify: `packages/http-contracts/src/fastify-schemas.ts` → import Zod schemas and call `zodToJsonSchema(...)` at module init.
- Modify: `packages/http-contracts/src/openapi-schemas.ts` — same.
- Modify: `packages/http-contracts/src/index.ts` — re-export Zod schemas + inferred types.
- Tests under `packages/http-contracts/src/__tests__/` to assert round-trip Zod ↔ JSON Schema parity.

- [ ] **Step 1: Inventory all `/internal/*` endpoints**

Run Grep for `server.register` / `fastify.register` / `.post('/internal` / `.get('/internal` / `.put('/internal` / `.patch('/internal` across `apps/*/src/routes`. Produce a single table in the plan's execution notes (see "Inventory" section at bottom of this file). Each row: service · path · method · request schema location · response schema location · currently returns envelope? (Y/N).

- [ ] **Step 2: For each endpoint, write failing parity test**

Per service, one test file:

```ts
// packages/http-contracts/src/__tests__/zod.calendarService.test.ts
import { describe, it, expect } from 'vitest';
import { ProcessCalendarRequest, ProcessCalendarResponse } from '../zod/calendarService.js';

describe('calendar-service contracts', () => {
  it('ProcessCalendarRequest validates a minimal payload', () => {
    expect(() => ProcessCalendarRequest.parse({ userId: 'u', prompt: 'p' })).not.toThrow();
  });
  it('ProcessCalendarRequest rejects unknown fields', () => {
    expect(() => ProcessCalendarRequest.parse({ userId: 'u', prompt: 'p', bogus: 1 })).toThrow();
  });
});
```

- [ ] **Step 3: Implement per-service Zod files**

```ts
// packages/http-contracts/src/zod/calendarService.ts
import { z } from 'zod';

export const ProcessCalendarRequest = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(1),
}).strict();
export type ProcessCalendarRequest = z.infer<typeof ProcessCalendarRequest>;

export const ProcessCalendarResponse = z.object({
  status: z.enum(['completed', 'failed']),
  message: z.string(),
  resourceUrl: z.string().url().optional(),
  errorCode: z.string().optional(),
}).strict();
export type ProcessCalendarResponse = z.infer<typeof ProcessCalendarResponse>;
```

Repeat for every service listed in the inventory.

- [ ] **Step 4: Derive JSON Schemas**

```ts
// packages/http-contracts/src/fastify-schemas.ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProcessCalendarRequest, ProcessCalendarResponse } from './zod/calendarService.js';
export const calendarServiceSchemas = {
  processRequest: zodToJsonSchema(ProcessCalendarRequest, 'ProcessCalendarRequest'),
  processResponse: zodToJsonSchema(ProcessCalendarResponse, 'ProcessCalendarResponse'),
};
// … one block per service
```

Existing hand-written JSON Schemas are replaced so that any drift between Zod and JSON form is impossible by construction.

- [ ] **Step 5: Run tests**

`pnpm --filter @intexuraos/http-contracts test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(http-contracts): Zod schemas + derived JSON Schemas as single source of truth (INT-1531)"
```

---

## Task 8: Per-service modules in `internal-clients`

For every consumer in `apps/*/src/infra/http/*HttpClient.ts`, create a corresponding module under `packages/internal-clients/src/<service>/`. Each module:
1. Imports `createInternalHttpClient` from `../shared`.
2. Imports the Zod-inferred types from `@intexuraos/http-contracts`.
3. Exposes named functions matching the old per-app client signatures.
4. Ships a Vitest `nock`-based test with 100% branch coverage.

**Inventory of modules to create (1 commit each):**

| Module file                  | Consumers today                                                                                               | Notes                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `calendar-service/client.ts` | `actions-agent/src/infra/http/calendarServiceHttpClient.ts`                                                   | has the richest existing client (timeout logic) — use as reference                                                         |
| `notes-agent/client.ts`      | `actions-agent/src/infra/http/notesServiceHttpClient.ts`                                                      |                                                                                                                            |
| `retired-checklist-service/client.ts`      | `actions-agent/src/infra/http/todosServiceHttpClient.ts`                                                      |                                                                                                                            |
| `bookmarks-agent/client.ts`  | `actions-agent/src/infra/http/bookmarksServiceHttpClient.ts`                                                  |                                                                                                                            |
| `linear-agent/client.ts`     | `actions-agent/src/infra/http/linearAgentHttpClient.ts`, `code-agent/src/infra/http/linearAgentHttpClient.ts` | two current copies → one canonical                                                                                         |
| `code-agent/client.ts`       | `actions-agent/src/infra/http/codeAgentHttpClient.ts`, `linear-agent/src/infra/http/codeAgentHttpClient.ts`   | two current copies                                                                                                         |
| `commands-agent/client.ts`   | `actions-agent/src/infra/http/commandsAgentHttpClient.ts`                                                     |                                                                                                                            |
| `github-pr/client.ts`        | `apps/code-agent/src/infra/http/gitHubPRHttpClient.ts`                                                        | not covered by internal-auth (external) but benefits from shared timeout/retry/trace primitive; keep separate token source |

- [ ] **Step 1: Skeleton**

```ts
// packages/internal-clients/src/calendar-service/client.ts
import { createInternalHttpClient, type InternalHttpClient } from '../shared/createInternalHttpClient.js';
import { ProcessCalendarRequest, ProcessCalendarResponse } from '@intexuraos/http-contracts';

export interface CalendarServiceClientConfig {
  baseUrl: string;
  token: string;
  logger: Parameters<typeof createInternalHttpClient>[0]['logger'];
  defaultTimeoutMs?: number;
}

export interface CalendarServiceClient {
  processCalendar(req: ProcessCalendarRequest): Promise</* Result */ unknown>;
  /* … */
}

export function createCalendarServiceClient(cfg: CalendarServiceClientConfig): CalendarServiceClient {
  const http: InternalHttpClient = createInternalHttpClient(cfg);
  return {
    processCalendar: (req) => http.request<ProcessCalendarResponse>({ method: 'POST', path: '/internal/calendar/process', body: req }),
    /* map each endpoint; identical signature shape */
  };
}
```

- [ ] **Step 2: Test with `nock`** (request headers, happy path, timeout, envelope error, network error).

- [ ] **Step 3: 100% branch coverage required**.

- [ ] **Step 4: Commit per module**

```bash
git commit -m "feat(internal-clients/<service>): migrate HTTP client to shared facade (INT-1531)"
```

(8 commits total, one per module.)

---

## Task 9: Thin consumer migration in every app

For each app that imported a local `infra/http/*HttpClient.ts`:
1. Replace the file's entire content with a re-export of the package client, or delete the file and fix the DI registration in `services.ts`.
2. Tests under `apps/*/src/infra/http/*.test.ts` either move to the package or are updated to import the package client directly.
3. Run `pnpm run verify:workspace:tracked -- <app>`.
4. Commit per app:

```bash
git commit -m "refactor(<app>): adopt @intexuraos/internal-clients/<service> (INT-1531)"
```

Order of migration (lowest risk first, independent per app):

- [ ] Step 1: `actions-agent` → 7 clients (calendar, notes, todos, bookmarks, linear, code, commands)
- [ ] Step 2: `linear-agent` → 1 client (code)
- [ ] Step 3: `code-agent` → 2 clients (linear, github-pr)

---

## Task 10: `verify-no-raw-fetch.mjs` CI gate

**Rationale:** Locks in the migration — any future raw `fetch(` inside `apps/*/src/infra/` fails CI.

**Files:**
- Create: `scripts/verify-no-raw-fetch.mjs`
- Modify: `package.json` — wire into `ci:tracked`.

- [ ] **Step 1: Write the script**

```js
// scripts/verify-no-raw-fetch.mjs
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("git ls-files 'apps/*/src/infra/**/*.ts' 'apps/*/src/infra/**/*.tsx'", { encoding: 'utf8' })
  .split('\n').filter(Boolean);

const violations = [];
for (const f of files) {
  if (f.endsWith('.test.ts')) continue;
  const src = readFileSync(f, 'utf8');
  // Match `fetch(` that is not a method call and not in a comment line.
  const matches = src.split('\n').map((line, i) => ({ line, i: i + 1 }))
    .filter(({ line }) => /(^|[^.\w])fetch\s*\(/.test(line) && !line.trimStart().startsWith('//'));
  for (const m of matches) violations.push(`${f}:${m.i}: ${m.line.trim()}`);
}
if (violations.length > 0) {
  console.error('Raw fetch() found under apps/*/src/infra/. Use @intexuraos/internal-clients instead.');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('verify-no-raw-fetch: OK');
```

- [ ] **Step 2: Wire into `ci:tracked`** (append to `package.json` script).

- [ ] **Step 3: Test locally** — run once, should pass after all consumers migrated.

- [ ] **Step 4: Commit**

```bash
git commit -m "ci: forbid raw fetch() under apps/*/src/infra/ (INT-1531)"
```

---

## Task 11: `verify-envelope.mjs` CI gate

**Rationale:** Enforce `{ success, data?, error? }` envelope on every `/internal/*` route handler.

**Files:**
- Create: `scripts/verify-envelope.mjs`
- Modify: `package.json`

- [ ] **Step 1: Approach**

Scan `apps/*/src/routes/**/*.ts` for a Fastify route decorator whose path begins with `/internal`. For each handler, require **one** of:
- the handler uses `reply.ok()` / `reply.fail()` from `common-http` (which emit the envelope), OR
- the handler body contains `success:` and either `data:` or `error:` within the same `reply.send(...)` object literal.

Handlers failing the check print file:line and exit 1.

- [ ] **Step 2: Implement with a small TS-AST parser**

Use `typescript` compiler API already present; walk route files; collect decorator paths + send() object literal shapes.

- [ ] **Step 3: Run against the repo — fix drift surfaced by the script**

Expected violations are the routes using raw `reply.code(401).send({ error })` noted in finding #1.8.

- [ ] **Step 4: Commit**

```bash
git commit -m "ci: enforce response envelope on /internal/* routes (INT-1531)"
```

---

## Task 12: OTel preload verification + Pino integration

**Rationale:** `@intexuraos/infra-otel` exists; it is bolted on via Dockerfile `--import` and is silently absent on some services. Add a runtime self-check at startup and thread OTel `traceparent` into Pino log records.

**Files:**
- Modify: `packages/infra-otel/src/register.ts` — export `assertOtelActive()`.
- Modify: `packages/common-core/src/logging.ts` — add Pino mixin that includes `traceId` and `spanId` from OTel active context when present.
- Modify: every app's `server.ts`/`index.ts` to call `assertOtelActive({ serviceName })` during bootstrap when `NODE_ENV === 'production'`.

- [ ] **Step 1: Write failing test**

```ts
// packages/infra-otel/src/__tests__/assertOtelActive.test.ts
import { describe, it, expect } from 'vitest';
import { assertOtelActive } from '../register.js';

describe('assertOtelActive', () => {
  it('throws when GlobalTracerProvider is NoopTracerProvider', () => {
    expect(() => assertOtelActive({ serviceName: 'x' })).toThrowError(/OTel not registered/);
  });
});
```

- [ ] **Step 2: Implement** — inspect `trace.getTracerProvider()` name; if `'NoopTracerProvider'`, throw.

- [ ] **Step 3: Pino mixin** — `mixin: () => { const s = trace.getActiveSpan(); return s ? { traceId: s.spanContext().traceId, spanId: s.spanContext().spanId } : {}; }`

- [ ] **Step 4: Wire into every service bootstrap**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(infra-otel): assertOtelActive + Pino traceId/spanId mixin (INT-1531)"
```

---

## Task 13: `service-manifest.json` + `generate-service-wiring.mjs`

**Rationale:** Cloud Run URL env vars are duplicated across 4 locations with silent drift (finding §3.9 & §8.1). Generate from one manifest.

**Files:**
- Create: `apps/web/service-manifest.json`
- Create: `scripts/generate-service-wiring.mjs`
- Modify: `apps/web/src/config.ts` (import manifest; derive URL map)
- Modify: `apps/web/cloudbuild.yaml` (read from manifest via a build step OR generator emits the yaml fragment)
- Modify: `ecosystem.config.cjs` (source ports/URLs from manifest via generator)
- Modify: `terraform/environments/dev/main.tf` — generator emits a `.auto.tfvars.json` consumed by Terraform
- Add `pnpm run generate:wiring` script + pre-commit check that outputs are up to date

- [ ] **Step 1: Define manifest shape**

```json
{
  "$schema": "./service-manifest.schema.json",
  "services": [
    { "name": "calendar-service", "envVar": "INTEXURAOS_CALENDAR_SERVICE_URL", "devPort": 8101, "web": false },
    { "name": "notes-agent", "envVar": "INTEXURAOS_NOTES_AGENT_URL", "devPort": 8102, "web": true }
  ]
}
```

- [ ] **Step 2: Write schema + test fixture**

Add a JSON Schema validating `name` = kebab-case, `envVar` = `INTEXURAOS_*_URL`, `devPort` = unique 8100–8199. Unit test `generate-service-wiring.mjs` with a small fixture manifest and assert the three generated outputs.

- [ ] **Step 3: Implement generator**

Emit:
- `apps/web/src/config.generated.ts` — consumed by `config.ts`.
- `ecosystem.generated.cjs` — imported from `ecosystem.config.cjs`.
- `terraform/environments/dev/service-urls.auto.tfvars.json`.

- [ ] **Step 4: Add drift-check script**

```js
// scripts/verify-service-wiring.mjs
// Regenerate to a temp path; diff against committed files. Non-zero on diff.
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: service-manifest.json as single source for env-var wiring (INT-1531)"
```

---

## Task 14: Phase-two design doc — per-service SA OIDC

**Rationale:** Static shared token is still a single point of failure even with rotation. Phase-two migrates service-to-service auth to Google SA OIDC (each caller mints an ID token with audience = callee's Cloud Run URL).

**Files:**
- Create: `docs/architecture/internal-oidc-phase-two.md`

**Content outline:**
- Current (post-INT-1531): shared secret + dual-token rotation.
- Target: each app has a dedicated GCP Service Account; callers mint OIDC via GCP metadata server; callees validate via `createGoogleOidcVerifier({ audience: <own Cloud Run URL> })` already shipped in Task 3.
- Migration plan (no code in this task):
  1. Terraform: one SA per app, IAM `roles/run.invoker` on callee services per caller.
  2. New header `Authorization: Bearer <id_token>` in `createInternalHttpClient` when `cfg.authMode === 'oidc'`.
  3. Feature flag per call-site; flip one at a time.
  4. Delete `X-Internal-Auth` header, delete `validateInternalAuth`, delete `INTEXURAOS_INTERNAL_AUTH_TOKEN` secret.
- Rollout / rollback plan.
- Known risks: local dev must use `gcloud auth print-identity-token`; CI tests must inject a stub verifier.

- [ ] Single commit.

---

## Task 15: Delete duplicates, finalize

- [ ] **Step 1:** Verify `git grep "new AbortController" apps/*/src/infra/http/` returns 0 matches.
- [ ] **Step 2:** Verify `git grep "X-Internal-Auth" apps/*/src/infra/http/` returns 0 matches.
- [ ] **Step 3:** `pnpm run ci:tracked` green.
- [ ] **Step 4:** Update `docs/architecture/api-contracts.md` — reference the shared client in the Request-ID section; link to runbook.
- [ ] **Step 5:** Final commit + PR.

```bash
git commit -m "chore(INT-1531): remove dead per-app HTTP clients; update api-contracts.md"
```

---

## Endpoint Inventory (to be filled in Task 7 Step 1)

| Service            | Method | Path                         | Request Zod              | Response Zod              | Envelope today |
| ------------------ | ------ | ---------------------------- | ------------------------ | ------------------------- | -------------- |
| _calendar-service_ | POST   | `/internal/calendar/process` | `ProcessCalendarRequest` | `ProcessCalendarResponse` | Y              |
| _…_                |        |                              |                          |                           |                |

_(Executor fills this table during Task 7 Step 1; every row becomes the name of a pair of Zod schemas in `http-contracts/src/zod/<service>.ts`.)_

---

## Acceptance Criteria

A reviewer MUST verify each of these before closing INT-1531:

1. Zero raw `fetch(` calls under `apps/*/src/infra/` (enforced by `verify-no-raw-fetch.mjs`).
2. Zero duplicated `*HttpClient.ts` files; every consumer imports `@intexuraos/internal-clients/<service>`.
3. `X-Request-Id` is propagated on every outbound internal call (verified by an integration test spinning two services with `nock` assertions).
4. `apps/code-agent/src/routes/helpers/internalAuth.ts` and the commands-agent twin call `createGoogleOidcVerifier` when a `Bearer` header is present; rejects tokens whose `aud` ≠ service URL (unit test).
5. `validateInternalAuth` accepts `TOKEN` and `TOKEN_PREVIOUS` (unit test).
6. Every `/internal/*` route emits `{ success, data?, error? }` (enforced by `verify-envelope.mjs`).
7. `@intexuraos/http-contracts` exports Zod schemas and inferred TS types; JSON Schemas are derived at module init.
8. `assertOtelActive()` is called in every production bootstrap; Pino logs include `traceId`/`spanId` when a span is active.
9. `apps/web/service-manifest.json` is the single source for Cloud Run URL env vars; drift check in CI.
10. `docs/runbooks/internal-auth-rotation.md` and `docs/architecture/internal-oidc-phase-two.md` exist and are linked from the architecture index.
11. `pnpm run ci:tracked` passes without modifications to coverage exclusions.
12. 100% branch coverage on every new file in `packages/internal-clients/` and `packages/common-http/src/http/traceContext.ts`, with any `v8 ignore` explaining the testing blocker (not the code).

---

## Test Plan

**Unit:**
- `packages/common-http/src/__tests__/traceContext.test.ts` — ALS isolation.
- `packages/common-http/src/__tests__/internalAuth.dualToken.test.ts` — dual-token matrix.
- `packages/internal-clients/src/shared/__tests__/envelope.test.ts` — envelope guard.
- `packages/internal-clients/src/shared/__tests__/createInternalHttpClient.test.ts` — timeout/network/envelope.
- `packages/internal-clients/src/shared/__tests__/oidcVerifier.test.ts` — audience/issuer/error.
- Per per-service module test under `packages/internal-clients/src/<service>/__tests__/client.test.ts`.
- `apps/code-agent/src/routes/helpers/__tests__/internalAuth.oidc.test.ts` + commands-agent twin.

**Integration:**
- A new test under `e2e/internal-trace-propagation.spec.ts` spinning actions-agent + calendar-service (both with `setServices({ fakes })`) and asserting `X-Request-Id` observed on the inbound side equals the one generated on the outbound side.

**CI scripts:**
- Add `scripts/__tests__/verify-no-raw-fetch.test.mjs` with a tmp fixture repo.
- Add `scripts/__tests__/verify-envelope.test.mjs`.
- Add `scripts/__tests__/verify-service-wiring.test.mjs`.

**Coverage:** all new files meet 95% branch threshold; any `v8 ignore` explains the testing blocker per CLAUDE.md.

---

## Agent / Sub-Agent Responsibilities

This plan is designed to be executed **sequentially** by one executor; phases 1–3 cannot be parallelized because Phase 4 consumes the artifacts of Phase 1–3 and Phase 5 enforces Phase 4's contracts. No subtasks are created because every worker agent would share the same package surface and step on each other.

If the orchestrator later decides to split, the ONLY valid split is by Phase 4 consumer app (one subtask per `actions-agent`, `linear-agent`, `code-agent`), each of which is independent AFTER Phases 1–3 have landed.

---

## Self-Review

- **Spec coverage:** every bullet in the original issue has at least one task (HTTP client unification = Tasks 6+8+9; X-Request-Id = Tasks 1+6; OIDC = Tasks 3+4; dual-token = Task 2; http-contracts zod = Task 7; envelope = Tasks 5+11; OTel preload + logs = Task 12; services.yaml generator = Task 13). Phase-two OIDC design = Task 14.
- **No placeholders:** every step carries either code or a concrete command; the only deliberately deferred artifact is the endpoint inventory table, which is bounded by Task 7 Step 1 and consumed by Task 7 Step 3.
- **Type consistency:** `InternalHttpClient.request<T>` used in Task 6 matches usage in Task 8; `EnvelopeResult<T>` defined in Task 5 is the return type threaded through Tasks 6 and 8; `InternalAuthResult.tokenUsed` added in Task 2 is assertable in Task 2's test.
