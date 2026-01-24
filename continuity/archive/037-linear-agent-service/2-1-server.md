# Task 2-1: Create Server, Config, and Index Files

## Tier

2 (Dependent Deliverables)

## Context

Routes are implemented. Now create the server setup files to tie everything together.

## Problem Statement

Need to implement:

- `config.ts` - Environment configuration
- `services.ts` - Dependency injection container
- `server.ts` - Fastify server setup
- `index.ts` - Entry point with startup validation

## Scope

### In Scope

- All core server files
- Environment variable validation
- Service initialization
- Health check endpoint
- OpenAPI documentation

### Out of Scope

- Actual deployment (tier 5)
- Integration tests (tier 5)

## Required Approach

1. **Study** `apps/calendar-agent/src/` for patterns
2. **Implement** config loading from env vars
3. **Implement** services.ts with DI pattern
4. **Implement** server.ts with Fastify setup
5. **Implement** index.ts with startup validation

## Step Checklist

- [ ] Create `apps/linear-agent/src/config.ts`
- [ ] Update `apps/linear-agent/src/services.ts` with full implementation
- [ ] Create `apps/linear-agent/src/server.ts`
- [ ] Update `apps/linear-agent/src/index.ts` with entry point
- [ ] Verify TypeScript compiles
- [ ] Run workspace verification

## Definition of Done

- Service starts locally (may fail due to missing emulators)
- TypeScript compiles
- Workspace verification passes

## Verification Commands

```bash
cd apps/linear-agent
pnpm run typecheck

# Try to run (will likely fail without emulators, but structure should be valid)
# pnpm run dev

cd ../..

# Run workspace verification
pnpm run verify:workspace:tracked -- linear-agent
```

## Rollback Plan

```bash
# Files already exist, just revert changes
git checkout apps/linear-agent/src/
```

## Reference Files

- `apps/calendar-agent/src/config.ts`
- `apps/calendar-agent/src/services.ts`
- `apps/calendar-agent/src/server.ts`
- `apps/calendar-agent/src/index.ts`

## config.ts

```typescript
/**
 * Configuration loader for linear-agent service.
 */

export interface Config {
  port: number;
  gcpProjectId: string;
  userServiceUrl: string;
  internalAuthToken: string;
}

export function loadConfig(): Config {
  const port = Number(process.env['PORT'] ?? 8080);
  const gcpProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'] ?? '';
  const userServiceUrl = process.env['INTEXURAOS_USER_SERVICE_URL'] ?? '';
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';

  return {
    port,
    gcpProjectId,
    userServiceUrl,
    internalAuthToken,
  };
}
```

## services.ts (full implementation)

```typescript
/**
 * Service container for linear-agent.
 */

import pino from 'pino';
import type {
  LinearConnectionRepository,
  FailedIssueRepository,
  LinearApiClient,
  LinearActionExtractionService,
} from './domain/index.js';
import { createLinearConnectionRepository } from './infra/firestore/linearConnectionRepository.js';
import { createFailedIssueRepository } from './infra/firestore/failedIssueRepository.js';
import { createLinearApiClient } from './infra/linear/linearApiClient.js';
import { createLinearActionExtractionService } from './infra/llm/linearActionExtractionService.js';
import { createLlmUserServiceClient } from './infra/user/llmUserServiceClient.js';
import type { IPricingContext } from '@intexuraos/llm-pricing';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'linear-agent',
});

export type { IPricingContext as PricingContext };

export interface ServiceContainer {
  connectionRepository: LinearConnectionRepository;
  failedIssueRepository: FailedIssueRepository;
  linearApiClient: LinearApiClient;
  extractionService: LinearActionExtractionService;
}

export interface ServiceConfig {
  userServiceUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
}

let container: ServiceContainer | null = null;

export function initServices(config: ServiceConfig): void {
  const llmUserServiceClient = createLlmUserServiceClient({
    baseUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext: config.pricingContext,
    logger,
  });

  const extractionService = createLinearActionExtractionService(llmUserServiceClient);

  container = {
    connectionRepository: createLinearConnectionRepository(),
    failedIssueRepository: createFailedIssueRepository(),
    linearApiClient: createLinearApiClient(),
    extractionService,
  };
}

export function getServices(): ServiceContainer {
  if (container === null) {
    throw new Error('Service container not initialized. Call initServices() first.');
  }
  return container;
}

export function setServices(s: ServiceContainer): void {
  container = s;
}

export function resetServices(): void {
  container = null;
}
```

## server.ts

```typescript
/**
 * Fastify server configuration for linear-agent.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  registerCommonPlugins,
  registerCommonSchemas,
  createResponseHelpers,
} from '@intexuraos/http-server';
import { linearRoutes } from './routes/linearRoutes.js';
import { internalRoutes } from './routes/internalRoutes.js';
import type { Config } from './config.js';

export async function buildServer(config: Config) {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  // Register CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Register OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Linear Agent API',
        description: 'Linear integration service for IntexuraOS',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        schemas: {
          LinearIssue: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              identifier: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string', nullable: true },
              priority: { type: 'number' },
              state: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                },
              },
              url: { type: 'string' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
              completedAt: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
  });

  // Register common schemas and plugins
  registerCommonSchemas(app);
  await registerCommonPlugins(app, {
    authIssuer: process.env['INTEXURAOS_AUTH_ISSUER'] ?? '',
    authAudience: process.env['INTEXURAOS_AUTH_AUDIENCE'] ?? '',
    jwksUrl: process.env['INTEXURAOS_AUTH_JWKS_URL'] ?? '',
    internalAuthToken: config.internalAuthToken,
  });

  // Response helpers
  createResponseHelpers(app);

  // Health check
  app.get('/health', async () => ({ status: 'healthy' }));

  // OpenAPI JSON endpoint
  app.get('/openapi.json', async () => app.swagger());

  // Register routes
  await app.register(linearRoutes);
  await app.register(internalRoutes);

  return app;
}
```

## index.ts

```typescript
/**
 * Entry point for linear-agent service.
 */

import { initSentry } from '@intexuraos/infra-sentry';
import { validateRequiredEnv } from '@intexuraos/http-server';
import { getErrorMessage } from '@intexuraos/common-core';
import { createPricingContext } from '@intexuraos/llm-pricing';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { initServices } from './services.js';

// Fail-fast startup validation
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
];

validateRequiredEnv(REQUIRED_ENV);

// Initialize Sentry
initSentry({
  dsn: process.env['INTEXURAOS_SENTRY_DSN'],
  environment: process.env['INTEXURAOS_ENVIRONMENT'] ?? 'development',
  serviceName: 'linear-agent',
});

async function main(): Promise<void> {
  const config = loadConfig();

  // Create pricing context for LLM usage tracking
  const pricingContext = createPricingContext('linear-agent', {
    projectId: config.gcpProjectId,
    userServiceUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
  });

  // Initialize services
  initServices({
    userServiceUrl: config.userServiceUrl,
    internalAuthToken: config.internalAuthToken,
    pricingContext,
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

## Also needed: Create failedIssueRepository.ts

Remember to create `apps/linear-agent/src/infra/firestore/failedIssueRepository.ts` following the pattern of `calendar_failed_events` repository.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
