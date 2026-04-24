# Workers Layer Refactor — Implementation Plan

> **Parent Linear issue:** [INT-1530](https://linear.app/pbuchman/issue/INT-1530/refactor-workers-layer-unify-bootstrap-observability-and-pubsub)
> **Parent refactor initiative:** [INT-1473](https://linear.app/pbuchman/issue/INT-1473)
> **Source evidence:** `docs/reviews/2026-04-24-refactoring-analysis.md` §2

> **For agentic workers:** This plan is executed in PARALLEL by 8 independent subagents. Each subagent owns exactly ONE service/package/config surface. Subagents must NOT modify files outside their owned paths. All cross-boundary types are pinned by the `packages/common-worker` contract frozen in Section 3 of this document.

---

## 1. Goal

Unify bootstrap, observability, and Pub/Sub ack/nack semantics across the `workers/` layer by (a) extracting shared primitives into a new `@intexuraos/common-worker` package, (b) migrating the three true Cloud Functions (`log-cleanup`, `transcription`, `vm-lifecycle`) to consume that package, (c) adding a consumer ack/nack contract with DLQ support, (d) fixing `vm-lifecycle`'s internal-auth header format, (e) relocating `workers/code-worker` (container image, not a worker), (f) documenting that `workers/orchestrator` is a VM-hosted Fastify service, not a Cloud Function, and (g) continuing the `task-dispatcher.ts` decomposition plus shutdown-loop fix that were started in prior work.

## 2. Non-Goals

- Moving `workers/orchestrator` → `apps/orchestrator`. The orchestrator is VM-hosted (PM2), not Cloud Run, and matches neither deployment target cleanly. Instead this plan updates `.claude/reference/architecture.md` to document three deployment modes (Cloud Run apps, Cloud Functions workers, VM-hosted long-running services).
- Replacing `pino` — `createWorkerLogger()` wraps pino with the same options as today.
- Introducing OTEL — out of scope for this refactor; only Sentry init and structured request logging are added. OTEL is tracked under a sibling INT-1473 subtask.
- Renaming env vars or changing Pub/Sub topic names for existing topics. Only NEW DLQ topics are added.

## 3. Frozen Contract: `@intexuraos/common-worker`

**Every other subtask codes against this API surface. Subtask 1 (the package) implements it. Subtasks 2–4 MAY begin in parallel by stubbing the package locally with the signatures below and replacing the stub with the real import once the package build is green — see each subtask's "Unblocking sequence" note.**

### 3.1 Package layout

```
packages/common-worker/
  package.json
  tsconfig.json
  src/
    index.ts            # barrel export
    logger.ts
    env.ts
    auth.ts
    observability.ts
    testing/
      index.ts          # separate export subpath
      fakeLogger.ts
      cloudEvent.ts
      httpRequest.ts
    __tests__/
      logger.test.ts
      env.test.ts
      auth.test.ts
      observability.test.ts
```

### 3.2 `package.json` (exact)

```json
{
  "name": "@intexuraos/common-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@intexuraos/common-core": "workspace:*",
    "@intexuraos/infra-pubsub": "workspace:*",
    "@intexuraos/infra-sentry": "workspace:*",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@google-cloud/functions-framework": "^3.4.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### 3.3 Public API (exact signatures — DO NOT change during execution)

```typescript
// packages/common-worker/src/logger.ts
export interface WorkerLogger {
  readonly level: string;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): WorkerLogger;
}

export function createWorkerLogger(name: string): WorkerLogger;
// Reads LOG_LEVEL (default 'info'), attaches { worker: name } as base bindings,
// installs serializeError serializer for { error, err } keys (mirrors today's 3 workers).
```

```typescript
// packages/common-worker/src/env.ts
export interface EnvVarSpec {
  readonly required: boolean;
  readonly default?: string;
}
export type EnvSpec = Readonly<Record<string, EnvVarSpec>>;
export type LoadedEnv<T extends EnvSpec> = { readonly [K in keyof T]: string };

export function loadRequiredEnv<T extends EnvSpec>(spec: T): LoadedEnv<T>;
// Throws Error with all missing-required var names listed, at module load.
// NEVER returns silent fallbacks when required=true. Empty string counts as missing.
// If required=false and no default, returns '' (callers must handle).
```

```typescript
// packages/common-worker/src/auth.ts
export function verifyInternalAuth(
  headerValue: string | string[] | undefined,
  expectedToken: string | undefined
): boolean;
// Raw-token comparison using timingSafeEqual.
// Returns false if expectedToken is undefined/empty (config bug is a 401, not a bypass).
// Accepts string | string[] because Cloud Functions / Express headers differ; array takes first element.
// Does NOT accept "Bearer <token>" format — that is the bug being fixed.
```

```typescript
// packages/common-worker/src/observability.ts
import type { CloudEvent } from '@google-cloud/functions-framework';

export const enum AckDecision {
  Ack = 'ack',
  Nack = 'nack',
  DeadLetter = 'dlq',
}

export interface AckResult {
  readonly decision: AckDecision;
  readonly reason?: string;
}

export type CloudEventHandler<D> = (
  event: CloudEvent<D>,
  logger: WorkerLogger
) => Promise<AckResult>;

export interface ObservabilityOptions {
  readonly sentryDsn?: string;
  readonly dlqPublish?: (payload: unknown, reason: string) => Promise<void>;
}

export function withObservability<D>(
  handlerName: string,
  handler: CloudEventHandler<D>,
  opts?: ObservabilityOptions
): (event: CloudEvent<D>) => Promise<void>;
// Contract enforced by withObservability:
//   Ack         → resolve (Pub/Sub ACKs)
//   Nack        → throw (Pub/Sub redelivers; triggers subscription retry policy)
//   DeadLetter  → if opts.dlqPublish provided: publish payload + reason to DLQ and resolve.
//                 If opts.dlqPublish NOT provided: treat as Nack (redeliver) and log a WARN
//                 — never silently ACK.
//   Handler throws → reported to Sentry, re-thrown as Nack.
// Also emits structured "worker_request" log line on entry and exit.
```

```typescript
// packages/common-worker/src/testing/index.ts
export { createFakeLogger, type FakeLogger } from './fakeLogger.js';
export { makePubSubCloudEvent } from './cloudEvent.js';
export { makeHttpRequest, makeHttpResponse } from './httpRequest.js';

// createFakeLogger() returns WorkerLogger + .entries (array of recorded calls).
// makePubSubCloudEvent(payload, overrides?) returns a CloudEvent<PubSubData>
// where payload is JSON-encoded then base64-encoded into event.data.message.data.
// makeHttpRequest / makeHttpResponse are minimal stubs compatible with
// @google-cloud/functions-framework's Request / Response types.
```

### 3.4 Contract compliance test (runs in Subtask 1)

Each worker subtask's tests MUST pass against the real package once Subtask 1 merges. To guarantee this, Subtask 1 ships a `packages/common-worker/src/__tests__/contract.test.ts` that exercises every field and enum variant above so drift is caught in CI.

---

## 4. Parallel Subtask Map (one per service/worker boundary)

| #   | Subtask                                                             | Owns (writable paths)                                                                                                                               | Depends on (types only)                        |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A   | `packages/common-worker`                                            | `packages/common-worker/**`                                                                                                                         | —                                              |
| B   | `workers/log-cleanup` migration                                     | `workers/log-cleanup/**`                                                                                                                            | common-worker contract §3                      |
| C   | `workers/transcription` migration + DLQ publisher                   | `workers/transcription/**`                                                                                                                          | common-worker contract §3                      |
| D   | `workers/vm-lifecycle` migration + auth fix + config fix            | `workers/vm-lifecycle/**`                                                                                                                           | common-worker contract §3                      |
| E   | `workers/orchestrator` task-dispatcher decomposition + shutdown fix | `workers/orchestrator/**`                                                                                                                           | — (no common-worker dep; not a Cloud Function) |
| F   | `code-worker` move                                                  | `docker/code-worker/**` (new), `workers/code-worker/**` (delete), `cloudbuild.yaml`, `apps/code-agent/src/infra/docker/DockerProvider.ts` image ref | —                                              |
| G   | Terraform DLQ topics + subscription dead-letter policies            | `terraform/environments/dev/**.tf` (only new DLQ resources), `terraform/modules/**` if a new module is added                                        | Contract §3.3 topic names                      |
| H   | Documentation + architecture reference                              | `docs/architecture/pubsub-standards.md`, `.claude/reference/architecture.md`                                                                        | Contract §3                                    |

**Parallelism rule:** No two subtasks share writable paths. The only cross-boundary artifact is the **frozen contract in Section 3 of this document**. Subtasks B–D may start immediately against a local interface stub mirroring §3.3 and swap to the real import when Subtask A lands.

**Unblocking sequence for Subtasks B–D (if Subtask A is not yet merged):**
1. Create `src/__shims__/common-worker.ts` containing the exact Section 3.3 signatures re-exported from a local implementation.
2. Import from the shim.
3. When Subtask A's package is on `development`, replace the shim import path with `@intexuraos/common-worker` and delete the shim in one commit. CI must still pass.

---

## 5. Endpoint Changes

**Modified:**
- `POST vm-lifecycle/startVm` — auth header accepted format changes from `Bearer <token>` to raw `<token>` in `X-Internal-Auth` (Subtask D). No caller currently invokes this with `Bearer …`, so no caller update needed; verified by `rg "vm-lifecycle|startVm|stopVm" apps/ workers/`.
- `POST vm-lifecycle/stopVm` — same change as above.

**Created:**
- Pub/Sub DLQ topics (Subtask G):
  - `intexuraos-transcription-audio-stored-dlq-dev`
  - `intexuraos-log-cleanup-dlq-dev`
  - Same topics for `prod` environment.
- Pub/Sub subscriptions (Subtask G): subscriptions for each DLQ topic to drain into BigQuery (log sink) for incident review.

**Removed:** None.

**Unchanged:** All HTTP endpoints on `workers/orchestrator`. The orchestrator's Fastify surface is unaffected by this plan.

---

## 6. Subtask A — `packages/common-worker`

**Owner agent:** Single agent, full write access to `packages/common-worker/**` and `pnpm-workspace.yaml` only.

### Files
- Create: `packages/common-worker/package.json` (exactly as §3.2)
- Create: `packages/common-worker/tsconfig.json` — copy `packages/common-core/tsconfig.json` verbatim
- Create: `packages/common-worker/src/logger.ts`
- Create: `packages/common-worker/src/env.ts`
- Create: `packages/common-worker/src/auth.ts`
- Create: `packages/common-worker/src/observability.ts`
- Create: `packages/common-worker/src/index.ts`
- Create: `packages/common-worker/src/testing/index.ts`
- Create: `packages/common-worker/src/testing/fakeLogger.ts`
- Create: `packages/common-worker/src/testing/cloudEvent.ts`
- Create: `packages/common-worker/src/testing/httpRequest.ts`
- Create: `packages/common-worker/src/__tests__/logger.test.ts`
- Create: `packages/common-worker/src/__tests__/env.test.ts`
- Create: `packages/common-worker/src/__tests__/auth.test.ts`
- Create: `packages/common-worker/src/__tests__/observability.test.ts`
- Create: `packages/common-worker/src/__tests__/contract.test.ts`
- Modify: `pnpm-workspace.yaml` — no change if `packages/*` is already globbed (verify first)

### Step-by-step

- [ ] **A.1 Scaffold package structure**
  ```bash
  mkdir -p packages/common-worker/src/testing packages/common-worker/src/__tests__
  ```
  Copy `packages/common-core/tsconfig.json` and `vitest.config.ts` to the new package. Adjust `compilerOptions.rootDir` only if the copy requires it.

- [ ] **A.2 Write `logger.test.ts` first (failing)**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { createWorkerLogger } from '../logger.js';

  describe('createWorkerLogger', () => {
    it('returns a logger with the configured level', () => {
      process.env.LOG_LEVEL = 'debug';
      const log = createWorkerLogger('test-worker');
      expect(log.level).toBe('debug');
    });

    it('defaults to info when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      const log = createWorkerLogger('test-worker');
      expect(log.level).toBe('info');
    });

    it('supports .child() and preserves bindings', () => {
      const log = createWorkerLogger('test-worker');
      const child = log.child({ traceId: 'abc' });
      expect(typeof child.info).toBe('function');
    });
  });
  ```
  Run: `pnpm --filter @intexuraos/common-worker test` → FAIL (module not found).

- [ ] **A.3 Implement `logger.ts`**
  ```typescript
  import pino from 'pino';
  import { serializeError } from '@intexuraos/common-core';

  export interface WorkerLogger {
    readonly level: string;
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
    debug(obj: object, msg?: string): void;
    child(bindings: Record<string, unknown>): WorkerLogger;
  }

  export function createWorkerLogger(name: string): WorkerLogger {
    return pino({
      level: process.env['LOG_LEVEL'] ?? 'info',
      base: { worker: name },
      formatters: {
        level: (label: string): { level: string } => ({ level: label }),
      },
      serializers: { error: serializeError, err: serializeError },
    }) as unknown as WorkerLogger;
  }
  ```
  Run tests → PASS.

- [ ] **A.4 Write `env.test.ts` first (failing)**
  Test cases that MUST exist:
  1. required var present → returned value matches `process.env[key]`.
  2. required var missing → throws with all missing names in message.
  3. required var empty string → throws (empty counts as missing).
  4. optional var with default + missing → returns default.
  5. optional var without default + missing → returns ''.
  6. multiple missing required vars → single error listing all.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { loadRequiredEnv } from '../env.js';

  describe('loadRequiredEnv', () => {
    it('returns value when required var is set', () => {
      process.env.FOO = 'bar';
      const env = loadRequiredEnv({ FOO: { required: true } });
      expect(env.FOO).toBe('bar');
    });

    it('throws when required var is missing, listing all missing names', () => {
      delete process.env.FOO;
      delete process.env.BAZ;
      expect(() =>
        loadRequiredEnv({ FOO: { required: true }, BAZ: { required: true } })
      ).toThrow(/FOO.*BAZ|BAZ.*FOO/);
    });

    it('throws when required var is empty string', () => {
      process.env.FOO = '';
      expect(() => loadRequiredEnv({ FOO: { required: true } })).toThrow(/FOO/);
    });

    it('returns default when optional var is missing and default is provided', () => {
      delete process.env.FOO;
      const env = loadRequiredEnv({ FOO: { required: false, default: 'd' } });
      expect(env.FOO).toBe('d');
    });

    it('returns empty string when optional var is missing and no default', () => {
      delete process.env.FOO;
      const env = loadRequiredEnv({ FOO: { required: false } });
      expect(env.FOO).toBe('');
    });
  });
  ```

- [ ] **A.5 Implement `env.ts`**
  ```typescript
  export interface EnvVarSpec {
    readonly required: boolean;
    readonly default?: string;
  }
  export type EnvSpec = Readonly<Record<string, EnvVarSpec>>;
  export type LoadedEnv<T extends EnvSpec> = { readonly [K in keyof T]: string };

  export function loadRequiredEnv<T extends EnvSpec>(spec: T): LoadedEnv<T> {
    const missing: string[] = [];
    const out: Record<string, string> = {};
    for (const key of Object.keys(spec)) {
      const entry = spec[key];
      if (entry === undefined) continue;
      const raw = process.env[key];
      if (raw === undefined || raw === '') {
        if (entry.required) {
          missing.push(key);
        } else {
          out[key] = entry.default ?? '';
        }
      } else {
        out[key] = raw;
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(', ')}`
      );
    }
    return out as LoadedEnv<T>;
  }
  ```
  Run tests → PASS.

- [ ] **A.6 Write `auth.test.ts` first (failing)**
  Cases:
  1. raw token matches expected → true.
  2. `Bearer <token>` format → **false** (explicitly rejected; this is the bug we're fixing).
  3. expected undefined → false.
  4. expected empty string → false.
  5. header undefined → false.
  6. header is array → first element used.
  7. timing-safe behavior: unequal-length strings return false without throwing.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { verifyInternalAuth } from '../auth.js';

  describe('verifyInternalAuth', () => {
    it('returns true for matching raw token', () => {
      expect(verifyInternalAuth('secret', 'secret')).toBe(true);
    });
    it('rejects Bearer-prefixed tokens', () => {
      expect(verifyInternalAuth('Bearer secret', 'secret')).toBe(false);
    });
    it('returns false when expected is undefined', () => {
      expect(verifyInternalAuth('secret', undefined)).toBe(false);
    });
    it('returns false when expected is empty', () => {
      expect(verifyInternalAuth('secret', '')).toBe(false);
    });
    it('returns false when header is undefined', () => {
      expect(verifyInternalAuth(undefined, 'secret')).toBe(false);
    });
    it('uses first element of array header', () => {
      expect(verifyInternalAuth(['secret', 'other'], 'secret')).toBe(true);
    });
    it('returns false for unequal-length strings without throwing', () => {
      expect(verifyInternalAuth('s', 'secret')).toBe(false);
    });
  });
  ```

- [ ] **A.7 Implement `auth.ts`**
  ```typescript
  import { timingSafeEqual } from 'node:crypto';

  export function verifyInternalAuth(
    headerValue: string | string[] | undefined,
    expectedToken: string | undefined
  ): boolean {
    if (expectedToken === undefined || expectedToken === '') return false;
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (header === undefined || header === '') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(expectedToken);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  ```
  Run tests → PASS.

- [ ] **A.8 Write `observability.test.ts` first (failing)**
  Cases:
  1. handler returns `{decision: Ack}` → wrapper resolves without throwing.
  2. handler returns `{decision: Nack}` → wrapper throws.
  3. handler returns `{decision: DeadLetter}` with `dlqPublish` provided → `dlqPublish` called with payload + reason, wrapper resolves.
  4. handler returns `{decision: DeadLetter}` without `dlqPublish` → wrapper throws (degrades to Nack), WARN logged.
  5. handler throws → Sentry captured, wrapper re-throws.
  6. `worker_request` start/finish log entries emitted.

  Use `createFakeLogger()` from testing helpers (implemented in step A.10).

- [ ] **A.9 Implement `observability.ts`**
  ```typescript
  import type { CloudEvent } from '@google-cloud/functions-framework';
  import type { WorkerLogger } from './logger.js';

  export const enum AckDecision {
    Ack = 'ack',
    Nack = 'nack',
    DeadLetter = 'dlq',
  }
  export interface AckResult {
    readonly decision: AckDecision;
    readonly reason?: string;
  }
  export type CloudEventHandler<D> = (
    event: CloudEvent<D>,
    logger: WorkerLogger
  ) => Promise<AckResult>;
  export interface ObservabilityOptions {
    readonly sentryDsn?: string;
    readonly dlqPublish?: (payload: unknown, reason: string) => Promise<void>;
  }

  export function withObservability<D>(
    handlerName: string,
    handler: CloudEventHandler<D>,
    opts: ObservabilityOptions = {}
  ): (event: CloudEvent<D>) => Promise<void> {
    return async (event: CloudEvent<D>): Promise<void> => {
      const logger = /* inject via closure or module-level createWorkerLogger(handlerName) */;
      logger.info({ event: 'worker_request_start', handlerName, eventId: event.id }, 'worker request start');
      try {
        const result = await handler(event, logger);
        if (result.decision === AckDecision.Ack) {
          logger.info({ event: 'worker_request_ack', handlerName, eventId: event.id }, 'ack');
          return;
        }
        if (result.decision === AckDecision.Nack) {
          logger.warn(
            { event: 'worker_request_nack', handlerName, eventId: event.id, reason: result.reason },
            'nack'
          );
          throw new Error(`nack: ${result.reason ?? 'unspecified'}`);
        }
        // DeadLetter
        if (opts.dlqPublish !== undefined) {
          await opts.dlqPublish(event.data, result.reason ?? 'dlq');
          logger.warn(
            { event: 'worker_request_dlq', handlerName, eventId: event.id, reason: result.reason },
            'dead-lettered'
          );
          return;
        }
        logger.warn(
          { event: 'worker_request_dlq_missing_publisher', handlerName, eventId: event.id, reason: result.reason },
          'DLQ requested but no publisher configured — degrading to nack'
        );
        throw new Error(`dlq (no publisher): ${result.reason ?? 'unspecified'}`);
      } catch (error) {
        logger.error({ event: 'worker_request_error', handlerName, error }, 'handler threw');
        // Sentry capture if opts.sentryDsn set (wire via @intexuraos/infra-sentry)
        throw error;
      }
    };
  }
  ```
  NB: the logger acquisition line above is illustrative — implement by taking a `WorkerLogger` via `createWorkerLogger(handlerName)` at module scope and passing it into the handler closure.

- [ ] **A.10 Implement `testing/` helpers**
  `fakeLogger.ts`:
  ```typescript
  import type { WorkerLogger } from '../logger.js';
  export interface FakeLogger extends WorkerLogger {
    readonly entries: Array<{ level: string; obj: object; msg?: string }>;
  }
  export function createFakeLogger(level = 'debug'): FakeLogger {
    const entries: FakeLogger['entries'] = [];
    const rec = (lvl: string) => (obj: object, msg?: string) => entries.push({ level: lvl, obj, msg });
    const logger: FakeLogger = {
      level,
      entries,
      info: rec('info'),
      warn: rec('warn'),
      error: rec('error'),
      debug: rec('debug'),
      child: () => createFakeLogger(level),
    };
    return logger;
  }
  ```
  `cloudEvent.ts`:
  ```typescript
  import type { CloudEvent } from '@google-cloud/functions-framework';
  interface PubSubData { message: { data?: string; attributes?: Record<string, string> } }
  export function makePubSubCloudEvent<T>(
    payload: T,
    overrides: Partial<CloudEvent<PubSubData>> = {}
  ): CloudEvent<PubSubData> {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    return {
      id: overrides.id ?? 'test-event-id',
      source: overrides.source ?? 'test',
      type: overrides.type ?? 'google.cloud.pubsub.topic.v1.messagePublished',
      specversion: '1.0',
      data: { message: { data, attributes: {} } },
      ...overrides,
    } as CloudEvent<PubSubData>;
  }
  ```
  `httpRequest.ts`:
  ```typescript
  import type { Request, Response } from '@google-cloud/functions-framework';
  export function makeHttpRequest(init: Partial<Request>): Request {
    return { method: 'POST', headers: {}, body: {}, ...init } as Request;
  }
  export function makeHttpResponse(): Response & { _status?: number; _body?: unknown } {
    const res: Partial<Response> & { _status?: number; _body?: unknown } = {};
    res.status = (code: number) => { res._status = code; return res as Response; };
    res.json = (body: unknown) => { res._body = body; return res as Response; };
    return res as Response & { _status?: number; _body?: unknown };
  }
  ```

- [ ] **A.11 Write `contract.test.ts`** — exercises every exported symbol and every `AckDecision` variant so future changes to §3.3 fail CI.

- [ ] **A.12 Wire barrel export `index.ts`**
  ```typescript
  export * from './logger.js';
  export * from './env.js';
  export * from './auth.js';
  export * from './observability.js';
  ```

- [ ] **A.13 Verify workspace resolves the package**
  ```bash
  pnpm install
  pnpm --filter @intexuraos/common-worker test
  pnpm --filter @intexuraos/common-worker typecheck
  pnpm --filter @intexuraos/common-worker lint:local
  ```
  All three must pass.

- [ ] **A.14 Coverage gate**
  ```bash
  pnpm --filter @intexuraos/common-worker test:coverage
  ```
  Must hit 95% branch coverage; add tests rather than `/* v8 ignore */` unless the exemption is one of the valid categories in `.claude/reference/coverage-exemptions.md`.

- [ ] **A.15 Commit (see "Commits & PR" section below)**

---

## 7. Subtask B — `workers/log-cleanup` migration

**Owner agent:** full write access to `workers/log-cleanup/**` only.

### Files
- Modify: `workers/log-cleanup/package.json` — add `"@intexuraos/common-worker": "workspace:*"`.
- Delete: `workers/log-cleanup/src/logger.ts`.
- Modify: `workers/log-cleanup/src/index.ts` — import from `@intexuraos/common-worker`, wrap handler with `withObservability`. `cleanupLogs` currently throws on failure; translate to `{decision: Nack}` for identical on-the-wire behavior (throw → redelivery). No DLQ needed (scheduled job, redelivery is the safe default).
- Modify: `workers/log-cleanup/src/cleanup.ts` — replace `import { logger } from './logger.js'` with imports from `@intexuraos/common-worker`; inject logger as a parameter so the module has no module-level logger dependency (testability).
- Modify: `workers/log-cleanup/src/__tests__/*` — use `createFakeLogger()` from `@intexuraos/common-worker/testing`.

### Contract translation table
| Old behavior (`workers/log-cleanup/src/index.ts:38`)   | New behavior                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `throw new Error(result.message)` on cleanup failure   | `return { decision: AckDecision.Nack, reason: result.message }` |
| Normal success                                         | `return { decision: AckDecision.Ack }`                          |

### Step-by-step

- [ ] **B.1 Write a failing test for the new handler shape**
  File: `workers/log-cleanup/src/__tests__/index.test.ts` (new or extended). Use `makePubSubCloudEvent` and verify the handler returns `{decision: Ack}` on success and `{decision: Nack}` on failure. Run → FAIL (handler doesn't yet match new shape).

- [ ] **B.2 Update `index.ts`**
  ```typescript
  import * as functions from '@google-cloud/functions-framework';
  import type { CloudEvent } from '@google-cloud/functions-framework';
  import {
    createWorkerLogger,
    withObservability,
    AckDecision,
    type AckResult,
  } from '@intexuraos/common-worker';
  import { cleanupOldLogs } from './cleanup.js';

  interface PubSubData {
    message: { data?: string; attributes?: Record<string, string> };
  }

  const logger = createWorkerLogger('log-cleanup');

  export async function handleCleanupLogs(
    event: CloudEvent<PubSubData>,
    log = logger
  ): Promise<AckResult> {
    const traceId = event.id;
    log.info(
      { traceId, eventType: event.type, source: event.source },
      'Log cleanup triggered by Pub/Sub'
    );
    const result = await cleanupOldLogs(log);
    if (result.success) {
      log.info(
        { traceId, tasksProcessed: result.tasksProcessed, logsDeleted: result.logsDeleted, durationMs: result.durationMs },
        'Log cleanup completed successfully'
      );
      return { decision: AckDecision.Ack };
    }
    log.error({ traceId, error: result.message, durationMs: result.durationMs }, 'Log cleanup failed');
    return { decision: AckDecision.Nack, reason: result.message };
  }

  functions.cloudEvent('cleanupLogs', withObservability('log-cleanup', handleCleanupLogs));
  ```

- [ ] **B.3 Update `cleanup.ts`** — accept `log: WorkerLogger` parameter, remove `import { logger } from './logger.js'`.

- [ ] **B.4 Delete `workers/log-cleanup/src/logger.ts`.**

- [ ] **B.5 Update tests to use `createFakeLogger()` + `makePubSubCloudEvent()`.**

- [ ] **B.6 Run `pnpm run verify:workspace:tracked -- log-cleanup`.** Coverage must stay ≥95%.

- [ ] **B.7 Commit.**

---

## 8. Subtask C — `workers/transcription` migration + DLQ

**Owner agent:** full write access to `workers/transcription/**` only.

### Files
- Modify: `workers/transcription/package.json` — add `"@intexuraos/common-worker": "workspace:*"`.
- Delete: `workers/transcription/src/logger.ts`.
- Create: `workers/transcription/src/publishers/transcription-dlq-publisher.ts` (extends `BasePubSubPublisher`).
- Modify: `workers/transcription/src/index.ts` — replace silent-ACK returns with `{decision: DeadLetter}` for parse/schema failures.
- Modify: `workers/transcription/src/types.ts` — `loadConfig()` to use `loadRequiredEnv()`; add `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC` as required.
- Modify: `workers/transcription/src/main.ts` — inject logger via parameter (already does); no signature change.
- Modify: `workers/transcription/src/__tests__/*` — use common-worker testing helpers; add DLQ test cases.

### Contract translation table
| Old behavior                                                          | New behavior                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `messageData === undefined` → `return` (silent ACK)                   | `return { decision: DeadLetter, reason: 'missing_message_data' }`   |
| JSON parse throws → `return` (silent ACK)                             | `return { decision: DeadLetter, reason: 'parse_error' }`            |
| `audioEvent.type !== 'whatsapp.audio.stored'` → `return` (silent ACK) | `return { decision: DeadLetter, reason: 'unexpected_event_type' }`  |
| `!isAudioStoredEvent(audioEvent)` → `return` (silent ACK)             | `return { decision: DeadLetter, reason: 'invalid_event_schema' }`   |
| Successful transcription publish                                      | `return { decision: Ack }`                                          |
| Transcription or downstream throws                                    | Let it propagate → `withObservability` turns into Nack (redelivery) |

### Step-by-step

- [ ] **C.1 Test: DLQ is called when message.data is missing**
  ```typescript
  it('dead-letters when message data is missing', async () => {
    const dlq = vi.fn().mockResolvedValue(undefined);
    const handler = withObservability('transcription', handleAudioStored, { dlqPublish: dlq });
    await handler(makePubSubCloudEvent({}, { /* strip .data.message.data */ }) as any);
    expect(dlq).toHaveBeenCalledWith(expect.anything(), 'missing_message_data');
  });
  ```
  Run → FAIL.

- [ ] **C.2 Write `transcription-dlq-publisher.ts`** extending `BasePubSubPublisher`; topic name injected via `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC`. Test with `nock`-style fake publisher per existing patterns in `transcription-completed-publisher.ts`.

- [ ] **C.3 Refactor `loadConfig()` in `types.ts` to use `loadRequiredEnv()`.** New required var: `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC`.

- [ ] **C.4 Refactor `handleAudioStored` to return `AckResult`** and wrap with `withObservability`, passing `dlqPublish: (payload, reason) => dlqPublisher.publish({payload, reason})`.

- [ ] **C.5 Delete `workers/transcription/src/logger.ts`; replace imports across `main.ts`, `polling.ts`, `format-error.ts`, `providers/*`, `publishers/*`.**

- [ ] **C.6 Add tests for all four DLQ paths + one Ack path + one Nack path (when `transcribeAudio` throws).**

- [ ] **C.7 Run `pnpm run verify:workspace:tracked -- transcription`.** 95% coverage.

- [ ] **C.8 Commit.**

### Env var wiring (coordinates with Subtask G)
- Add `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC` to:
  - `workers/transcription/package.json`? (No — env vars are not declared there.)
  - `terraform/environments/dev/main.tf` — handled in Subtask G.
  - Subtask C declares the env var is required in `types.ts`. Deployment wiring is Subtask G's responsibility.

---

## 9. Subtask D — `workers/vm-lifecycle` migration + auth fix + config fix

**Owner agent:** full write access to `workers/vm-lifecycle/**` only.

### Files
- Modify: `workers/vm-lifecycle/package.json` — add `@intexuraos/common-worker`.
- Delete: `workers/vm-lifecycle/src/logger.ts`.
- Modify: `workers/vm-lifecycle/src/index.ts` — replace `validateAuth` with `verifyInternalAuth(req.headers['x-internal-auth'], process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'])` (raw token, not Bearer).
- Modify: `workers/vm-lifecycle/src/config.ts` — use `loadRequiredEnv()`; make `INTEXURAOS_GCP_PROJECT_ID`, `INTEXURAOS_VM_ZONE`, `INTEXURAOS_VM_INSTANCE_NAME`, `INTEXURAOS_VM_HEALTH_URL`, `INTEXURAOS_VM_SHUTDOWN_URL` REQUIRED. Timeout constants stay as literals.
- Modify: `workers/vm-lifecycle/src/__tests__/*` — test the new auth format; regression test that `Bearer <token>` is now rejected.

### Step-by-step

- [ ] **D.1 Write failing test: raw token accepted, Bearer rejected.**
- [ ] **D.2 Write failing test: missing `INTEXURAOS_GCP_PROJECT_ID` throws at module load (no silent default).**
- [ ] **D.3 Refactor `index.ts` to use `verifyInternalAuth`; delete `validateAuth()`.**
- [ ] **D.4 Refactor `config.ts` to `loadRequiredEnv`; export `VM_CONFIG` with identical key names.**
- [ ] **D.5 Delete `logger.ts`; swap imports in `start-vm.ts`, `stop-vm.ts`.**
- [ ] **D.6 Run `pnpm run verify:workspace:tracked -- vm-lifecycle`.**
- [ ] **D.7 Commit.**

### Migration warning — operational
The auth header format change is breaking for any external caller. Audit with `rg -n "x-internal-auth|X-Internal-Auth" apps/ workers/ packages/`. Current audit (2026-04-24) shows zero callers of `vm-lifecycle/startVm` or `/stopVm` pass `Bearer …`; if a caller is found, update it in the SAME subtask (path `apps/<service>/src/infra/**` OR delegate back to planner for cross-service change).

---

## 10. Subtask E — `workers/orchestrator` task-dispatcher decomposition + shutdown fix

**Owner agent:** full write access to `workers/orchestrator/**` only. **No dependency on common-worker — the orchestrator is a long-running Fastify service, not a Cloud Function. It has its own logger, its own env validation, its own request logger. Keep it that way.**

### Files
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts` — reduce from 3,030 → <400 lines by extracting 4 modules into existing `task-dispatcher/` folder.
- Create: `workers/orchestrator/src/services/task-dispatcher/task-runner.ts` — per-attempt execution (spawn docker, pipe logs).
- Create: `workers/orchestrator/src/services/task-dispatcher/task-timers.ts` — idle/attempt timeouts with AbortController integration.
- Create: `workers/orchestrator/src/services/task-dispatcher/attempt-lifecycle.ts` — attempt state transitions (persists via existing `lifecycle.ts`, but owns orchestration).
- Create: `workers/orchestrator/src/services/task-dispatcher/completion-pipeline.ts` — success/failure pipeline (save summary, publish completion, emit metrics).
- Modify: `workers/orchestrator/src/main.ts` — shutdown hook: replace `while (inFlight.size > 0) await sleep(…)` with `Promise.race([inFlightAllSettled, timeoutPromise])`, thread a top-level `AbortController` down to `TaskRunner`, remove the `save(await load())` no-op. Reconcile `SHUTDOWN_TIMEOUT_MS` with `ecosystem.config.cjs` `kill_timeout`.

### Boundary rule for this subtask
- Do NOT change public exports of `task-dispatcher.ts` unless the call site imports can be updated in the same commit.
- Do NOT modify `apps/**` — the orchestrator is invoked via HTTP from code-agent; HTTP surface is unchanged.
- Tests live under `workers/orchestrator/src/services/task-dispatcher/__tests__/`.

### Step-by-step

- [ ] **E.1 Inventory the 3,030-line file.** Produce a symbol map (class members, free functions) in a scratch doc so extraction targets are explicit.
- [ ] **E.2 Extract `TaskRunner` — TDD.** Write unit test for "runs an attempt and streams logs to sink"; extract minimal code; green.
- [ ] **E.3 Extract `TaskTimers` with AbortController wiring — TDD.** Test: abort signal cancels pending timers.
- [ ] **E.4 Extract `AttemptLifecycle` — TDD.**
- [ ] **E.5 Extract `CompletionPipeline` — TDD.**
- [ ] **E.6 Verify `task-dispatcher.ts` is <400 lines and green.**
- [ ] **E.7 Shutdown refactor: add `AbortController` in `main.ts`, pass to `TaskTimers` and `TaskRunner`. Replace the polling loop at `main.ts:300-338` (or equivalent post-extraction location) with `Promise.race`. Remove `save(await load())`.**
- [ ] **E.8 Reconcile `SHUTDOWN_TIMEOUT_MS` with `ecosystem.config.cjs` `kill_timeout`** — read current `kill_timeout`, ensure `SHUTDOWN_TIMEOUT_MS < kill_timeout` by ≥2s, document in `workers/orchestrator/DEPLOYMENT.md`.
- [ ] **E.9 Run full orchestrator CI: `pnpm run verify:workspace:tracked -- orchestrator`.**
- [ ] **E.10 Commit.**

---

## 11. Subtask F — `code-worker` relocation

**Owner agent:** full write access to `docker/code-worker/**`, `workers/code-worker/**` (for deletion), `cloudbuild.yaml`, and the single DockerProvider image reference.

### Files
- Move: `workers/code-worker/**` → `docker/code-worker/**` (preserve contents: Dockerfiles only — there is no `src/` or `package.json`).
- Modify: Root `cloudbuild.yaml` and/or `workers/code-worker/cloudbuild.yaml` — update build context paths from `workers/code-worker` → `docker/code-worker`.
- Modify: The one caller that references the image name/path — locate via `rg -n "code-worker" apps/ workers/ terraform/ cloudbuild.yaml` before editing. Expected hits: `apps/code-agent/src/infra/docker/DockerProvider.ts` (image tag only — path change does NOT affect the image name unless Cloud Build changes the artifact name).

### Step-by-step

- [ ] **F.1 Audit all references to the `workers/code-worker` path.**
  ```bash
  rg -n "workers/code-worker" .
  ```
  Record the hit list. Every hit MUST be updated in this subtask.
- [ ] **F.2 `mkdir -p docker && git mv workers/code-worker docker/code-worker`.**
- [ ] **F.3 Update every hit from step F.1.**
- [ ] **F.4 Update `.claude/reference/architecture.md` to reflect that `docker/` is now a top-level folder for container-image-only builds.** (Coordinate with Subtask H to avoid conflict: Subtask F edits only the directory listing; Subtask H edits the deployment-modes section.)
- [ ] **F.5 Dry-run the cloudbuild.yaml context: `gcloud builds submit --no-source --config=cloudbuild.yaml --dry-run` if available, else diff the YAML and reason about correctness.**
- [ ] **F.6 Run `pnpm run ci:tracked` — must pass.**
- [ ] **F.7 Commit.**

---

## 12. Subtask G — Terraform DLQ topics + subscription dead-letter policies

**Owner agent:** full write access to `terraform/**` only.

### Files
- Modify: `terraform/environments/dev/main.tf` — add DLQ topic resources and update existing subscription resources for `transcription` (audio-stored subscription) and `log-cleanup` with `dead_letter_policy`.
- Modify: `terraform/environments/prod/main.tf` — same pattern.
- Modify: `ecosystem.config.cjs` is NOT touched (workers are Cloud Functions, not PM2).
- Modify: `apps/<service>`/terraform env var injection — each Cloud Function's runtime env needs `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC`. Add to the Terraform `google_cloudfunctions2_function` resource for `transcription` only.

### Resources to add (dev)
```hcl
resource "google_pubsub_topic" "transcription_dlq" {
  name    = "intexuraos-transcription-audio-stored-dlq-dev"
  project = var.project_id
}

resource "google_pubsub_topic" "log_cleanup_dlq" {
  name    = "intexuraos-log-cleanup-dlq-dev"
  project = var.project_id
}

# Apply dead_letter_policy to the existing transcription subscription
# (modify existing google_pubsub_subscription resource — do NOT duplicate):
# dead_letter_policy {
#   dead_letter_topic     = google_pubsub_topic.transcription_dlq.id
#   max_delivery_attempts = 5
# }
```
Mirror in `prod`.

### Step-by-step

- [ ] **G.1 Locate the existing subscription resources** via `rg -n "audio-stored|log-cleanup" terraform/`.
- [ ] **G.2 Add DLQ topic resources.**
- [ ] **G.3 Add `dead_letter_policy` blocks to the two subscriptions.**
- [ ] **G.4 Add `INTEXURAOS_PUBSUB_TRANSCRIPTION_DLQ_TOPIC` to transcription function env.**
- [ ] **G.5 Run `terraform fmt && terraform validate` under both `dev/` and `prod/`.**
- [ ] **G.6 `terraform plan -var-file=…`** — paste plan summary into PR body.
- [ ] **G.7 Commit.** (Do NOT apply; PR reviewer applies.)

---

## 13. Subtask H — Documentation

**Owner agent:** full write access to `docs/architecture/pubsub-standards.md` and `.claude/reference/architecture.md`.

### Files
- Modify: `docs/architecture/pubsub-standards.md` — add a new "Consumer Contract" section after the existing "Creating a New Publisher" section. Documents Ack/Nack/DeadLetter semantics and the `withObservability` contract from §3.3 of this plan.
- Modify: `.claude/reference/architecture.md` — expand "Apps vs Workers" table to three columns: Cloud Run Apps | Cloud Functions Workers | VM-Hosted Services (orchestrator). Clarify that `workers/orchestrator` is a long-running Fastify service running under PM2 on a VM and does NOT use the Cloud Functions framework.

### Step-by-step

- [ ] **H.1 Write the Consumer Contract section** including the translation table from §8 (transcription) as a worked example.
- [ ] **H.2 Update architecture.md three-column table.** Add new row to the directory-structure listing: `docker/    → Container images (code-worker, etc.)`.
- [ ] **H.3 `pnpm run ci:tracked` (lint/docs checks).**
- [ ] **H.4 Commit.**

---

## 14. Acceptance Criteria (plan-level, enforced in the merge PR)

A single integration PR that merges all eight subtask branches is considered complete when ALL of the following hold. The planner verifies each item in the PR description.

1. `packages/common-worker` builds, tests pass, ≥95% branch coverage.
2. `workers/log-cleanup/src/logger.ts`, `workers/transcription/src/logger.ts`, `workers/vm-lifecycle/src/logger.ts` do NOT exist.
3. `rg -n "validateRequiredEnv|loadConfig\(\)" workers/` shows the three migrated workers all use `loadRequiredEnv` from `@intexuraos/common-worker` (no hand-rolled validators).
4. `rg -n 'Bearer \$\{' workers/vm-lifecycle/` returns zero matches.
5. `workers/transcription` publishes to a DLQ topic on every path that was previously `return` after parse/schema failure. Verified by unit tests with `createFakeLogger` + fake publisher.
6. Terraform `dev` and `prod` both contain `google_pubsub_topic.transcription_dlq`, `google_pubsub_topic.log_cleanup_dlq`, and `dead_letter_policy` blocks on the corresponding subscriptions.
7. `wc -l workers/orchestrator/src/services/task-dispatcher.ts` < 400.
8. `workers/orchestrator/src/main.ts` contains no `while (…await sleep…)` polling and threads an `AbortController` to in-flight handlers.
9. `docker/code-worker/` exists; `workers/code-worker/` does not; `rg -n "workers/code-worker" .` returns zero matches.
10. `docs/architecture/pubsub-standards.md` contains a "Consumer Contract" section documenting Ack/Nack/DeadLetter.
11. `.claude/reference/architecture.md` describes three deployment modes (Cloud Run, Cloud Functions, VM-hosted).
12. `pnpm run ci:tracked` passes at the repo root.

---

## 15. Test Plan

- **Subtask A:** Unit tests for every exported symbol; contract test locks the §3.3 API surface.
- **Subtask B:** Unit test covers Ack path, Nack path (failure), CloudEvent wiring via `makePubSubCloudEvent`.
- **Subtask C:** Unit tests cover 4 DLQ paths, 1 Ack path, 1 Nack path. DLQ publisher tested in isolation with fake Pub/Sub publisher (pattern from existing `transcription-completed-publisher` tests).
- **Subtask D:** Unit tests cover raw-token accepted, `Bearer` rejected, missing token → 401, wrong method → 405. Config test: missing required env throws at module load.
- **Subtask E:** Unit tests for each extracted module; integration test: sending SIGTERM during in-flight attempt triggers AbortController, attempt exits within `SHUTDOWN_TIMEOUT_MS`, `kill_timeout` never fires.
- **Subtask F:** CI build pipeline exercises the new `docker/code-worker` path; assertion test that DockerProvider references the correct image name.
- **Subtask G:** `terraform plan` is idempotent after apply (zero diff).
- **Subtask H:** Docs lint only (no behavioral test).

Integration: after all subtask branches merge to the integration branch, run:
```bash
pnpm run ci:tracked
pnpm run verify:workspace:tracked -- common-worker log-cleanup transcription vm-lifecycle orchestrator
```

---

## 16. Commits & PR structure

Each subtask is executed in its own branch named `refactor/int-1530-<subtask-letter>-<slug>`. PRs target `development` and follow the monorepo's cross-linking format (title `[INT-1530] …`, body `Fixes INT-1530`). Subtasks A, H can merge first; B/C/D after A is on `development`; E/F/G can merge independently of each other at any time.

Planning PR (this plan document): branch `plan/int-1530-workers-refactor`, single commit adding `docs/plans/2026-04-24-workers-layer-refactor.md`.

---

## 17. Out of scope / deferred

- OTEL tracing: tracked under a separate INT-1473 subtask.
- Orchestrator → `apps/` physical move: intentionally deferred; architecture doc updated instead.
- Replacing the static `INTEXURAOS_INTERNAL_AUTH_TOKEN` with short-lived tokens: see §3 of the refactoring analysis.
- Rotating all 23 services' internal auth tokens: blocked on OIDC migration.
