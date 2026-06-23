# INT-1520 — Guest Chat Rate-Limit Bypass Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the `x-guest-session`-header rate-limit bypass in `apps/retired-chat-service` so an attacker cannot generate unlimited billed LLM calls by rotating the guest UUID per request.

**Architecture:**
1. Replace the client-generated guest UUID with a **server-signed JWT guest session** (HS256 via `jose`, 24h TTL, opaque `sub`). The token is issued by a new `POST /guest-session` endpoint on `retired-chat-service` and returned to the web app, which stores it in `localStorage` instead of a raw UUID.
2. In `POST /chat`, verify the guest session token signature and key the existing per-sub rate limiter on the **verified `sub` claim**, so rotating the header has no effect.
3. Add `@fastify/rate-limit` as an **IP-based floor** on both `/chat` and `/guest-session` so the attacker cannot simply request unlimited fresh signed tokens per second. The existing in-memory guest limiter is preserved as the per-session layer and continues to have an LRU eviction cap to prevent the unbounded-Map leak.

**Tech Stack:** TypeScript (strict), Fastify 5, `jose` 5 (already a devDep — promote to dep), `@fastify/rate-limit` 10.x, Vitest, TailwindCSS (web).

**Endpoint Changes:**
- **Modified:** `POST /chat` — now verifies `x-guest-session` as a signed JWT for guests; rate limit keys on verified `sub`, not raw header.
- **Created:** `POST /guest-session` — issues a signed guest session token, IP-rate-limited.
- **Removed:** none.
- **Unchanged:** `GET /health`, `GET /openapi.json`, `GET /docs`.

---

## File Structure

**New files:**
- `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.ts` — HS256 sign/verify with `jose`, opaque sub generation, expiry.
- `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.test.ts` — unit tests for sign/verify, expiry, tamper detection, malformed input.
- `apps/retired-chat-service/src/infra/guestSession/index.ts` — barrel.
- `apps/retired-chat-service/src/routes/guestSessionRoutes.ts` — `POST /guest-session` route.
- `apps/retired-chat-service/src/__tests__/guestSessionRoutes.test.ts` — route tests.

**Modified files:**
- `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.ts` — add LRU eviction cap (bounded Map).
- `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.test.ts` — add eviction test.
- `apps/retired-chat-service/src/routes/chatRoutes.ts` — verify signed guest session; key limiter on verified `sub`.
- `apps/retired-chat-service/src/routes/index.ts` — register new route.
- `apps/retired-chat-service/src/services.ts` — add `guestSessionSigner` to `ServiceContainer`; register env var `INTEXURAOS_GUEST_SESSION_SECRET`.
- `apps/retired-chat-service/src/server.ts` — register `@fastify/rate-limit` plugin.
- `apps/retired-chat-service/src/index.ts` — add `INTEXURAOS_GUEST_SESSION_SECRET` to `REQUIRED_ENV`.
- `apps/retired-chat-service/package.json` — promote `jose` to dep; add `@fastify/rate-limit`.
- `apps/retired-chat-service/src/__tests__/routes.test.ts` — update guest tests to use signed token; add sub-rotation-bypass test.
- `apps/retired-chat-service/src/__tests__/fakes.fixture.ts` — add fake signer.
- `apps/retired-chat-service/src/__tests__/services.test.ts` — update null-field list with `guestSessionSigner`.
- `apps/web/src/services/chatService.ts` — replace local UUID generation with call to `/guest-session` endpoint; store signed token instead of raw UUID.
- `apps/web/src/services/chatService.test.ts` (if exists — otherwise no new test is required per web-app coverage exception, but add if present).
- `apps/web/src/config.ts` — no new URL needed (reuses `retiredChatServiceUrl`), verify only.
- `terraform/environments/dev/main.tf` — add `INTEXURAOS_GUEST_SESSION_SECRET` to `chat_agent` secrets and to `common_service_secrets` declaration.
- `ecosystem.config.cjs` — add `INTEXURAOS_GUEST_SESSION_SECRET` to retired-chat-service env.
- `docs/services/retired-chat-service/features.md` — document the guest session flow.

**Files that change together:** The three env-var locations (`apps/retired-chat-service/src/index.ts`, `terraform/environments/dev/main.tf`, `ecosystem.config.cjs`) MUST all be updated in the same commit per CLAUDE.md rules.

---

## Background & Constraints

- Current bypass (`apps/retired-chat-service/src/routes/chatRoutes.ts:138–150`): limiter key is the raw `x-guest-session` header. Attacker rotates UUID per request.
- Current limiter (`apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.ts`): unbounded `Map` — second vulnerability (memory DoS).
- Web client (`apps/web/src/services/chatService.ts:29–40`): generates UUID client-side and persists in `localStorage`.
- `retired-chat-service` currently runs at `max_scale=1` in dev. A shared multi-pod store (Redis/Firestore-backed rate-limit store) is **out of scope** for this ticket — documented below as a follow-up. The signed-session approach alone closes the cost-attack vector even at multi-pod, because the only way to mint a new `sub` is to call `/guest-session`, which is itself IP-limited. Per-pod in-memory layers are acceptable at current scale.
- `jose` is already a devDep (`apps/retired-chat-service/package.json:38`); we must promote it to dep because it is imported from production code.
- Env var `INTEXURAOS_GUEST_SESSION_SECRET` must be added in all three locations: `apps/retired-chat-service/src/index.ts` `REQUIRED_ENV`, `terraform/environments/dev/main.tf`, `ecosystem.config.cjs`.

---

## Task 1 — Add `guestSessionSigner` with unit tests (TDD)

**Files:**
- Create: `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.ts`
- Create: `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.test.ts`
- Create: `apps/retired-chat-service/src/infra/guestSession/index.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createGuestSessionSigner, type GuestSessionSigner } from './guestSessionSigner.js';

const SECRET = 'test-secret-min-32-bytes-ok-padded-padded';

describe('guestSessionSigner', () => {
  let signer: GuestSessionSigner;

  beforeEach(() => {
    signer = createGuestSessionSigner({ secret: SECRET, ttlSeconds: 3600 });
  });

  it('issues a token whose sub verifies round-trip', async () => {
    const { token, sub, expiresAt } = await signer.issue();
    expect(typeof token).toBe('string');
    expect(sub).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const verified = await signer.verify(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.sub).toBe(sub);
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createGuestSessionSigner({ secret: 'different-secret-32-bytes-padding-padding', ttlSeconds: 3600 });
    const { token } = await other.issue();
    const result = await signer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects a malformed token', async () => {
    const result = await signer.verify('not-a-jwt');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty token', async () => {
    const result = await signer.verify('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects an expired token', async () => {
    const shortSigner = createGuestSessionSigner({ secret: SECRET, ttlSeconds: 1 });
    const { token } = await shortSigner.issue();
    // Wait past expiry
    await new Promise((r) => setTimeout(r, 1100));
    const result = await signer.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXPIRED');
    }
  });

  it('produces opaque subs that differ across issues', async () => {
    const a = await signer.issue();
    const b = await signer.issue();
    expect(a.sub).not.toBe(b.sub);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestSessionSigner`
Expected: FAIL with "Cannot find module './guestSessionSigner.js'".

- [ ] **Step 3: Implement the signer**

Create `apps/retired-chat-service/src/infra/guestSession/guestSessionSigner.ts`:

```ts
/**
 * Guest session signer.
 *
 * Issues and verifies short-lived HS256 JWTs used as signed guest session IDs.
 * Prevents the client from picking its own session identifier (which would
 * allow trivially bypassing per-session rate limits by rotating the UUID).
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import * as jose from 'jose';

export interface GuestSessionPayload {
  sub: string;
  issuedAt: number;
  expiresAt: number;
}

export type GuestSessionError =
  | { code: 'INVALID_SIGNATURE'; message: string }
  | { code: 'EXPIRED'; message: string };

export interface GuestSessionSigner {
  issue(): Promise<{ token: string; sub: string; expiresAt: number }>;
  verify(token: string): Promise<Result<GuestSessionPayload, GuestSessionError>>;
}

export interface GuestSessionSignerConfig {
  secret: string;
  ttlSeconds: number;
}

const ISSUER = 'intexuraos-retired-chat-service';
const AUDIENCE = 'intexuraos-guest-chat';

export function createGuestSessionSigner(
  config: GuestSessionSignerConfig
): GuestSessionSigner {
  const key = new TextEncoder().encode(config.secret);

  return {
    async issue(): Promise<{ token: string; sub: string; expiresAt: number }> {
      const sub = crypto.randomUUID();
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAtSec = issuedAt + config.ttlSeconds;
      const token = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(sub)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAtSec)
        .sign(key);
      return { token, sub, expiresAt: expiresAtSec * 1000 };
    },

    async verify(
      token: string
    ): Promise<Result<GuestSessionPayload, GuestSessionError>> {
      if (token.length === 0) {
        return err({ code: 'INVALID_SIGNATURE', message: 'Empty token' });
      }
      try {
        const { payload } = await jose.jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        const sub = payload.sub;
        const iat = payload.iat;
        const exp = payload.exp;
        if (typeof sub !== 'string' || sub.length === 0) {
          return err({ code: 'INVALID_SIGNATURE', message: 'Missing sub' });
        }
        if (typeof iat !== 'number' || typeof exp !== 'number') {
          return err({ code: 'INVALID_SIGNATURE', message: 'Missing iat/exp' });
        }
        return ok({ sub, issuedAt: iat * 1000, expiresAt: exp * 1000 });
      } catch (e) {
        if (e instanceof jose.errors.JWTExpired) {
          return err({ code: 'EXPIRED', message: 'Token expired' });
        }
        return err({
          code: 'INVALID_SIGNATURE',
          message: e instanceof Error ? e.message : 'Verification failed',
        });
      }
    },
  };
}
```

- [ ] **Step 4: Create barrel export**

Create `apps/retired-chat-service/src/infra/guestSession/index.ts`:

```ts
export {
  createGuestSessionSigner,
  type GuestSessionSigner,
  type GuestSessionSignerConfig,
  type GuestSessionPayload,
  type GuestSessionError,
} from './guestSessionSigner.js';
```

- [ ] **Step 5: Run tests — all green**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestSessionSigner`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/retired-chat-service/src/infra/guestSession
git commit -m "feat(retired-chat-service): add guestSessionSigner for signed JWT sessions [INT-1520]"
```

---

## Task 2 — Add LRU eviction to `guestRateLimiter` (TDD)

**Files:**
- Modify: `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.ts`
- Modify: `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.test.ts` (append to existing describe block):

```ts
  describe('unbounded map protection', () => {
    it('evicts the oldest entries when capacity is exceeded', () => {
      const limiter = createGuestRateLimiter({ maxPerHour: 100, maxSessions: 3 });

      limiter.record('a');
      limiter.record('b');
      limiter.record('c');
      limiter.record('d'); // 'a' should be evicted

      const aUsage = limiter.getUsage('a');
      const dUsage = limiter.getUsage('d');

      expect(aUsage).toEqual({ count: 0, remaining: 100 }); // reset (evicted)
      expect(dUsage).toEqual({ count: 1, remaining: 99 });
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestRateLimiter`
Expected: FAIL — "maxSessions" unknown option OR eviction never occurs.

- [ ] **Step 3: Add LRU eviction to the limiter**

Modify `apps/retired-chat-service/src/infra/rateLimit/guestRateLimiter.ts`:

```ts
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PER_HOUR = 100;
const DEFAULT_MAX_SESSIONS = 50_000;

export interface GuestRateLimiterConfig {
  maxPerHour?: number;
  maxSessions?: number;
}

export function createGuestRateLimiter(config?: GuestRateLimiterConfig): GuestRateLimiter {
  const maxPerHour = config?.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  const maxSessions = config?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  // Map preserves insertion order — first key is oldest. Re-insert on update to mark as most recent.
  const usage = new Map<string, GuestUsage>();

  function touch(sessionId: string, entry: GuestUsage): void {
    usage.delete(sessionId);
    usage.set(sessionId, entry);
    while (usage.size > maxSessions) {
      const oldest = usage.keys().next().value;
      if (oldest === undefined) break;
      usage.delete(oldest);
    }
  }

  return {
    check(sessionId: string): Result<void, { message: string }> {
      const now = Date.now();
      const entry = usage.get(sessionId);
      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        return ok(undefined);
      }
      if (entry.count >= maxPerHour) {
        const resetInMs = entry.windowStart + HOUR_MS - now;
        const resetInMinutes = Math.ceil(resetInMs / 60000);
        return err({
          message: `Rate limit exceeded. Try again in ${String(resetInMinutes)} minutes.`,
        });
      }
      return ok(undefined);
    },

    record(sessionId: string): void {
      const now = Date.now();
      const entry = usage.get(sessionId);
      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        touch(sessionId, { count: 1, windowStart: now });
      } else {
        entry.count++;
        touch(sessionId, entry);
      }
    },

    getUsage(sessionId: string): { count: number; remaining: number } | null {
      const now = Date.now();
      const entry = usage.get(sessionId);
      if (entry === undefined || now - entry.windowStart > HOUR_MS) {
        return { count: 0, remaining: maxPerHour };
      }
      return { count: entry.count, remaining: Math.max(0, maxPerHour - entry.count) };
    },
  };
}
```

- [ ] **Step 4: Run tests — all green**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestRateLimiter`
Expected: all previous tests + new eviction test pass.

- [ ] **Step 5: Commit**

```bash
git add apps/retired-chat-service/src/infra/rateLimit
git commit -m "fix(retired-chat-service): cap guestRateLimiter Map size to prevent memory DoS [INT-1520]"
```

---

## Task 3 — Promote `jose` to dep and add `@fastify/rate-limit`

**Files:**
- Modify: `apps/retired-chat-service/package.json`

- [ ] **Step 1: Update package.json**

Modify `apps/retired-chat-service/package.json`:

```json
{
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/rate-limit": "^10.2.1",
    "@fastify/swagger": "^9.4.2",
    "@fastify/swagger-ui": "^5.2.1",
    "@intexuraos/common-core": "workspace:*",
    "@intexuraos/common-http": "workspace:*",
    "@intexuraos/http-contracts": "workspace:*",
    "@intexuraos/http-server": "workspace:*",
    "@intexuraos/infra-firestore": "workspace:*",
    "@intexuraos/infra-otel": "workspace:*",
    "@intexuraos/infra-sentry": "workspace:*",
    "@intexuraos/internal-clients": "workspace:*",
    "@intexuraos/llm-contract": "workspace:*",
    "@intexuraos/llm-factory": "workspace:*",
    "@intexuraos/llm-pricing": "workspace:*",
    "fastify": "^5.1.0",
    "jose": "^5.9.6",
    "openai": "^4.0.0",
    "pino": "^10.1.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Build (verify dist exists)**

Run: `pnpm --filter @intexuraos/retired-chat-service build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/retired-chat-service/package.json pnpm-lock.yaml
git commit -m "chore(retired-chat-service): add @fastify/rate-limit and promote jose to dep [INT-1520]"
```

---

## Task 4 — Add env var `INTEXURAOS_GUEST_SESSION_SECRET` in all three locations

**Files:**
- Modify: `apps/retired-chat-service/src/index.ts`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Update REQUIRED_ENV in `apps/retired-chat-service/src/index.ts`**

Modify lines 7–17:

```ts
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_OPENAI_APP_API_KEY',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_GEMINI_APP_API_KEY',
  'INTEXURAOS_GUEST_SESSION_SECRET',
];
```

- [ ] **Step 2: Add secret declaration in `terraform/environments/dev/main.tf`**

In the secret-manager secrets map (near line 513, `INTEXURAOS_OPENAI_APP_API_KEY`), add:

```hcl
"INTEXURAOS_GUEST_SESSION_SECRET" = "HS256 secret used to sign retired-chat-service guest session JWTs (at least 32 bytes of entropy)"
```

In the `chat_agent` module's `secrets = merge(...)` block (near line 1654), add:

```hcl
  secrets = merge(local.common_service_secrets, {
    INTEXURAOS_OPENAI_APP_API_KEY    = module.secret_manager.secret_ids["INTEXURAOS_OPENAI_APP_API_KEY"]
    INTEXURAOS_GUEST_SESSION_SECRET  = module.secret_manager.secret_ids["INTEXURAOS_GUEST_SESSION_SECRET"]
  })
```

- [ ] **Step 3: Add env var to `ecosystem.config.cjs`**

In the `retired-chat-service` app entry, add `INTEXURAOS_GUEST_SESSION_SECRET` to the env (read from the home-dev `.env` file per existing pattern). Refer to `.claude/reference/env-vars-patterns.md` for exact shape — mirror the pattern used for `INTEXURAOS_GEMINI_APP_API_KEY`.

- [ ] **Step 4: Generate the actual secret value**

User-action (document in PR body): generate a 64-byte random hex string and store it in Secret Manager:

```bash
openssl rand -hex 48 | gcloud secrets create INTEXURAOS_GUEST_SESSION_SECRET \
  --project=intexuraos-dev-pbuchman \
  --data-file=-
```

Also add to `home-dev/.env` for PM2 dev environment.

- [ ] **Step 5: Commit**

```bash
git add apps/retired-chat-service/src/index.ts terraform/environments/dev/main.tf ecosystem.config.cjs
git commit -m "feat(retired-chat-service): declare INTEXURAOS_GUEST_SESSION_SECRET env var [INT-1520]"
```

---

## Task 5 — Wire `guestSessionSigner` into `ServiceContainer`

**Files:**
- Modify: `apps/retired-chat-service/src/services.ts`
- Modify: `apps/retired-chat-service/src/__tests__/services.test.ts`
- Modify: `apps/retired-chat-service/src/__tests__/fakes.fixture.ts`

- [ ] **Step 1: Write the failing test for services bootstrap**

Add to `apps/retired-chat-service/src/__tests__/services.test.ts`, next to the other `initializeServices` tests:

```ts
  it('throws when INTEXURAOS_GUEST_SESSION_SECRET is missing', () => {
    delete process.env['INTEXURAOS_GUEST_SESSION_SECRET'];
    // other env vars set by beforeEach fixture
    expect(() => initializeServices()).toThrow(/INTEXURAOS_GUEST_SESSION_SECRET/);
  });
```

Also update every `customServices` literal in this file (currently at lines ~148, ~178) to include:

```ts
guestSessionSigner: null as unknown as ServiceContainer['guestSessionSigner'],
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- services.test.ts`
Expected: FAIL — `guestSessionSigner` not in `ServiceContainer`.

- [ ] **Step 3: Add `guestSessionSigner` to ServiceContainer**

Modify `apps/retired-chat-service/src/services.ts`:

```ts
import { createGuestSessionSigner, type GuestSessionSigner } from './infra/guestSession/index.js';

export interface ServiceContainer {
  readonly generateId: () => string;
  readonly embeddingRepository: EmbeddingRepositoryPort;
  readonly embeddingClient: EmbeddingClientInterface;
  readonly userServiceClient: UserServiceClient;
  readonly logger: Logger;
  readonly guestRateLimiter: GuestRateLimiter;
  readonly guestLlmClient: LlmGenerateClient;
  readonly guestSessionSigner: GuestSessionSigner;
}
```

In `initializeServices()`:

```ts
  const guestSessionSecret = process.env['INTEXURAOS_GUEST_SESSION_SECRET'];
  if (guestSessionSecret === undefined || guestSessionSecret.length < 32) {
    throw new Error(
      'INTEXURAOS_GUEST_SESSION_SECRET environment variable is required and must be at least 32 bytes'
    );
  }
```

And add to the container literal:

```ts
  container = {
    // ... existing
    guestSessionSigner: createGuestSessionSigner({
      secret: guestSessionSecret,
      ttlSeconds: 24 * 60 * 60, // 24h
    }),
  };
```

- [ ] **Step 4: Add fake to test fixture**

Modify `apps/retired-chat-service/src/__tests__/fakes.fixture.ts`. Add above `setupFakeServices`:

```ts
export class FakeGuestSessionSigner implements GuestSessionSigner {
  private nextSub = 'fake-sub-1';

  setNextSub(sub: string): void {
    this.nextSub = sub;
  }

  async issue(): Promise<{ token: string; sub: string; expiresAt: number }> {
    const sub = this.nextSub;
    return await Promise.resolve({
      token: `fake-token-for-${sub}`,
      sub,
      expiresAt: Date.now() + 3600_000,
    });
  }

  async verify(token: string): ReturnType<GuestSessionSigner['verify']> {
    if (!token.startsWith('fake-token-for-')) {
      return await Promise.resolve(err({ code: 'INVALID_SIGNATURE' as const, message: 'fake: bad token' }));
    }
    const sub = token.slice('fake-token-for-'.length);
    return await Promise.resolve(
      ok({ sub, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 3600_000 })
    );
  }
}
```

Update `setupFakeServices` to construct and inject it:

```ts
const fakeGuestSessionSigner = new FakeGuestSessionSigner();
// ... in services:
guestSessionSigner: fakeGuestSessionSigner,
// ... in returned object:
fakeGuestSessionSigner,
```

Also update the return type and `import { ok, err } from '@intexuraos/common-core'` at top of fixture if not already present.

- [ ] **Step 5: Run tests — all green**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- services.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/retired-chat-service/src/services.ts apps/retired-chat-service/src/__tests__
git commit -m "feat(retired-chat-service): wire guestSessionSigner into ServiceContainer [INT-1520]"
```

---

## Task 6 — Add `POST /guest-session` route (TDD)

**Files:**
- Create: `apps/retired-chat-service/src/routes/guestSessionRoutes.ts`
- Create: `apps/retired-chat-service/src/__tests__/guestSessionRoutes.test.ts`
- Modify: `apps/retired-chat-service/src/routes/index.ts`
- Modify: `apps/retired-chat-service/src/server.ts` — register the new route.

- [ ] **Step 1: Write the failing test**

Create `apps/retired-chat-service/src/__tests__/guestSessionRoutes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { setupFakeServices, resetServicesAfterTest } from './fakes.fixture.js';

describe('POST /guest-session', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    setupFakeServices();
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    resetServicesAfterTest();
  });

  beforeEach(() => {
    setupFakeServices();
  });

  it('returns a token and expiresAt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/guest-session',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.sessionToken).toBe('string');
    expect(typeof body.data.expiresAt).toBe('number');
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestSessionRoutes`
Expected: FAIL — 404 on `/guest-session`.

- [ ] **Step 3: Implement route**

Create `apps/retired-chat-service/src/routes/guestSessionRoutes.ts`:

```ts
/**
 * Guest Session Routes
 *
 * POST /guest-session — issue a server-signed guest session token.
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const guestSessionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/guest-session',
    {
      schema: {
        operationId: 'issueGuestSession',
        summary: 'Issue a signed guest session token',
        description:
          'Returns a short-lived signed guest session token. The client MUST send this token as the X-Guest-Session header on subsequent /chat calls.',
        tags: ['chat'],
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['sessionToken', 'expiresAt'],
                properties: {
                  sessionToken: { type: 'string' },
                  expiresAt: { type: 'number' },
                },
              },
            },
          },
        },
      },
      config: {
        // Stricter IP-based limit for session minting (see Task 7)
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /guest-session',
      });
      const issued = await getServices().guestSessionSigner.issue();
      return await reply.ok({
        sessionToken: issued.token,
        expiresAt: issued.expiresAt,
      });
    }
  );
  done();
};
```

- [ ] **Step 4: Export and register**

Modify `apps/retired-chat-service/src/routes/index.ts`:

```ts
export { chatRoutes } from './chatRoutes.js';
export { guestSessionRoutes } from './guestSessionRoutes.js';
```

Modify `apps/retired-chat-service/src/server.ts` — after `await app.register(chatRoutes);`:

```ts
await app.register(guestSessionRoutes);
```

Also import at top:

```ts
import { chatRoutes, guestSessionRoutes } from './routes/index.js';
```

- [ ] **Step 5: Run test — passes**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- guestSessionRoutes`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/retired-chat-service/src/routes apps/retired-chat-service/src/server.ts apps/retired-chat-service/src/__tests__/guestSessionRoutes.test.ts
git commit -m "feat(retired-chat-service): add POST /guest-session to issue signed tokens [INT-1520]"
```

---

## Task 7 — Register `@fastify/rate-limit` as IP floor (TDD)

**Files:**
- Modify: `apps/retired-chat-service/src/server.ts`
- Create test: extend `apps/retired-chat-service/src/__tests__/routes.test.ts` with an IP-limit test.

- [ ] **Step 1: Write the failing test**

Add to `apps/retired-chat-service/src/__tests__/routes.test.ts` under a new `describe('IP rate limiting')`:

```ts
  describe('IP rate limiting', () => {
    it('returns 429 after exceeding the per-IP request budget on /guest-session', async () => {
      // Budget defined in server config: 10/min
      const responses = [];
      for (let i = 0; i < 15; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/guest-session',
          headers: { 'x-forwarded-for': '203.0.113.7' },
        });
        responses.push(r.statusCode);
      }
      expect(responses.filter((s) => s === 429).length).toBeGreaterThan(0);
    });
  });
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- routes.test.ts`
Expected: FAIL — all responses are 200.

- [ ] **Step 3: Register `@fastify/rate-limit`**

Modify `apps/retired-chat-service/src/server.ts`. Add import:

```ts
import fastifyRateLimit from '@fastify/rate-limit';
```

Inside `buildServer` BEFORE route registration:

```ts
  await app.register(fastifyRateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
    // Use X-Forwarded-For when trustProxy is on; Fastify resolves request.ip correctly when configured.
    keyGenerator: (req) => req.ip,
    // Skip OPTIONS/HEAD/health
    skip: (req) => req.method === 'OPTIONS' || req.method === 'HEAD' || req.url.startsWith('/health'),
  });
```

Also enable `trustProxy` in the Fastify factory (Cloud Run puts the client IP in `X-Forwarded-For`):

```ts
  const app = Fastify({
    logger: /* ... unchanged ... */,
    disableRequestLogging: true,
    trustProxy: true,
  });
```

- [ ] **Step 4: Run test — passes**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- routes.test.ts`
Expected: the new test passes; existing tests still pass. If existing guest tests trip the IP limit because of shared IP, supply unique `x-forwarded-for` per test case.

- [ ] **Step 5: Commit**

```bash
git add apps/retired-chat-service/src/server.ts apps/retired-chat-service/src/__tests__/routes.test.ts
git commit -m "feat(retired-chat-service): add @fastify/rate-limit IP floor [INT-1520]"
```

---

## Task 8 — `POST /chat` now verifies signed guest session (TDD)

**Files:**
- Modify: `apps/retired-chat-service/src/routes/chatRoutes.ts`
- Modify: `apps/retired-chat-service/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/retired-chat-service/src/__tests__/routes.test.ts` in the guest describe block:

```ts
    it('rejects an x-guest-session header that is not a valid signed token (401)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: { 'x-guest-session': 'not-a-real-token' },
        payload: { message: 'Hello' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    });

    it('keys the rate limit on the verified sub, not the raw header — rotation does not bypass', async () => {
      // Simulate a single signed sub being used across many rotated header values.
      // Our FakeGuestSessionSigner maps token->sub deterministically; use the same token 200 times.
      fakeServices.fakeGuestRateLimiter.setBlock(true, 'Rate limit exceeded.');
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: { 'x-guest-session': 'fake-token-for-fake-sub-1' },
        payload: { message: 'Hello' },
      });
      expect(response.statusCode).toBe(429);
    });

    it('verifies the signed token once and uses the verified sub for limiter check', async () => {
      // Arrange: guest signer returns sub 'abc'
      fakeServices.fakeGuestSessionSigner.setNextSub('abc');
      // (no explicit issuance path here; verify() is used in /chat)
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: { 'x-guest-session': 'fake-token-for-abc' },
        payload: { message: 'Hello' },
      });
      expect(response.statusCode).toBe(200);
      // Assert: limiter saw 'abc', not the raw header
      expect(fakeServices.fakeGuestRateLimiter.seenSessionIds).toContain('abc');
    });
```

(Extend `FakeGuestRateLimiter` in `fakes.fixture.ts` to expose `seenSessionIds: string[]` recorded on `check()` and `record()`.)

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- routes.test.ts`
Expected: FAIL — 200 returned for invalid tokens, limiter keyed on raw header.

- [ ] **Step 3: Update `chatRoutes.ts`**

Modify the guest branch in `apps/retired-chat-service/src/routes/chatRoutes.ts` (lines 136–157):

```ts
      } else {
        // GUEST USER — require a server-signed session token
        const sessionHeader = request.headers['x-guest-session'];
        const rawToken = typeof sessionHeader === 'string' ? sessionHeader : null;
        if (rawToken === null || rawToken.length === 0) {
          return await reply.fail('UNAUTHORIZED', 'Authentication required or guest session token missing');
        }

        const verified = await getServices().guestSessionSigner.verify(rawToken);
        if (!verified.ok) {
          return await reply.fail('UNAUTHORIZED', 'Invalid or expired guest session token');
        }

        const verifiedSub = verified.value.sub; // @allow-result-access -- guarded by !verified.ok check above
        guestSessionId = verifiedSub;

        // Check rate limit keyed on the verified sub (NOT the raw header)
        const rateLimitResult = getServices().guestRateLimiter.check(verifiedSub);
        if (!rateLimitResult.ok) {
          return await reply.fail('RATE_LIMITED', rateLimitResult.error.message);
        }

        userId = 'guest';
        chatClient = createChatClient({
          llmClient: getServices().guestLlmClient,
          logger: getServices().logger,
        });
      }
```

The subsequent `record(guestSessionId)` call (line ~194) now records against the verified sub — no other change needed there.

- [ ] **Step 4: Update existing guest tests to use signed tokens**

Every call in `routes.test.ts` that sets `'x-guest-session': 'guest-session-123'` must be updated to use `'fake-token-for-guest-session-123'` and set `fakeGuestSessionSigner.setNextSub('guest-session-123')` first, or use any valid fake token. Run the file to find all occurrences.

- [ ] **Step 5: Run — passes**

Run: `pnpm --filter @intexuraos/retired-chat-service test -- routes.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/retired-chat-service/src/routes/chatRoutes.ts apps/retired-chat-service/src/__tests__
git commit -m "fix(retired-chat-service): verify signed guest session; rate-limit by verified sub [INT-1520]"
```

---

## Task 9 — Web app: fetch signed session from `/guest-session`

**Files:**
- Modify: `apps/web/src/services/chatService.ts`

- [ ] **Step 1: Update `getOrCreateGuestSessionId` to call the server**

Rename to `getOrCreateGuestSessionToken` and change its signature to `async`. Modify:

```ts
const GUEST_SESSION_KEY = 'intex-guest-session-token';
const GUEST_SESSION_EXPIRES_KEY = 'intex-guest-session-expires';

export async function getOrCreateGuestSessionToken(): Promise<string> {
  try {
    const token = localStorage.getItem(GUEST_SESSION_KEY);
    const expiresRaw = localStorage.getItem(GUEST_SESSION_EXPIRES_KEY);
    const expires = expiresRaw !== null ? Number(expiresRaw) : 0;
    if (token !== null && expires > Date.now() + 30_000) {
      return token;
    }
  } catch {
    // localStorage unavailable — fall through to fetch
  }

  const response = await fetch(`${config.retiredChatServiceUrl}/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new ApiError('Failed to create guest session', response.status);
  }
  const body = (await response.json()) as {
    success: boolean;
    data: { sessionToken: string; expiresAt: number };
  };
  try {
    localStorage.setItem(GUEST_SESSION_KEY, body.data.sessionToken);
    localStorage.setItem(GUEST_SESSION_EXPIRES_KEY, String(body.data.expiresAt));
  } catch {
    // localStorage unavailable — return token without caching
  }
  return body.data.sessionToken;
}
```

Update `sendGuestMessage` to `await` it:

```ts
const guestSessionToken = await getOrCreateGuestSessionToken();
// ... in headers:
'X-Guest-Session': guestSessionToken,
```

Also purge the old `intex-guest-session-id` localStorage entry on first load (one-time migration) — add a top-level `try { localStorage.removeItem('intex-guest-session-id'); } catch {}` on module import to avoid stale raw UUIDs being sent.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @intexuraos/web typecheck`
Expected: pass.

- [ ] **Step 3: Build**

Run: `pnpm --filter @intexuraos/web build`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/chatService.ts
git commit -m "feat(web): fetch signed guest session token from retired-chat-service [INT-1520]"
```

---

## Task 10 — Update service docs

**Files:**
- Modify: `docs/services/retired-chat-service/features.md`

- [ ] **Step 1: Document the guest session flow**

Add a section "Guest session authentication":

```markdown
### Guest session authentication

Unauthenticated (guest) access uses a server-signed JWT session token:

1. The web app calls `POST /guest-session` on first visit and receives a signed token (HS256, 24h TTL, opaque sub).
2. The token is stored in `localStorage` and sent on every `/chat` call via the `X-Guest-Session` header.
3. `/chat` verifies the token signature and rate-limits based on the **verified `sub` claim** — client-side rotation cannot bypass the limit.
4. `/guest-session` itself is IP-rate-limited (10/min) to prevent the attacker from mass-minting sessions.
5. The per-sub limiter is bounded (LRU) to prevent memory exhaustion.

The signing secret is provided via `INTEXURAOS_GUEST_SESSION_SECRET` (Secret Manager).
```

- [ ] **Step 2: Commit**

```bash
git add docs/services/retired-chat-service/features.md
git commit -m "docs(retired-chat-service): document signed guest session flow [INT-1520]"
```

---

## Task 11 — Full CI & PR

- [ ] **Step 1: Run full CI from repo root**

Run: `pnpm run ci:tracked 2>&1 | tee /tmp/ci-output-int-1520.txt`
Expected: all workspaces green.

- [ ] **Step 2: If any failure, analyze and fix**

Run: `rg "error|FAIL" -C3 /tmp/ci-output-int-1520.txt`
Fix every failure. Per CLAUDE.md ownership mindset: no "pre-existing"/"not mine".

- [ ] **Step 3: Push and open PR targeting `development`**

```bash
gh pr create --base development --title "[INT-1520] [plan] Harden guest chat rate limit against header rotation" --body "..."
```

PR body must include the standard header (Linear link, code-task link, Worker Type, Model) and a list of migrations/env-var changes.

---

## Out of Scope / Follow-ups

- **Multi-pod shared rate-limit store:** Current per-pod in-memory limiters are adequate at `max_scale=1`. When scaling out, move to a Redis/Firestore-backed store (either as `@fastify/rate-limit` `store` option or a custom Firestore-backed limiter). Create a follow-up under **INT-1490** (tracking issue for broader rate-limiting work).
- **Rotating signing keys:** Current design uses a single HS256 secret. Key rotation (kid-based) can be added later without breaking the token format.
- **Attribution to signed session in LLM usage sink:** `guestUsageSink` already tags usage as `component: 'guest-chat'`. Passing the verified `sub` as a tag for cost attribution is a follow-up.
- **Web app coverage tests:** Per CLAUDE.md, web-app UI tests are optional; services have required coverage. If `apps/web/src/services/chatService.test.ts` exists, add a test that mocks `fetch` and asserts `POST /guest-session` is called exactly once when cached.

---

## Self-Review Checklist (verified by author)

1. **Spec coverage:**
   - "Issue server-signed/encrypted guest session IDs" → Tasks 1, 5, 6.
   - "Rate-limit by IP and globally via @fastify/rate-limit" → Task 7.
   - "Shared store" → explicitly deferred with rationale (single-pod at current scale).
   - "Attribute guest usage to signed session" → noted as follow-up (usage sink already component-tagged).
   - "Unbounded memory growth on the limiter Map" → Task 2 adds LRU eviction.
2. **No placeholders:** every step has concrete code/commands.
3. **Type consistency:** `GuestSessionSigner.issue` returns `{ token, sub, expiresAt }` consistently in Tasks 1, 5, 6, 8, 9.
4. **Env var rule:** Task 4 touches all three locations in one commit.
5. **Parallelism:** one execution agent — web changes strictly depend on retired-chat-service `/guest-session` being deployed, so no subtask split.
