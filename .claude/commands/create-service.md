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

### 2. Create package.json

```json
{
  "name": "@intexuraos/<service-name>",
  "version": "0.0.1",
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
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common-core/package.json ./packages/common-core/
COPY packages/common-http/package.json ./packages/common-http/
COPY packages/http-contracts/package.json ./packages/http-contracts/
COPY packages/http-server/package.json ./packages/http-server/
COPY packages/infra-firestore/package.json ./packages/infra-firestore/
COPY apps/<service-name>/package.json ./apps/<service-name>/

RUN npm ci --workspace=@intexuraos/<service-name>

COPY packages/common-core ./packages/common-core
COPY packages/common-http ./packages/common-http
COPY packages/http-contracts ./packages/http-contracts
COPY packages/http-server ./packages/http-server
COPY packages/infra-firestore ./packages/infra-firestore
COPY apps/<service-name> ./apps/<service-name>
COPY scripts ./scripts
COPY tsconfig.json ./

RUN npm run build --workspace=@intexuraos/<service-name>

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/apps/<service-name>/dist ./dist
COPY --from=builder /app/apps/<service-name>/package.json ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "dist/index.js"]
```

Adjust COPY statements based on which packages the service depends on.

### 4. Create src/index.ts

```typescript
import { getErrorMessage } from '@intexuraos/common-core';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

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

### 8. Add CloudBuild Trigger

Edit `cloudbuild/cloudbuild.yaml`, add to `_SERVICE_CONFIGS`:

```yaml
substitutions:
  _SERVICE_CONFIGS: |
    {
      # ... existing services ...
      "intexuraos-<service-name>": {
        "path": "apps/<service-name>",
        "dockerfile": "apps/<service-name>/Dockerfile"
      }
    }
```

### 9. Register in API Docs Hub

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
```

Note: Get the actual Cloud Run URL after first deployment.

### 10. Add to Root tsconfig.json

Edit `tsconfig.json`:

```json
{
  "references": [
    // ... existing references ...
    { "path": "./apps/<service-name>" }
  ]
}
```

### 11. Run Verification

```bash
npm install
npm run ci
cd terraform && terraform fmt -recursive && terraform validate
```

---

## Service Requirements Checklist

- [ ] OpenAPI spec at `/openapi.json`
- [ ] Swagger UI at `/docs`
- [ ] Health endpoint at `/health`
- [ ] CORS enabled
- [ ] Terraform module created
- [ ] Service account in IAM module
- [ ] CloudBuild trigger configured
- [ ] Registered in api-docs-hub
- [ ] Added to root tsconfig.json
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
