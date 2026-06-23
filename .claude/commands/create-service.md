# Create New Service

Create a new backend service (app or worker) in the IntexuraOS monorepo.

## Service Types

| Type   | Deploy Target   | Use Case                                        |
| ------ | --------------- | ----------------------------------------------- |
| App    | Cloud Run       | Persistent HTTP server, full DI, routes, domain |
| Worker | Cloud Functions | Event-driven processing, scale-to-zero          |

## Usage

```
/create-service <service-name>              # Creates an app (default)
/create-service <worker-name> --worker      # Creates a worker
```

Examples:

- `/create-service web-agent` — Creates a Cloud Run app
- `/create-service log-cleanup --worker` — Creates a Cloud Function worker

---

## App Creation Steps

> ## MANDATORY FINAL STEP — READ THIS FIRST
>
> **This command is NOT complete until `scripts/verify-service-scaffolding.sh <service-name>` exits 0.**
>
> The numbered steps below tell you WHAT to create. Step 14 is the only thing that tells you whether you actually did it. History is unambiguous: previous runs of `/create-service` have silently dropped IAM service accounts, deploy scripts, `docker_services` entries, and per-service `cloudbuild.yaml` files — not because the instructions were missing, but because the executor felt "done" after the visible terraform module was written and skipped the rest.
>
> **The verifier is the gate. Not running it = the service is not created.** No exceptions. No "I'm pretty sure I did everything." Run the script. If it exits non-zero, go back and fix what it reports, then re-run until it exits 0.
>
> See **Step 14** below for the exact command.

### 1. Create App Directory Structure

```
apps/<service-name>/
├── Dockerfile
├── package.json
└── src/
    ├── index.ts          # Entry point
    ├── services.ts       # Dependency injection container
    ├── domain/           # Business logic (no external deps)
    │   ├── models/
    │   └── usecases/
    ├── infra/            # External adapters (Firestore, PubSub, etc.)
    └── routes/           # HTTP transport layer
```

### Clean Architecture Enforcement (ESLint)

ESLint enforces Clean Architecture boundaries within each app:

| Layer  | Can Import From              | Cannot Import From |
| ------ | ---------------------------- | ------------------ |
| Routes | Domain, packages             | Infra              |
| Domain | packages (common-\*, llm-\*) | Infra              |
| Infra  | Domain, packages             | Routes             |

**ESLint rules location:** `eslint.config.js` (search for "CRITICAL #1", "CRITICAL #2", "CRITICAL #3")

**Dependency Direction:** Routes → Domain ← Infra

- Domain defines **port interfaces** (e.g., `domain/ports/`)
- Infra **implements** those interfaces (e.g., `infra/firestore/`)
- Routes call domain use cases, which use ports (not concrete infra)

**Example violation (ESLint will catch):**

```typescript
// ❌ domain/usecases/processAction.ts
import { GeminiService } from '../../infra/gemini/service.js'; // ERROR!

// ✅ domain/usecases/processAction.ts
import type { ActionExtractionPort } from '../ports/actionExtraction.js'; // OK
```

If you see domain importing from infra, define a port interface in domain and inject the implementation via `getServices()`.

### Route Naming Convention

When creating routes for your service:

- **Public routes:** relative to the service mount; do not repeat the mounted resource segment. Use `/` and `/:id` for collection resources, or subresources such as `/messages`, `/schedules/:id`, and `/webhooks`.
- **Internal routes:** `/internal/{resource-name}` (e.g., `/internal/todos`, `/internal/bookmarks/:id`)
- **HTTP methods:** Use `PATCH` for partial updates, `PUT` for full replacement

Avoid redundant paths like `/todos/todos` or `/internal/todos/todos` — use `/` for the public collection route and `/internal/todos` for internal routes.

### 2. Create package.json

```json
{
  "name": "@intexuraos/<service-name>",
  "version": "0.0.4",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "node ../../scripts/build-service.mjs <service-name>",
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0",
    "start": "node dist/index.js",
    "start:local": "tsx src/index.ts",
    "dev": "node --watch --experimental-strip-types src/index.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/swagger": "^9.4.2",
    "@fastify/swagger-ui": "^5.2.1",
    "@intexuraos/common-core": "*",
    "@intexuraos/common-http": "*",
    "@intexuraos/http-contracts": "*",
    "@intexuraos/http-server": "*",
    "@intexuraos/infra-otel": "workspace:*",
    "fastify": "^5.1.0",
    "pino": "^10.1.0",
    "zod": "^3.24.1"
  }
}
```

Add service-specific dependencies as needed (e.g., `@google-cloud/pubsub`, `@intexuraos/infra-firestore`).

### 3. Create Dockerfile

```dockerfile
# IntexuraOS <Service Name> Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
COPY apps/<service-name>/package*.json ./apps/<service-name>/

COPY packages/ ./packages/
# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/<service-name>/ ./apps/<service-name>/

# Build service (esbuild bundles everything into one file)
RUN pnpm run --filter @intexuraos/<service-name> build

# Stage 2: Production
FROM node:22-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/<service-name>/dist/package.json ./
RUN CI=true pnpm install --prod --no-frozen-lockfile

# Copy built files
COPY --from=builder /app/apps/<service-name>/dist/index.js ./dist/
COPY --from=builder /app/apps/<service-name>/dist/index.js.map ./dist/
COPY --from=builder /app/apps/<service-name>/dist/otel-register.js ./dist/

ENV NODE_ENV=production
ENV PORT=8080
ENV OTEL_SERVICE_NAME=<service-name>

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "--import", "./dist/otel-register.js", "dist/index.js"]
```

Note: The build script auto-generates `dist/package.json` with all transitive dependencies. The `otel-register.js` preload bootstraps OpenTelemetry instrumentation before any app code runs (no-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset).

### 4. Create src/index.ts

```typescript
import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

// Fail-fast startup validation - crashes immediately if required vars are missing
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID', // Required for Firestore (remove if not using Firestore)
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  // Add service-specific required vars here
];

validateRequiredEnv(REQUIRED_ENV);

// Initialize Sentry (required - DSN is validated above)
initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: '<service-name>',
});

async function main(): Promise<void> {
  const config = loadConfig();

  // Initialize services with config BEFORE building server
  initServices({
    // Pass config values to services
  });

  const app = await buildServer(config);

  const close = (): void => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  };

  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${getErrorMessage(error, String(error))}\n`);
  process.exit(1);
});
```

**IMPORTANT:** The `validateRequiredEnv()` call runs at module load time, before `main()`. This ensures the service crashes immediately if required environment variables are missing, rather than starting and failing at runtime.

**CRITICAL RULE:** The `REQUIRED_ENV` array MUST exactly match what you configure in Terraform:

- Every key in Terraform's `secrets = {}` block → add to `REQUIRED_ENV`
- Every key in Terraform's `env_vars = {}` block → add to `REQUIRED_ENV`
- **ONLY include variables that are ACTUALLY USED in the codebase**
- If a variable is configured in Terraform but never used → **remove from Terraform**, not from validation

**Verification:**

```bash
# What Terraform configures:
grep -A 20 "module \"<service-name>\"" terraform/environments/dev/main.tf | grep -E "secrets|env_vars" -A 5

# What code actually uses:
grep -r "process.env\[" apps/<service-name>/src --include="*.ts" --exclude-dir=__tests__
```

Both outputs must match exactly, or you have a misconfiguration.

Note: Create separate `server.ts` and `config.ts` files. See existing services for patterns.

### 5. Create src/services.ts

**IMPORTANT:** Follow the DI pattern correctly to avoid code smells.

```typescript
/**
 * Service wiring for <service-name>.
 * Provides dependency injection for domain adapters.
 */

import pino from 'pino';

export interface ServiceContainer {
  // Define service dependencies here
  // exampleRepo: ExampleRepository;
}

// Configuration required to initialize services
export interface ServiceConfig {
  // Add config fields as needed
  // exampleApiKey: string;
  // exampleServiceUrl: string;
  // internalAuthToken: string;
}

let container: ServiceContainer | null = null;

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  container = {
    // Initialize production dependencies using config
    // Pattern 1: Module-level logger (infra adapters with single purpose)
    // No logger passing needed - created at file scope in adapter
    // Pattern 2: Factory config logger (HTTP clients for internal services)
    // exampleClient: createExampleServiceHttpClient({
    //   baseUrl: config.exampleServiceUrl,
    //   internalAuthToken: config.internalAuthToken,
    //   logger: pino({ name: 'exampleClient' }), // Required in production
    // }),
    // Pattern 3: Constructor injection (reusable packages)
    // linkPreviewFetcher: new OpenGraphFetcher(
    //   undefined,
    //   pino({ name: 'openGraphFetcher' })
    // ),
  };
}

/**
 * Get the service container. Throws if initServices() wasn't called.
 * DO NOT add fallbacks here - that creates test code in production.
 */
export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

/**
 * Replace services for testing. Only use in tests.
 */
export function setServices(s: ServiceContainer): void {
  container = s;
}

/**
 * Reset services. Call in afterEach() in tests.
 */
export function resetServices(): void {
  container = null;
}

// DO NOT add: export * from './infra/...'
// Services.ts should only export DI functions, not re-export infra.
```

**Logging Patterns Reference:**

See `docs/patterns/logging.md` for complete documentation on when to use each pattern:

| Pattern        | When to Use                        | Example                                               |
| -------------- | ---------------------------------- | ----------------------------------------------------- |
| Module-level   | Infra adapters with single purpose | `const logger = pino({ name: 'whatsapp-cloud-api' })` |
| Factory config | HTTP clients for internal services | `logger: pino({ name: 'todosClient' })` in config     |
| Constructor    | Reusable packages                  | `new OpenGraphFetcher(undefined, logger)`             |
| Use case deps  | Domain use cases                   | `createProcessCommandUseCase({ logger })`             |

**Verification:** Factory functions with `logger?: Logger` must be called with a logger in production. Check with: `pnpm run verify:logging`

### 6. Add Terraform Module

Edit `terraform/environments/dev/main.tf`:

**Step 1:** Add the service to `local.services` map (around line 160):

```hcl
<service_name> = {
  name      = "intexuraos-<service-name>"
  port      = 8080
  min_scale = 0
  max_scale = 1
}
```

**Step 2:** Add the module (after other service modules):

```hcl
module "<service_name>" {
  source = "../../modules/cloud-run-service"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  service_name    = local.services.<service_name>.name
  service_account = module.iam.service_accounts["<service_name>"]
  port            = local.services.<service_name>.port
  min_scale       = local.services.<service_name>.min_scale
  max_scale       = local.services.<service_name>.max_scale
  labels          = local.common_labels

  image = "${var.region}-docker.pkg.dev/${var.project_id}/${module.artifact_registry.repository_id}/<service-name>:latest"

  # All services get common auth secrets + all service URLs automatically
  secrets  = local.common_service_secrets
  env_vars = local.common_service_env_vars

  # If service needs additional secrets or env_vars, use merge():
  # secrets = merge(local.common_service_secrets, {
  #   INTEXURAOS_SOME_API_KEY = module.secret_manager.secret_ids["INTEXURAOS_SOME_API_KEY"]
  # })
  # env_vars = merge(local.common_service_env_vars, {
  #   INTEXURAOS_PUBSUB_TOPIC = "my-topic-name"
  # })

  depends_on = [
    module.artifact_registry,
    module.iam,
    module.secret_manager,
  ]
}
```

**Step 3:** Add the service URL to `local.common_service_env_vars` (around line 250):

```hcl
INTEXURAOS_<SERVICE_NAME>_URL = "https://${local.services.<service_name>.name}-${local.cloud_run_url_suffix}"
```

This ensures all other services can call your new service via environment variable.

### 7. Add Service Account to IAM

Edit `terraform/environments/dev/main.tf` in the `iam` module:

```hcl
module "iam" {
  source = "../../modules/iam"
  # ...
  service_accounts = [
    # ... existing accounts ...
    "<service-name>",
  ]
}
```

### 8. Deployment Wiring

Migrated app/web services do not get GCP Cloud Run or app/web Cloud Build deployment wiring. Do **not** create `apps/<service>/cloudbuild.yaml`, `cloudbuild/scripts/deploy-<service>.sh`, or Cloud Build triggers for a new app service. Runtime deployment is handled by the Hetzner infrastructure path.

Keep these pieces in sync instead:

- local/dev process wiring in `ecosystem.config.cjs` and generated service wiring
- web-facing URL entry in `apps/web/service-manifest.json` if the web app calls the service
- Hetzner nginx/API routing if the service exposes public `/api/*` endpoints
- Terraform-managed retained GCP resources only when the service needs shared topics, buckets, secrets, or IAM

Retained GCP Cloud Build triggers are limited to `firestore`, `vm-lifecycle`, `transcription`, and `code-worker`.

### 10. Register in API Docs Hub

Edit `apps/api-docs-hub/src/config.ts`:

```typescript
export const SERVICE_CONFIGS: ServiceConfig[] = [
  // ... existing services ...
  {
    name: '<Service Name>',
    slug: '<service-name>',
    openapiUrl: 'https://intexuraos.cloud/api/<service-name>/openapi.json',
  },
];
```

Use the public Hetzner `/api/*` route when the service is public. Keep local-only/internal services out of the public API docs unless they have a documented route.

### 11. Update Web Service Manifest (if web needs the service URL)

If the web app needs to call your new service, add it to `apps/web/service-manifest.json` and regenerate service wiring:

```jsonc
// apps/web/service-manifest.json
{
  "services": [
    // ... existing services ...
    {
      "name": "<service-name>",
      "envSuffix": "<SERVICE_NAME>",
      "apiPath": "/api/<service-name>",
      "proxyTarget": "http://localhost:81XX",
      "serviceUrl": "http://localhost:81XX",
    },
  ],
}
```

Run:

```bash
pnpm run generate:service-wiring
```

**CI guards:**

- `pnpm run verify:web-service-manifest` validates manifest shape, Terraform service URL tfvars, removal of obsolete GCP web Cloud Build configs, and retained-bucket PWA fallback exclusions.
- `scripts/verify-service-scaffolding.sh` adds a soft check for the manifest entry.

**Also update the web app config** (`apps/web/src/config.ts`) if needed:

```typescript
export function getConfig(): AppConfig {
  return {
    // ... existing config ...
    <serviceName>Url: getEnvVar('INTEXURAOS_<SERVICE_NAME>_URL'),
  };
}
```

**Note:** Backend service URL wiring is managed by Hetzner runtime env generation, not GCP Cloud Run Terraform modules.

### 12. Verify tsconfig.json Coverage (automatic — nothing to edit)

The root `tsconfig.json` uses a glob include (`apps/*/src/**/*.ts`), so any new service under `apps/<service-name>/src/` is picked up automatically. **Do not edit `tsconfig.json`.** There is no `references[]` array to append to — if you find yourself adding one, you are editing the wrong file.

Verify the glob is intact (Step 14's verifier also checks this):

```bash
grep "apps/\*/src" tsconfig.json
# Expected output: "include": ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", ...]
```

### 13. Add to Local Dev Setup

Edit `ecosystem.config.cjs`:

**Step 1:** Add to the `apps` array using `createServiceConfig`:

```javascript
module.exports = {
  apps: [
    // ... existing services ...
    createServiceConfig('<service-name>', 81XX),
  ],
};
```

**Step 2:** Add service URL to `COMMON_SERVICE_URLS`:

```javascript
const COMMON_SERVICE_URLS = {
  // ... existing URLs ...
  INTEXURAOS_<SERVICE_NAME>_URL: 'http://localhost:81XX',
};
```

**Step 3:** If service needs specific env vars, add to `SERVICE_ENV_MAPPINGS`:

```javascript
const SERVICE_ENV_MAPPINGS = {
  // ... existing mappings ...
  '<service-name>': {
    INTEXURAOS_MY_TOPIC: process.env.INTEXURAOS_MY_TOPIC ?? 'my-topic',
  },
};
```

Choose next unused port in range 8110-8199.

**Also add to `.envrc.local.example`** for local development (use the same port):

```bash
# <Service Name> Service
export INTEXURAOS_<SERVICE_NAME>_SERVICE_URL=http://localhost:81XX

# Add any service-specific environment variables
# export INTEXURAOS_<SERVICE_NAME>_API_KEY=your-local-key
```

This ensures developers can run the service locally with proper configuration.

### 14. MANDATORY: Run the Scaffolding Verifier

**This is the gate. Do not claim the service is created until this script exits 0. No exceptions.**

```bash
bash scripts/verify-service-scaffolding.sh <service-name>
```

The script checks every required file, terraform block, cloudbuild entry, IAM binding, and GitHub Actions wiring produced by the steps above (25+ checks). **Exit 0 = done. Any other exit = not done.** If it reports missing items, go fix them and re-run the verifier until it passes. Do not proceed to commit, do not mark the task complete, do not move on.

**Why this is mandatory, not optional:** The prose steps above are easy to skim under attention pressure. Previous runs of `/create-service` have silently dropped the IAM service account, the deploy script, the `docker_services` list entry, and the per-service `cloudbuild.yaml` — all because the executor created the terraform module and felt "done." The verifier replaces "I think I did it" with an exit code. Running it is the only way to know.

**Anti-patterns to reject:**

- "I already went through the steps carefully, I don't need to run it" — run it anyway. Past-you was wrong before.
- "The verifier is flagging something that doesn't apply to my service" — then fix the verifier. Do not bypass it.
- "I'll run it later" — later never comes. Run it now, before the next action.

**After the verifier exits 0**, run the standard pre-commit checks:

```bash
pnpm install
pnpm run ci
cd terraform && terraform fmt -recursive && terraform validate
```

Only after **both** the verifier AND the CI checks pass is the service considered scaffolded. Only then should you commit.

### 15. Update Domain Docs Registry (if service has domain layer)

If your service has a `src/domain/` directory, update the domain documentation registry:

**File:** `.claude/commands/create-domain-docs.md`

Add your service to the "Available Services with Domain Layers" table:

```markdown
| `<service-name>` | models, ports, usecases |
```

This ensures `/create-domain-docs` can generate documentation for your service's domain layer.

---

## Worker Creation Steps

**Use these steps when creating a worker with `--worker` flag.**

### 1. Create Worker Directory Structure

```
workers/<worker-name>/
├── src/
│   ├── index.ts          # Cloud Functions Framework entry point
│   ├── main.ts           # Business logic
│   └── logger.ts         # Pino logger setup
├── __tests__/            # Unit tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 2. Create package.json

```json
{
  "name": "@intexuraos/<worker-name>",
  "version": "0.0.4",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint:local": "eslint src --max-warnings 0",
    "start": "node dist/index.js",
    "dev": "node --watch --experimental-strip-types src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google-cloud/functions-framework": "^3.0.0",
    "pino": "^9.6.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.3",
    "vitest": "^4.0.16"
  }
}
```

### 3. Create src/index.ts (Pub/Sub Trigger)

```typescript
import * as functions from '@google-cloud/functions-framework';
import { handleEvent } from './main.js';

functions.cloudEvent('handlerName', handleEvent);
```

**Or for HTTP trigger:**

```typescript
import * as functions from '@google-cloud/functions-framework';
import { handleRequest } from './main.js';

functions.http('handlerName', handleRequest);
```

### 4. Create src/main.ts

```typescript
import type { CloudEvent } from '@google-cloud/functions-framework';
import { createLogger } from './logger.js';

interface PubSubData {
  message: {
    data: string;
    attributes?: Record<string, string>;
  };
}

const logger = createLogger();

export async function handleEvent(event: CloudEvent<PubSubData>): Promise<void> {
  logger.info({ eventId: event.id }, 'Processing event');

  // Business logic here

  logger.info('Event processed successfully');
}
```

### 5. Create src/logger.ts

```typescript
import pino from 'pino';

export function createLogger() {
  return pino({
    name: '<worker-name>',
    level: process.env['LOG_LEVEL'] ?? 'info',
  });
}
```

### 6. Add Terraform Configuration

Workers use the `cloud-function` module (NOT `cloud-run-service`).

**In `terraform/environments/dev/main.tf`:**

```hcl
module "<worker_name>" {
  source = "../../modules/cloud-function"

  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  function_name   = "intexuraos-<worker-name>"
  service_account = module.iam.service_accounts["<worker_name>"]

  # Trigger configuration (choose one)
  trigger_type    = "pubsub"  # or "http" or "scheduler"
  pubsub_topic    = google_pubsub_topic.<topic_name>.id

  # Resources
  memory          = "256Mi"
  timeout_seconds = 60
  max_instances   = 10

  labels = local.common_labels
}
```

### 7. Create Cloud Build Deploy Script

Create `cloudbuild/scripts/deploy-<worker-name>.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKER="<worker-name>"
FUNCTION_NAME="intexuraos-<worker-name>"

require_env_vars REGION

log "Deploying ${WORKER} to Cloud Functions"

# Build and zip
cd workers/${WORKER}
pnpm run build
zip -r function.zip dist/ package.json

# Upload to GCS
gsutil cp function.zip gs://cloud-functions-source/${WORKER}/function.zip

# Deploy
gcloud functions deploy ${FUNCTION_NAME} \
  --gen2 \
  --region=${REGION} \
  --source=gs://cloud-functions-source/${WORKER}/function.zip \
  --quiet

log "Deployment complete for ${WORKER}"
```

### 8. Add to Root tsconfig.json

```json
{
  "references": [{ "path": "./workers/<worker-name>" }]
}
```

### 9. Run Verification

```bash
pnpm install
pnpm run ci:tracked
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform fmt -check -recursive && terraform validate
```

---

## Worker Requirements Checklist

- [ ] Worker directory created in `workers/`
- [ ] `package.json` with Cloud Functions Framework dependency
- [ ] Entry point uses `functions.cloudEvent()` or `functions.http()`
- [ ] Service account in IAM module
- [ ] Terraform `cloud-function` module configured
- [ ] Deploy script created
- [ ] Added to root tsconfig.json
- [ ] `pnpm run ci:tracked` passes
- [ ] `terraform validate` passes

---

## App Scaffolding Verification

**There is no manual checklist. Run the verifier.**

```bash
bash scripts/verify-service-scaffolding.sh <service-name>
```

This **replaces** the decorative `- [ ]` checklist that used to live here. A checklist you tick off from memory is not a gate — it's a wish list. The verifier is the gate: it runs real `grep`/`test` commands against the filesystem and reports observed state, not intention.

### What the verifier enforces

- **App files:** directory, `package.json`, `Dockerfile`, `src/index.ts`, per-service `cloudbuild.yaml`
- **Dockerfile contents:** `otel-register.js` copy, `OTEL_SERVICE_NAME` env, `--import` in CMD
- **Deploy script:** exists, has `--cpu-throttling`, does not set `--allow-unauthenticated`
- **Terraform:** `local.services.<name>` map entry, `module "<name>"` block, `common_service_secrets` wiring, `INTEXURAOS_<NAME>_URL` env var
- **IAM:** `google_service_account.<name>` resource
- **Cloud Build trigger list:** `docker_services` array contains the service
- **cloudbuild.yaml:** `build-push-<name>` and `deploy-<name>` steps
- **GitHub Actions `deploy.yml`:** docker build line, SERVICES array, 2× `CLOUD_RUN_SERVICES` entries
- **Monorepo wiring:** `tsconfig.json` glob intact, `ecosystem.config.cjs` (createServiceConfig + URL), `.envrc.local.example` URL
- **Optional (soft warnings):** api-docs-hub registration, web-facing `CLOUD_RUN_SERVICES` entry

Exit 0 = all required items present. Any other exit = missing items; fix and re-run.

> ## REMINDER: THE VERIFIER IS MANDATORY
>
> If you have not run `scripts/verify-service-scaffolding.sh <service-name>` and seen exit 0, **the service is not created** — regardless of how many steps above you followed. This is the third time this document says so. It will not say so a fourth time. Run the script.

---

## Common Dependencies

| Feature       | Package                       |
| ------------- | ----------------------------- |
| Firestore     | `@intexuraos/infra-firestore` |
| PubSub        | `@google-cloud/pubsub`        |
| Cloud Storage | `@google-cloud/storage`       |
| HTTP client   | `@intexuraos/common-http`     |
| Auth/JWT      | `@intexuraos/common-core`     |
| OpenTelemetry | `@intexuraos/infra-otel`      |

---

## Code Smells to Avoid

See `.claude/CLAUDE.md` "Code Smells" section for the full list. Key patterns for new services:

| Smell             | What to Avoid                                        | What to Do                     |
| ----------------- | ---------------------------------------------------- | ------------------------------ |
| **DI fallbacks**  | `return container ?? { fakeRepo }`                   | Throw if not initialized       |
| **Re-exports**    | `export * from './infra/...'` in services.ts         | Only export DI functions       |
| **Inline errors** | `error instanceof Error ? error.message : 'Unknown'` | Use `getErrorMessage()`        |
| **Module state**  | `let logger: Logger \| undefined;`                   | Pass deps to factory functions |

### Test Setup Pattern

```typescript
// In test files
import { setServices, resetServices } from '../services.js';
import { FakeRepository } from './fakes.js';

describe('MyRoute', () => {
  beforeEach(() => {
    setServices({
      exampleRepo: new FakeRepository(),
    });
  });

  afterEach(() => {
    resetServices();
  });
});
```
