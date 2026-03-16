# @intexuraos/http-server — Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/http-server
type: module
leaf: false
dependencies:
  - @intexuraos/common-core (workspace)
  - @intexuraos/common-http (workspace)
  - @intexuraos/infra-firestore (workspace)
  - fastify ^5.x
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

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

## Exported Functions

```typescript
// health.ts
function checkSecrets(required: string[]): HealthCheck;
function validateRequiredEnv(required: string[]): void; // throws on missing vars
function checkFirestore(): Promise<HealthCheck>;
function checkNotionSdk(): HealthCheck;
function computeOverallStatus(checks: HealthCheck[]): HealthStatus;
function buildHealthResponse(
  serviceName: string,
  version: string,
  checks: HealthCheck[]
): HealthResponse;

// validation-handler.ts
function createValidationErrorHandler(): (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void>;
```

## Dependency Graph

```
common-core -> common-http -> http-server -> all apps
infra-firestore ------------> http-server
```

## Typical Usage Pattern

```typescript
// In index.ts
import { validateRequiredEnv } from '@intexuraos/http-server';

const REQUIRED_ENV = ['INTEXURAOS_AUTH_JWKS_URL', 'INTEXURAOS_AUTH_ISSUER'];
validateRequiredEnv(REQUIRED_ENV);

// In server.ts
import {
  createValidationErrorHandler,
  buildHealthResponse,
  checkSecrets,
  checkFirestore,
} from '@intexuraos/http-server';

app.setErrorHandler(createValidationErrorHandler());

app.get('/health', async (_req, reply) => {
  const checks = [checkSecrets(REQUIRED_ENV), await checkFirestore()];
  return reply.ok(buildHealthResponse('my-service', '3.3.0', checks));
});
```

## Health Check Name Registry

| Function         | HealthCheck.name | Checks                         |
| ---------------- | ---------------- | ------------------------------ |
| `checkSecrets`   | `'secrets'`      | Env vars present and non-empty |
| `checkFirestore` | `'firestore'`    | Doc read within 3s timeout     |
| `checkNotionSdk` | `'notion-sdk'`   | Always ok (passive)            |
