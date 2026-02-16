# Dash0 OpenTelemetry Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OpenTelemetry instrumentation to all IntexuraOS services, sending traces, metrics, and logs to Dash0 in both dev (PM2) and prod (Cloud Run) environments.

**Architecture:** A new `packages/infra-otel` package provides a preload module loaded via Node's `--import` flag before any app code. It auto-instruments Fastify, HTTP, Pino, and undici, then exports telemetry to Dash0 via OTLP/HTTP. When Dash0 env vars are absent (CI, tests), the module is a no-op.

**Tech Stack:** `@opentelemetry/sdk-node`, `@opentelemetry/exporter-*-otlp-http`, auto-instrumentation packages for Fastify/HTTP/Pino/undici/dns/net.

**Design doc:** `docs/plans/2026-02-16-dash0-integration-design.md`

---

## Task 1: Create `packages/infra-otel` Package Scaffolding

**Files:**
- Create: `packages/infra-otel/package.json`
- Create: `packages/infra-otel/tsconfig.json`
- Create: `packages/infra-otel/tsconfig.test.json`
- Create: `packages/infra-otel/vitest.config.ts`
- Create: `packages/infra-otel/src/index.ts`

**Step 1: Create `package.json`**

```json
{
  "name": "@intexuraos/infra-otel",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "exports": {
    ".": "./src/index.ts",
    "./register": "./src/register.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:tests": "tsc --noEmit -p tsconfig.test.json",
    "lint:local": "eslint src --max-warnings 0",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.57.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.57.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.57.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.57.0",
    "@opentelemetry/resources": "^1.30.0",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "@opentelemetry/instrumentation-http": "^0.57.0",
    "@opentelemetry/instrumentation-fastify": "^0.44.0",
    "@opentelemetry/instrumentation-pino": "^0.46.0",
    "@opentelemetry/instrumentation-undici": "^0.10.0",
    "@opentelemetry/instrumentation-dns": "^0.43.0",
    "@opentelemetry/instrumentation-net": "^0.43.0"
  }
}
```

> **Note:** Version numbers are approximate. Run `pnpm add` to get the latest compatible versions. The OTel ecosystem versions must be compatible with each other — check the [OTel JS compatibility matrix](https://github.com/open-telemetry/opentelemetry-js#package-compatibility).

**Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "src/__tests__"]
}
```

**Step 3: Create `tsconfig.test.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

**Step 4: Create `vitest.config.ts`**

Use the same pattern as `packages/internal-clients/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/__tests__/**', '**/dist/**', '**/node_modules/**'],
    },
  },
});
```

**Step 5: Create `src/index.ts`**

```typescript
export { buildOtelConfig, type OtelConfig } from './config.js';
export { getInstrumentations } from './instrumentations.js';
```

**Step 6: Install dependencies**

```bash
cd packages/infra-otel && pnpm install
```

**Step 7: Verify typecheck**

```bash
pnpm run --filter @intexuraos/infra-otel typecheck
```

Expected: PASS (only index.ts with re-exports, source files not yet created — will get errors for missing modules, that's expected at this step. Move to Task 2.)

**Step 8: Commit**

```bash
git add packages/infra-otel/
git commit -m "feat(infra-otel): scaffold infra-otel package"
```

---

## Task 2: Implement `config.ts` (with TDD)

**Files:**
- Create: `packages/infra-otel/src/config.ts`
- Create: `packages/infra-otel/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildOtelConfig } from '../config.js';

describe('buildOtelConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', '');
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is not set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');
    const config = buildOtelConfig();
    expect(config).toBeUndefined();
  });

  it('returns undefined when INTEXURAOS_DASH0_OTLP_ENDPOINT is empty string', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');
    const config = buildOtelConfig();
    expect(config).toBeUndefined();
  });

  it('returns config when endpoint is set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'https://ingress.eu1.dash0.com');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', 'test-token');
    vi.stubEnv('INTEXURAOS_ENVIRONMENT', 'dev');

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    expect(config!.endpoint).toBe('https://ingress.eu1.dash0.com');
    expect(config!.authToken).toBe('test-token');
    expect(config!.environment).toBe('dev');
  });

  it('defaults environment to "unknown" when not set', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'https://ingress.eu1.dash0.com');
    vi.stubEnv('INTEXURAOS_DASH0_AUTH_TOKEN', 'test-token');

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    expect(config!.environment).toBe('unknown');
  });

  it('returns config even when auth token is empty (allows unauthenticated endpoints)', () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', 'http://localhost:4318');

    const config = buildOtelConfig();

    expect(config).toBeDefined();
    expect(config!.authToken).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/config.test.ts
```

Expected: FAIL — `buildOtelConfig` not found.

**Step 3: Implement `config.ts`**

```typescript
export interface OtelConfig {
  readonly endpoint: string;
  readonly authToken: string;
  readonly environment: string;
}

export function buildOtelConfig(): OtelConfig | undefined {
  const endpoint = process.env['INTEXURAOS_DASH0_OTLP_ENDPOINT'];
  if (endpoint === undefined || endpoint === '') {
    return undefined;
  }

  return {
    endpoint,
    authToken: process.env['INTEXURAOS_DASH0_AUTH_TOKEN'] ?? '',
    environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'unknown',
  };
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/config.test.ts
```

Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add packages/infra-otel/src/config.ts packages/infra-otel/src/__tests__/config.test.ts
git commit -m "feat(infra-otel): add config.ts with env var parsing"
```

---

## Task 3: Implement `instrumentations.ts` (with TDD)

**Files:**
- Create: `packages/infra-otel/src/instrumentations.ts`
- Create: `packages/infra-otel/src/__tests__/instrumentations.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { getInstrumentations } from '../instrumentations.js';

describe('getInstrumentations', () => {
  it('returns an array of instrumentation instances', () => {
    const instrumentations = getInstrumentations();

    expect(Array.isArray(instrumentations)).toBe(true);
    expect(instrumentations.length).toBeGreaterThan(0);
  });

  it('includes HTTP instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-http');
  });

  it('includes Fastify instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-fastify');
  });

  it('includes Pino instrumentation', () => {
    const instrumentations = getInstrumentations();
    const names = instrumentations.map((i) => i.instrumentationName);

    expect(names).toContain('@opentelemetry/instrumentation-pino');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/instrumentations.test.ts
```

Expected: FAIL — `getInstrumentations` not found.

**Step 3: Implement `instrumentations.ts`**

```typescript
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';

export function getInstrumentations(): Instrumentation[] {
  return [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
    new PinoInstrumentation(),
    new UndiciInstrumentation(),
    new DnsInstrumentation(),
    new NetInstrumentation(),
  ];
}
```

> **Note:** Import paths and class names may vary by package version. Check each package's README if imports fail. The `@opentelemetry/instrumentation` base package provides the `Instrumentation` type.

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/instrumentations.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/infra-otel/src/instrumentations.ts packages/infra-otel/src/__tests__/instrumentations.test.ts
git commit -m "feat(infra-otel): add instrumentations.ts with auto-instrumentation list"
```

---

## Task 4: Implement `register.ts`

**Files:**
- Create: `packages/infra-otel/src/register.ts`
- Create: `packages/infra-otel/src/__tests__/register.test.ts`

This is the preload module. It must be a self-contained entry point that:
1. Reads env vars via `buildOtelConfig()`
2. If no config → exit silently (no-op)
3. If config → start the OTel NodeSDK with exporters and instrumentations

**Step 1: Write the failing test (no-op path only)**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('register (no-op path)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not throw when endpoint is not configured', async () => {
    vi.stubEnv('INTEXURAOS_DASH0_OTLP_ENDPOINT', '');

    // Dynamic import to test the module's top-level execution
    await expect(import('../register.js')).resolves.not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/register.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `register.ts`**

```typescript
/* v8 ignore module-init -- OTel SDK bootstrap requires live collector for integration testing */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { buildOtelConfig } from './config.js';
import { getInstrumentations } from './instrumentations.js';

const config = buildOtelConfig();

if (config !== undefined) {
  const headers: Record<string, string> = {};
  if (config.authToken !== '') {
    headers['Authorization'] = `Bearer ${config.authToken}`;
  }

  const exporterOptions = {
    url: `${config.endpoint}/v1/traces`,
    headers,
  };

  const traceExporter = new OTLPTraceExporter({
    ...exporterOptions,
    url: `${config.endpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    ...exporterOptions,
    url: `${config.endpoint}/v1/metrics`,
  });

  const logExporter = new OTLPLogExporter({
    ...exporterOptions,
    url: `${config.endpoint}/v1/logs`,
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env['npm_package_name'] ?? 'unknown-service',
      [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    }),
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(logExporter),
    instrumentations: getInstrumentations(),
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => {});
  });
}
```

> **Important notes for the implementer:**
> - `ATTR_SERVICE_NAME` etc. may be under `@opentelemetry/semantic-conventions/incubating` depending on the version. Check the package exports.
> - `npm_package_name` and `npm_package_version` are set automatically by Node.js when running via `npm`/`pnpm` scripts. In Docker production, these won't be set — read `service.name` from the package.json at build time instead, or pass `OTEL_SERVICE_NAME` env var. Consider adding `OTEL_SERVICE_NAME` to each service's Dockerfile as an `ENV` line (e.g., `ENV OTEL_SERVICE_NAME=research-agent`). The OTel SDK reads this automatically as a fallback.
> - The `v8 ignore module-init` comment on the first line exempts the entire module from coverage since the SDK-start branch requires a live OTLP collector.

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/infra-otel/src/__tests__/register.test.ts
```

Expected: PASS — the no-op path exits cleanly.

**Step 5: Verify full package typecheck**

```bash
pnpm run --filter @intexuraos/infra-otel typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/infra-otel/src/register.ts packages/infra-otel/src/__tests__/register.test.ts packages/infra-otel/src/index.ts
git commit -m "feat(infra-otel): add register.ts preload module"
```

---

## Task 5: Build Infrastructure for `infra-otel`

The package needs a `tsconfig.build.json` that emits `.js` files to `dist/` so the preload module can be referenced as `@intexuraos/infra-otel/dist/register.js` from PM2's `NODE_OPTIONS`.

**Files:**
- Create: `packages/infra-otel/tsconfig.build.json`

**Step 1: Create `tsconfig.build.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "src/__tests__"]
}
```

**Step 2: Build the package**

```bash
pnpm run --filter @intexuraos/infra-otel build
```

Expected: `packages/infra-otel/dist/register.js`, `config.js`, `instrumentations.js` created.

**Step 3: Verify the dist output exists**

```bash
ls packages/infra-otel/dist/register.js packages/infra-otel/dist/config.js packages/infra-otel/dist/instrumentations.js
```

Expected: All three files present.

**Step 4: Commit**

```bash
git add packages/infra-otel/tsconfig.build.json
git commit -m "feat(infra-otel): add build config for dist output"
```

---

## Task 6: Modify Build Script for OTel Preload

**Files:**
- Modify: `scripts/build-service.mjs`

The build script must produce a second esbuild output: `dist/otel-register.js`, bundled from `packages/infra-otel/src/register.ts`. This file is loaded via `--import` in Docker before `dist/index.js`.

**Step 1: Read the current `scripts/build-service.mjs`**

Already read. The key section is lines 112-125 (the `esbuild.build()` call).

**Step 2: Add a second esbuild.build() call after the main one**

After line 167 (the final `console.log`), add:

```javascript
// Build OTel preload module (separate entry point for --import flag)
const otelRegisterPath = resolve(rootDir, 'packages/infra-otel/src/register.ts');
if (existsSync(otelRegisterPath)) {
  await esbuild.build({
    entryPoints: [otelRegisterPath],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: resolve(rootDir, `${serviceDir}/dist/otel-register.js`),
    external: externalPackages,
    sourcemap: true,
    mainFields: ['module', 'main'],
    conditions: ['import', 'node'],
    absWorkingDir: rootDir,
  });
  console.log('Built OTel preload: dist/otel-register.js');
}
```

> **Key detail:** The `external` list is the same as the main build. This means all `@opentelemetry/*` packages will be external (resolved at runtime from `node_modules/`), and any `@intexuraos/*` code (like `config.ts`, `instrumentations.ts`) will be bundled into the single `otel-register.js` file.

**Step 3: Ensure `infra-otel`'s npm deps are in `dist/package.json`**

The `collectExternalDepsWithVersions` function recurses into `@intexuraos/*` workspace packages. Since services will list `@intexuraos/infra-otel` as a dependency, its `@opentelemetry/*` deps will appear in `dist/package.json` automatically.

But wait — services currently do NOT depend on `infra-otel`. We need to add it. Do that in Task 8 (Dockerfile changes) where we also add the dependency to each service's `package.json`.

Actually, since ALL services need it, a cleaner approach: add `@intexuraos/infra-otel` to the build script's external dep collection by **hardcoding it** as an always-included workspace package for the OTel register build. The build script should collect `infra-otel`'s external deps separately:

```javascript
// Collect infra-otel's npm dependencies for dist/package.json
const otelDeps = collectExternalDepsWithVersions('@intexuraos/infra-otel');
otelDeps.forEach((v, k) => depsWithVersions.set(k, v));
```

Add this after line 150 (where `depsWithVersions` is created), before `writeFileSync`.

**Step 4: Test the build**

```bash
node scripts/build-service.mjs research-agent
ls apps/research-agent/dist/otel-register.js
```

Expected: `otel-register.js` created alongside `index.js`.

**Step 5: Commit**

```bash
git add scripts/build-service.mjs
git commit -m "feat(build): add OTel preload as second esbuild entry point"
```

---

## Task 7: Add `infra-otel` Dependency to All Services

**Files:**
- Modify: `apps/*/package.json` (all 19 services)

Add `"@intexuraos/infra-otel": "workspace:*"` to the `dependencies` of every service `package.json`.

> **Why:** Even though the build script hardcodes the OTel dep collection, having it as an explicit dependency ensures `pnpm install` pulls the `@opentelemetry/*` packages into the workspace, and `typecheck` can resolve the types.

**Step 1: Add dependency to all services**

For each service in `apps/`:
```bash
pnpm --filter @intexuraos/research-agent add @intexuraos/infra-otel@workspace:*
pnpm --filter @intexuraos/user-service add @intexuraos/infra-otel@workspace:*
# ... repeat for all 19 services
```

Or use a one-liner:
```bash
for dir in apps/*/; do
  name=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${dir}package.json','utf8')).name)")
  pnpm --filter "$name" add @intexuraos/infra-otel@workspace:*
done
```

**Step 2: Verify**

```bash
pnpm install
pnpm build
```

Expected: All packages build, including `infra-otel`.

**Step 3: Commit**

```bash
git add apps/*/package.json pnpm-lock.yaml
git commit -m "feat: add infra-otel dependency to all services"
```

---

## Task 8: Update All 19 Dockerfiles

**Files:**
- Modify: `apps/*/Dockerfile` (19 files)

Two changes per Dockerfile:

1. Copy `otel-register.js` from builder stage
2. Change `CMD` to use `--import`
3. Add `OTEL_SERVICE_NAME` env var

**Step 1: Update each Dockerfile**

For each Dockerfile, make these changes:

```dockerfile
# After the existing COPY of dist/index.js.map, add:
COPY --from=builder /app/apps/<service-name>/dist/otel-register.js ./dist/

# Add service name for OTel (npm_package_name not available in Docker)
ENV OTEL_SERVICE_NAME=<service-name>

# Change CMD from:
CMD ["node", "dist/index.js"]
# To:
CMD ["node", "--import", "./dist/otel-register.js", "dist/index.js"]
```

The full list of services (replace `<service-name>`):
`research-agent`, `user-service`, `notion-service`, `whatsapp-service`, `mobile-notifications-service`, `commands-agent`, `actions-agent`, `data-insights-agent`, `image-service`, `notes-agent`, `todos-agent`, `bookmarks-agent`, `app-settings-service`, `code-agent`, `calendar-agent`, `linear-agent`, `chat-agent`, `web-agent`, `api-docs-hub`

**Step 2: Verify one Dockerfile builds**

```bash
docker build -f apps/research-agent/Dockerfile -t test-otel . --no-cache
```

Expected: Build succeeds. `dist/otel-register.js` present in final image.

**Step 3: Commit**

```bash
git add apps/*/Dockerfile
git commit -m "feat: add OTel preload to all Dockerfiles"
```

---

## Task 9: Update `ecosystem.config.cjs` for Dev

**Files:**
- Modify: `ecosystem.config.cjs`

**Step 1: Add Dash0 env vars to `COMMON_SERVICE_ENV`**

After the existing `INTEXURAOS_GEMINI_APP_API_KEY` line (line 24), add:

```javascript
INTEXURAOS_DASH0_OTLP_ENDPOINT: process.env.INTEXURAOS_DASH0_OTLP_ENDPOINT,
INTEXURAOS_DASH0_AUTH_TOKEN: process.env.INTEXURAOS_DASH0_AUTH_TOKEN,
```

**Step 2: Add `NODE_OPTIONS` to `createServiceConfig`**

In the `baseConfig.env` object (around line 156), add:

```javascript
NODE_OPTIONS: '--import @intexuraos/infra-otel/dist/register.js',
```

> **Important:** This relies on `pnpm build` having been run so `packages/infra-otel/dist/register.js` exists. The session start protocol already requires `pnpm build`.

**Step 3: Verify PM2 config syntax**

```bash
node -e "require('./ecosystem.config.cjs')"
```

Expected: No errors.

**Step 4: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "feat: add Dash0 OTel config to PM2 ecosystem"
```

---

## Task 10: Update Env Var Verification Script

**Files:**
- Modify: `scripts/verify-env-vars.mjs`

The Dash0 env vars are optional (services work without them — OTel is a no-op). Add them to `COMMON_OPTIONAL_ENV` so the verification script doesn't flag them.

**Step 1: Add to `COMMON_OPTIONAL_ENV`**

After the existing `'INTEXURAOS_GEMINI_APP_API_KEY'` line (line 64), add:

```javascript
// Dash0 OpenTelemetry (optional — no-op when not configured)
'INTEXURAOS_DASH0_OTLP_ENDPOINT',
'INTEXURAOS_DASH0_AUTH_TOKEN',
```

**Step 2: Verify**

```bash
node scripts/verify-env-vars.mjs
```

Expected: PASS — no new errors.

**Step 3: Commit**

```bash
git add scripts/verify-env-vars.mjs
git commit -m "feat: add Dash0 env vars to optional list in verify script"
```

---

## Task 11: Terraform — Add Secrets to Secret Manager

**Files:**
- Modify: `terraform/environments/dev/main.tf`

**Step 1: Add secrets to the `module "secret_manager"` block**

In the `secrets` map (around line 507, before the closing `}`), add:

```hcl
# Dash0 OpenTelemetry observability
"INTEXURAOS_DASH0_OTLP_ENDPOINT" = "Dash0 OTLP HTTP ingress endpoint for OpenTelemetry"
"INTEXURAOS_DASH0_AUTH_TOKEN"    = "Dash0 Bearer auth token for OTLP export"
```

**Step 2: Add to `local.common_service_secrets`**

In the `common_service_secrets` locals block (around line 557, before the closing `}`), add:

```hcl
INTEXURAOS_DASH0_OTLP_ENDPOINT = module.secret_manager.secret_ids["INTEXURAOS_DASH0_OTLP_ENDPOINT"]
INTEXURAOS_DASH0_AUTH_TOKEN    = module.secret_manager.secret_ids["INTEXURAOS_DASH0_AUTH_TOKEN"]
```

This propagates to all 19 services automatically via `merge(local.common_service_secrets, ...)`.

**Step 3: Validate Terraform**

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform fmt -check -recursive && terraform validate
```

Expected: PASS.

**Step 4: Commit**

```bash
git add terraform/environments/dev/main.tf
git commit -m "feat(terraform): add Dash0 OTLP secrets to Secret Manager and common service config"
```

---

## Task 12: Dash0 Account Setup + Populate Secrets

**This is a manual task — requires browser + GCP CLI.**

**Step 1: Create Dash0 account**

1. Go to https://www.dash0.com and sign up
2. Create organization "IntexuraOS"
3. Navigate to **Integrations Hub** → **OpenTelemetry**
4. Copy:
   - **OTLP Endpoint** (e.g., `https://ingress.eu1.dash0.com`)
   - **Auth Token** (Bearer token)

**Step 2: Populate GCP Secret Manager**

```bash
gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json

echo -n "https://ingress.eu1.dash0.com" | \
  gcloud secrets versions add INTEXURAOS_DASH0_OTLP_ENDPOINT --data-file=-

echo -n "<your-dash0-auth-token>" | \
  gcloud secrets versions add INTEXURAOS_DASH0_AUTH_TOKEN --data-file=-
```

**Step 3: Add to `.envrc` on dev machine**

```bash
export INTEXURAOS_DASH0_OTLP_ENDPOINT="https://ingress.eu1.dash0.com"
export INTEXURAOS_DASH0_AUTH_TOKEN="<your-dash0-auth-token>"
```

Then: `direnv allow`

**Step 4: Terraform apply**

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform plan
```

Review the plan (should show 2 new secrets + updated service configs), then:

```bash
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply
```

---

## Task 13: Run Full CI

**Step 1: Build all packages**

```bash
pnpm build
```

**Step 2: Run full CI**

```bash
pnpm run ci:tracked
```

Expected: PASS. If failures:
- OTel import issues → check `package.json` versions compatibility
- Typecheck errors → check `tsconfig.json` includes are correct
- Env var verification → ensure vars added to `COMMON_OPTIONAL_ENV`

**Step 3: Fix any failures, then commit all remaining changes**

```bash
git add -A
git commit -m "feat: Dash0 OpenTelemetry integration — CI green"
```

---

## Task 14: Verify Dev Deployment

**Step 1: Restart PM2 services on dev machine**

```bash
pnpm build
pm2 delete all && pm2 start ecosystem.config.cjs
```

**Step 2: Hit a few endpoints**

```bash
curl http://localhost:8116/health  # research-agent
curl http://localhost:8110/health  # user-service
```

**Step 3: Check Dash0 dashboard**

1. Open https://app.dash0.com
2. Navigate to **Traces** → verify traces appear with correct `service.name`
3. Navigate to **Logs** → verify logs have `trace_id` and `span_id` fields
4. Navigate to **Metrics** → verify HTTP request metrics appear

**Step 4: If traces don't appear**

- Check PM2 logs: `pm2 logs research-agent --lines 20`
- Look for OTel initialization messages or errors
- Verify env vars: `pm2 env research-agent | grep DASH0`

---

## Task 15: Create PR

**Step 1: Merge latest development**

```bash
git fetch origin && git merge origin/development
```

**Step 2: Run CI one final time**

```bash
pnpm run ci:tracked
```

**Step 3: Push and create PR**

```bash
git push -u origin <branch-name>
gh pr create --base development --title "feat: Dash0 OpenTelemetry integration" --body "$(cat <<'EOF'
## Summary
- New `packages/infra-otel` package wrapping `@opentelemetry/sdk-node`
- Preload module loaded via `--import` flag — zero application code changes
- Auto-instruments Fastify, HTTP, Pino, undici, DNS, net
- Sends traces, metrics, and logs to Dash0 via OTLP/HTTP
- No-op when Dash0 env vars absent (CI, tests, local)
- Terraform: 2 new secrets in Secret Manager, propagated to all services
- All 19 Dockerfiles updated with `--import` preload
- PM2 ecosystem config updated for dev environment

Closes INT-XXX

## Test plan
- [ ] `pnpm run ci:tracked` passes
- [ ] Dev: PM2 restart → traces appear in Dash0
- [ ] Prod: Cloud Run deploy → traces appear in Dash0
- [ ] CI: No OTel overhead (env vars absent → no-op)
- [ ] Sentry still receives errors (unchanged)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
