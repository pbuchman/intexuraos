# Create New Service

Create a new backend service in the IntexuraOS monorepo.

## Usage

```
/create-service <service-name>
```

Example: `/create-service agent-router`

---

## Required Steps

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

### Route Naming Convention

When creating routes for your service:

- **Public routes:** `/{resource-name}` (e.g., `/todos`, `/bookmarks/:id`)
- **Internal routes:** `/internal/{resource-name}` (e.g., `/internal/todos`, `/internal/bookmarks/:id`)
- **HTTP methods:** Use `PATCH` for partial updates, `PUT` for full replacement

Avoid redundant paths like `/internal/todos/todos` — use simple `/internal/todos`.

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
    "start": "node dist/index.js",
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

WORKDIR /app

# Copy all package.json files
COPY package*.json ./
COPY apps/<service-name>/package*.json ./apps/<service-name>/
COPY packages/*/package*.json ./packages/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/<service-name>/ ./apps/<service-name>/

# Build service (esbuild bundles everything into one file)
RUN npm run build -w @intexuraos/<service-name>

# Stage 2: Production
FROM node:22-alpine

WORKDIR /app

# Copy generated production package.json and install deps
COPY --from=builder /app/apps/<service-name>/dist/package.json ./
RUN npm install --omit=dev

# Copy built file
COPY --from=builder /app/apps/<service-name>/dist/index.js ./dist/
COPY --from=builder /app/apps/<service-name>/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
```

Note: The build script auto-generates `dist/package.json` with all transitive npm dependencies.

### 4. Create src/index.ts

```typescript
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
  // Add service-specific required vars here
];

validateRequiredEnv(REQUIRED_ENV);

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

export interface ServiceContainer {
  // Define service dependencies here
  // exampleRepo: ExampleRepository;
}

// Configuration required to initialize services
export interface ServiceConfig {
  // Add config fields as needed
  // exampleApiKey: string;
}

let container: ServiceContainer | null = null;

/**
 * Initialize services with config. Call this early in server startup.
 * MUST be called before getServices().
 */
export function initServices(config: ServiceConfig): void {
  container = {
    // Initialize production dependencies using config
    // exampleRepo: new ExampleRepositoryAdapter(config.exampleApiKey),
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

### 6. Add Terraform Module

Edit `terraform/environments/dev/main.tf`:

```hcl
module "<service_name_underscored>" {
  source = "../../modules/cloud-run-service"

  project_id    = var.project_id
  region        = var.region
  service_name  = "intexuraos-<service-name>"
  image         = "${var.region}-docker.pkg.dev/${var.project_id}/intexuraos/intexuraos-<service-name>:latest"

  service_account_email = module.iam.service_accounts["<service-name>"]

  env_vars = {
    NODE_ENV = "production"
  }

  secret_env_vars = {
    # Add secrets as needed
  }
}
```

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

### 8. Add Cloud Build Configuration

Cloud Build requires 5 changes for a new service:

#### 8a. Add to Main Pipeline (`cloudbuild/cloudbuild.yaml`)

Add build and deploy steps (copy pattern from existing service like `user-service`):

```yaml
  # ===== <service-name> =====
  - name: 'gcr.io/cloud-builders/docker'
    id: 'build-push-<service-name>'
    waitFor: ['-']
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        echo "=== Building <service-name> ==="
        docker pull ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest || true
        docker build \
          --cache-from=${_ARTIFACT_REGISTRY_URL}/<service-name>:latest \
          --build-arg BUILDKIT_INLINE_CACHE=1 \
          -t ${_ARTIFACT_REGISTRY_URL}/<service-name>:$COMMIT_SHA \
          -t ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest \
          -f apps/<service-name>/Dockerfile .
        docker push ${_ARTIFACT_REGISTRY_URL}/<service-name>:$COMMIT_SHA
        docker push ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest
    env:
      - 'DOCKER_BUILDKIT=1'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy-<service-name>'
    waitFor: ['build-push-<service-name>']
    entrypoint: 'bash'
    args: ['-c', 'bash cloudbuild/scripts/deploy-<service-name>.sh']
    env:
      - 'COMMIT_SHA=$COMMIT_SHA'
      - 'REGION=${_REGION}'
      - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
      - 'ENVIRONMENT=${_ENVIRONMENT}'
```

#### 8b. Create Per-Service Pipeline (`apps/<service-name>/cloudbuild.yaml`)

```yaml
# Manual trigger: Deploy <service-name> only
steps:
  - name: 'gcr.io/cloud-builders/docker'
    id: 'build'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        docker pull ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest || true
        docker build \
          --cache-from=${_ARTIFACT_REGISTRY_URL}/<service-name>:latest \
          --build-arg BUILDKIT_INLINE_CACHE=1 \
          -t ${_ARTIFACT_REGISTRY_URL}/<service-name>:$COMMIT_SHA \
          -t ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest \
          -f apps/<service-name>/Dockerfile .
        docker push ${_ARTIFACT_REGISTRY_URL}/<service-name>:$COMMIT_SHA
        docker push ${_ARTIFACT_REGISTRY_URL}/<service-name>:latest
    env: ['DOCKER_BUILDKIT=1']

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy'
    entrypoint: 'bash'
    args: ['-c', 'bash cloudbuild/scripts/deploy-<service-name>.sh']
    env:
      - 'COMMIT_SHA=$COMMIT_SHA'
      - 'REGION=${_REGION}'
      - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
      - 'ENVIRONMENT=${_ENVIRONMENT}'

options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8

timeout: '600s'
```

#### 8c. Add to Terraform Trigger List

Edit `terraform/modules/cloud-build/main.tf`, add to `docker_services` local:

```hcl
locals {
  docker_services = [
    # ... existing services ...
    "<service-name>",
  ]
}
```

#### 8d. Add to Smart Dispatch

Edit `.github/scripts/smart-dispatch.mjs`, add to `SERVICES` array:

```javascript
const SERVICES = [
  // ... existing services ...
  '<service-name>',
];
```

### 9. Create Cloud Build Deployment Script

**CRITICAL:** Create `cloudbuild/scripts/deploy-<service-name>.sh` following this exact pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="<service-name>"
CLOUD_RUN_SERVICE="intexuraos-<service-name>"

require_env_vars REGION ARTIFACT_REGISTRY_URL COMMIT_SHA

tag="$(deployment_tag)"
image="${ARTIFACT_REGISTRY_URL}/${SERVICE}:${tag}"

log "Deploying ${SERVICE} to Cloud Run"
log "  Environment: ${ENVIRONMENT:-unset}"
log "  Region: ${REGION}"
log "  Image: ${image}"

# Check if service exists (must be created by Terraform first)
if ! gcloud run services describe "$CLOUD_RUN_SERVICE" --region="$REGION" &>/dev/null; then
  log "ERROR: Service ${CLOUD_RUN_SERVICE} does not exist"
  log "Run 'terraform apply' in terraform/environments/dev/ first to create the service with proper configuration"
  exit 1
fi

gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$image" \
  --region="$REGION" \
  --platform=managed \
  --quiet

log "Deployment complete for ${SERVICE}"
```

**Why this pattern is critical:**

- **Service existence check:** Prevents creating misconfigured services if Terraform hasn't run
- **No `--allow-unauthenticated` flag:** Auth settings are managed by Terraform, not deployment scripts
- **Fail-fast:** Exits immediately with clear error if service doesn't exist

**WRONG PATTERN (DO NOT USE):**

```bash
# ❌ Missing service existence check
# ❌ Sets --allow-unauthenticated (should be Terraform-managed)
gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$image" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --quiet
```

### 10. Register in API Docs Hub

Edit `apps/api-docs-hub/src/config.ts`:

```typescript
export const SERVICE_CONFIGS: ServiceConfig[] = [
  // ... existing services ...
  {
    name: '<Service Name>',
    slug: '<service-name>',
    openapiUrl: 'https://intexuraos-<service-name>-xyz.run.app/openapi.json',
  },
];
````

Note: Get the actual Cloud Run URL after first deployment.

### 11. Create Service URL Secret (Post-Deployment)

After first deployment, create a secret for the service URL so other services can call it:

```bash
# Get the Cloud Run URL (no trailing slash!)
SERVICE_URL=$(gcloud run services describe intexuraos-<service-name> \
  --region=europe-central2 \
  --format='value(status.url)')

# Create the secret
echo -n "$SERVICE_URL" | gcloud secrets create INTEXURAOS_<SERVICE_NAME>_SERVICE_URL --data-file=-

# Or update existing secret
echo -n "$SERVICE_URL" | gcloud secrets versions add INTEXURAOS_<SERVICE_NAME>_SERVICE_URL --data-file=-
```

### 12. Add to Root tsconfig.json

Edit `tsconfig.json`:

```json
{
  "references": [
    // ... existing references ...
    { "path": "./apps/<service-name>" }
  ]
}
```

### 13. Add to Local Dev Setup

Edit `scripts/dev.mjs` — add service to SERVICES array:

```javascript
const SERVICES = [
  // ... existing services ...
  { name: '<service-name>', port: 81XX, color: '\x1b[XXm' },
];
```

Choose next unused port in range 8110-\* and an ANSI color code.

**Also add to `.envrc.local.example`** for local development (use the same port):

```bash
# <Service Name> Service
export INTEXURAOS_<SERVICE_NAME>_SERVICE_URL=http://localhost:81XX

# Add any service-specific environment variables
# export INTEXURAOS_<SERVICE_NAME>_API_KEY=your-local-key
```

This ensures developers can run the service locally with proper configuration.

### 14. Run Verification

```bash
npm install
npm run ci
cd terraform && terraform fmt -recursive && terraform validate
```

### 15. Update Domain Docs Registry (if service has domain layer)

If your service has a `src/domain/` directory, update the domain documentation registry:

**File:** `.claude/commands/create-domain-docs.md`

Add your service to the "Available Services with Domain Layers" table:

```markdown
| `<service-name>` | models, ports, usecases |
```

This ensures `/create-domain-docs` can generate documentation for your service's domain layer.

---

## Service Requirements Checklist

- [ ] OpenAPI spec at `/openapi.json`
- [ ] Swagger UI at `/docs`
- [ ] Health endpoint at `/health`
- [ ] CORS enabled
- [ ] Terraform module created
- [ ] Service account in IAM module
- [ ] Build steps added to `cloudbuild/cloudbuild.yaml`
- [ ] Per-service `apps/<service>/cloudbuild.yaml` created
- [ ] Deploy script `cloudbuild/scripts/deploy-<service>.sh` created
- [ ] Added to `docker_services` in `terraform/modules/cloud-build/main.tf`
- [ ] Added to `SERVICES` in `.github/scripts/smart-dispatch.mjs`
- [ ] Registered in api-docs-hub
- [ ] Service URL secret created (post-deployment)
- [ ] Added to `.envrc.local.example`
- [ ] Added to root tsconfig.json
- [ ] Added to local dev setup (`scripts/dev.mjs`)
- [ ] Updated domain docs registry (if service has domain layer)
- [ ] `npm run ci` passes
- [ ] `terraform validate` passes

---

## Common Dependencies

| Feature       | Package                       |
| ------------- | ----------------------------- |
| Firestore     | `@intexuraos/infra-firestore` |
| PubSub        | `@google-cloud/pubsub`        |
| Cloud Storage | `@google-cloud/storage`       |
| HTTP client   | `@intexuraos/common-http`     |
| Auth/JWT      | `@intexuraos/common-core`     |

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
