# @intexuraos/common-http

Fastify helpers, request ID handling, response envelopes, and authentication utilities. This package provides the HTTP middleware stack that every IntexuraOS service registers during startup.

**Node:** >=22.0.0
**Type:** ESM

## Dependencies

| Package                   | Purpose                  |
| ------------------------- | ------------------------ |
| `@intexuraos/common-core` | Error types, Result      |
| `@intexuraos/llm-utils`   | Sensitive data redaction |
| `fastify`                 | HTTP framework types     |
| `fastify-plugin`          | Plugin encapsulation     |
| `jose`                    | JWT/JWKS verification    |
| `zod`                     | Schema validation        |

## API Reference

### Fastify Plugin (`http/fastifyPlugin.ts`)

Core plugin that decorates every Fastify instance with `reply.ok()`, `reply.fail()`, and request ID tracking.

```typescript
import { intexuraFastifyPlugin } from '@intexuraos/common-http';

const app = Fastify();
await app.register(intexuraFastifyPlugin);
```

After registration, `FastifyReply` gains two methods:

```typescript
interface FastifyReply {
  ok(data: unknown, diagnostics?: Partial<Diagnostics>): FastifyReply;
  fail(
    code: ErrorCode,
    message: string,
    diagnostics?: Partial<Diagnostics>,
    details?: unknown
  ): FastifyReply;
}
```

And `FastifyRequest` gains:

```typescript
interface FastifyRequest {
  requestId: string;
  startTime: number;
  rawBody: string; // raw request body string, stored before parsing
}
```

The plugin reads `x-request-id` from incoming headers (or generates a UUID) and attaches it to every response via the `onSend` hook. It also replaces Fastify's default JSON parser to accept empty bodies (fixing bodyless POST endpoints such as cron triggers) and stores the raw body on `request.rawBody` for webhook signature validation.

### Response Envelope (`http/response.ts`)

Standard response envelope types used by `reply.ok()` and `reply.fail()`.

```typescript
interface Diagnostics {
  requestId: string;
  durationMs?: number;
  downstreamStatus?: number;
  downstreamRequestId?: string;
  endpointCalled?: string;
}

interface ApiOk<T> {
  success: true;
  data: T;
  diagnostics?: Diagnostics;
}

interface ApiError {
  success: false;
  error: ErrorBody;
  diagnostics?: Diagnostics;
}

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

type ApiResponse<T> = ApiOk<T> | ApiError;

function ok<T>(data: T, diagnostics?: Diagnostics): ApiOk<T>;
function fail(
  code: ErrorCode,
  message: string,
  diagnostics?: Diagnostics,
  details?: unknown
): ApiError;
```

These are exported as `apiOk` and `apiFail` to avoid naming collision with `ok`/`err` from `common-core`.

### Request ID (`http/requestId.ts`)

```typescript
const REQUEST_ID_HEADER = 'x-request-id';

function getRequestId(headers: Record<string, string | string[] | undefined>): string;
```

Extracts the request ID from headers. Generates a UUID if the header is missing or empty.

### Auth Plugin (`auth/fastifyAuthPlugin.ts`)

JWT authentication plugin that reads configuration from environment variables.

```typescript
import { fastifyAuthPlugin, requireAuth, tryAuth } from '@intexuraos/common-http';

await app.register(fastifyAuthPlugin);
```

**Environment variables:**

- `INTEXURAOS_AUTH_JWKS_URL` — JWKS endpoint URL
- `INTEXURAOS_AUTH_ISSUER` — Expected JWT issuer
- `INTEXURAOS_AUTH_AUDIENCE` — Expected JWT audience

```typescript
interface AuthUser {
  userId: string;
  claims: Record<string, unknown>;
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null>;
async function tryAuth(request: FastifyRequest): Promise<AuthUser | null>;
```

`requireAuth` sends a 401 error response and returns `null` when authentication fails. `tryAuth` silently returns `null` without sending an error response, useful for optional auth scenarios.

### JWT Verification (`auth/jwt.ts`)

Low-level JWT verification using JWKS. The JWKS client caches per URL.

```typescript
interface JwtConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

interface VerifiedJwt {
  sub: string;
  claims: Record<string, unknown>;
}

async function verifyJwt(token: string, config: JwtConfig): Promise<VerifiedJwt>;
function clearJwksCache(): void;
```

Throws `IntexuraOSError` with code `UNAUTHORIZED` on failure (expired, invalid signature, missing sub claim).

### Internal Auth (`auth/internalAuth.ts`)

Service-to-service authentication via shared token.

```typescript
interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
}

function validateInternalAuth(request: FastifyRequest): InternalAuthResult;
```

Validates `x-internal-auth` header against `INTEXURAOS_INTERNAL_AUTH_TOKEN` env var.

### Logger Utilities (`http/logger.ts`)

Request logging with health check suppression and sensitive data redaction.

```typescript
function shouldLogRequest(url: string | undefined): boolean;
function registerQuietHealthCheckLogging(app: FastifyInstance): void;

interface LogIncomingRequestOptions {
  bodyPreviewLength?: number; // default: 500
  includeParams?: boolean; // default: false
  message?: string; // default: 'Incoming request'
  additionalFields?: Record<string, unknown>;
}

function logIncomingRequest(request: FastifyRequest, options?: LogIncomingRequestOptions): void;
```

`registerQuietHealthCheckLogging` suppresses log output for `/health` requests (Cloud Run probes). `logIncomingRequest` automatically redacts sensitive headers before logging. Required by CLAUDE.md on all endpoints.

### Validation Helper (`http/validation.ts`)

```typescript
function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply;
```

Converts Zod validation errors into the standard `reply.fail('INVALID_REQUEST', ...)` format with structured error details.

### Re-exports

For convenience, this package re-exports from its dependencies:

**From `@intexuraos/common-core`:** `ErrorCode`, `Result`, `ERROR_HTTP_STATUS`, `IntexuraOSError`, `getErrorMessage`, `ok`, `err`, `isOk`, `isErr`

**From `@intexuraos/llm-utils`:** `redactToken`, `redactObject`, `SENSITIVE_FIELDS`

## Used By

**Packages (1):** `http-server`

**Apps (19):** `actions-agent`, `api-docs-hub`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

## Recent Changes

| Commit      | Description                                                            |
| ----------- | ---------------------------------------------------------------------- |
| `84a56c76f` | Remove redundant error handler causing FSTWRN004                       |
| `5e51c9c86` | Preserve rawBody in custom JSON parser for webhook signatures          |
| `fc16d26ac` | Tighten test assertion, audit http-server for empty JSON body handling |

## Source Files

| File                            | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `src/index.ts`                  | Entry point, re-exports                   |
| `src/http/fastifyPlugin.ts`     | Core Fastify plugin (ok/fail/requestId)   |
| `src/http/response.ts`          | Response envelope types                   |
| `src/http/requestId.ts`         | Request ID extraction                     |
| `src/http/logger.ts`            | Request logging, health check suppression |
| `src/http/validation.ts`        | Zod validation error handler              |
| `src/auth/fastifyAuthPlugin.ts` | JWT auth Fastify plugin                   |
| `src/auth/jwt.ts`               | JWKS-based JWT verification               |
| `src/auth/internalAuth.ts`      | Service-to-service token auth             |
