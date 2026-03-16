# @intexuraos/http-server

Server setup utilities for IntexuraOS Fastify services. Provides health check infrastructure, environment variable validation, and a standardized validation error handler. Every Cloud Run service uses this package during startup.

**Node:** >=22.0.0
**Type:** ESM

## Dependencies

| Package                       | Purpose                   |
| ----------------------------- | ------------------------- |
| `@intexuraos/common-core`     | Error message extraction  |
| `@intexuraos/common-http`     | Reply augmentation (fail) |
| `@intexuraos/infra-firestore` | Firestore health check    |
| `fastify`                     | Framework types           |

## API Reference

### Health Check Types

```typescript
type HealthStatus = 'ok' | 'degraded' | 'down';

interface HealthCheck {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

interface HealthResponse {
  status: HealthStatus;
  serviceName: string;
  version: string;
  timestamp: string;
  checks: HealthCheck[];
}
```

### Health Check Functions

#### checkSecrets

Validates that required environment variables exist and are non-empty.

```typescript
function checkSecrets(required: string[]): HealthCheck;
```

Returns a `HealthCheck` with status `'ok'` when all variables are present, or `'down'` with a `missing` array in details.

#### validateRequiredEnv

Fail-fast validation at startup. Call this before `buildServer()` in `index.ts`.

```typescript
function validateRequiredEnv(required: string[]): void;
```

Throws an `Error` listing missing variables if any required env vars are missing or empty. The error message also hints to check Terraform `env_vars` or `.envrc.local`.

**Usage:**

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
];

validateRequiredEnv(REQUIRED_ENV);
```

#### checkFirestore

Tests Firestore connectivity by reading a lightweight document. Skips the actual check in test environments (`NODE_ENV=test` or `VITEST` set).

```typescript
function checkFirestore(): Promise<HealthCheck>;
```

Uses a 3-second timeout. Reads from `_health_check/ping` (a non-existent doc) to minimize cost.

#### checkNotionSdk

Passive health check that always returns `'ok'`. Notion credentials are per-user, so the SDK cannot be actively tested at the service level.

```typescript
function checkNotionSdk(): HealthCheck;
```

Returns `details: { mode: 'passive', reason: '...' }`.

#### computeOverallStatus

Aggregates individual check results into a single status. Returns `'down'` if any check is down, `'degraded'` if any is degraded, otherwise `'ok'`.

```typescript
function computeOverallStatus(checks: HealthCheck[]): HealthStatus;
```

#### buildHealthResponse

Assembles a complete health response with service metadata and an ISO timestamp.

```typescript
function buildHealthResponse(
  serviceName: string,
  version: string,
  checks: HealthCheck[]
): HealthResponse;
```

**Usage in a health route:**

```typescript
import { buildHealthResponse, checkSecrets, checkFirestore } from '@intexuraos/http-server';

app.get('/health', async (_request, reply) => {
  const checks = [checkSecrets(REQUIRED_ENV), await checkFirestore()];
  const response = buildHealthResponse('my-service', '3.3.0', checks);
  return reply.ok(response);
});
```

### Validation Error Handler (`validation-handler.ts`)

Creates a Fastify error handler that converts validation errors and malformed JSON into the standard IntexuraOS envelope format.

```typescript
function createValidationErrorHandler(): (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void>;
```

Handles three cases:

| Error Type                      | Response Code     | Details                           |
| ------------------------------- | ----------------- | --------------------------------- |
| `FST_ERR_CTP_INVALID_JSON_BODY` | `INVALID_REQUEST` | `'Invalid JSON body'`             |
| Fastify validation error        | `INVALID_REQUEST` | `{ errors: [{ path, message }] }` |
| Any other error                 | `INTERNAL_ERROR`  | `'Internal error'`                |

**Usage:**

```typescript
import { createValidationErrorHandler } from '@intexuraos/http-server';

app.setErrorHandler(createValidationErrorHandler());
```

## Used By

**Apps (19):** `actions-agent`, `api-docs-hub`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

## Recent Changes

| Commit      | Description                                            |
| ----------- | ------------------------------------------------------ |
| `fc16d26ac` | Tighten test assertion, audit empty JSON body handling |

## Source Files

| File                        | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `src/index.ts`              | Entry point, re-exports                  |
| `src/health.ts`             | Health check types and utility functions |
| `src/validation-handler.ts` | Fastify validation error handler         |
