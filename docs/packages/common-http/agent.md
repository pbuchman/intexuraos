# @intexuraos/common-http — Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/common-http
type: module
leaf: false
dependencies:
  - @intexuraos/common-core (workspace)
  - @intexuraos/llm-utils (workspace)
  - fastify ^5.x
  - fastify-plugin ^5.x
  - jose ^5.x
  - zod ^3.x
entry_points:
  - ".": ./src/index.ts
```

## Exported Types

```typescript
// http/response.ts
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

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

interface ApiError {
  success: false;
  error: ErrorBody;
  diagnostics?: Diagnostics;
}

type ApiResponse<T> = ApiOk<T> | ApiError;

// auth/fastifyAuthPlugin.ts
interface AuthUser {
  userId: string;
  claims: Record<string, unknown>;
}

// auth/jwt.ts
interface JwtConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

interface VerifiedJwt {
  sub: string;
  claims: Record<string, unknown>;
}

// auth/internalAuth.ts
interface InternalAuthResult {
  valid: boolean;
  reason?: 'not_configured' | 'token_mismatch';
}

// http/logger.ts
interface LogIncomingRequestOptions {
  bodyPreviewLength?: number;
  includeParams?: boolean;
  message?: string;
  additionalFields?: Record<string, unknown>;
}
```

## Exported Functions

```typescript
// http/response.ts (exported as apiOk, apiFail)
function ok<T>(data: T, diagnostics?: Diagnostics): ApiOk<T>;
function fail(
  code: ErrorCode,
  message: string,
  diagnostics?: Diagnostics,
  details?: unknown
): ApiError;

// http/requestId.ts
function getRequestId(headers: Record<string, string | string[] | undefined>): string;

// http/validation.ts
function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply;

// http/logger.ts
function shouldLogRequest(url: string | undefined): boolean;
function registerQuietHealthCheckLogging(app: FastifyInstance): void;
function logIncomingRequest(request: FastifyRequest, options?: LogIncomingRequestOptions): void;

// auth/jwt.ts
function verifyJwt(token: string, config: JwtConfig): Promise<VerifiedJwt>;
function clearJwksCache(): void;

// auth/fastifyAuthPlugin.ts
function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null>;
function tryAuth(request: FastifyRequest): Promise<AuthUser | null>;

// auth/internalAuth.ts
function validateInternalAuth(request: FastifyRequest): InternalAuthResult;
```

## Exported Plugins

```typescript
// http/fastifyPlugin.ts
const intexuraFastifyPlugin: FastifyPluginCallback;
// Registers: reply.ok(), reply.fail(), request.requestId, request.startTime
// Plugin name: 'intexura-plugin', fastify: '5.x'

// auth/fastifyAuthPlugin.ts
const fastifyAuthPlugin: FastifyPluginCallback;
// Registers: server.jwtConfig, request.user
// Plugin name: 'intexura-auth-plugin', fastify: '5.x'
// Depends on: 'intexura-plugin'
```

## Exported Constants

```typescript
const REQUEST_ID_HEADER: 'x-request-id';
```

## Re-exports

```typescript
// From @intexuraos/common-core
export type { ErrorCode, Result };
export { ERROR_HTTP_STATUS, IntexuraOSError, getErrorMessage, ok, err, isOk, isErr };

// From @intexuraos/llm-utils
export { redactToken, redactObject, SENSITIVE_FIELDS };
```

## Fastify Augmentations

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    startTime: number;
    user?: AuthUser;
  }

  interface FastifyReply {
    ok(data: unknown, diagnostics?: Partial<Diagnostics>): FastifyReply;
    fail(
      code: ErrorCode,
      message: string,
      diagnostics?: Partial<Diagnostics>,
      details?: unknown
    ): FastifyReply;
  }

  interface FastifyInstance {
    jwtConfig: JwtConfig | null;
  }
}
```

## Environment Variables

```
INTEXURAOS_AUTH_JWKS_URL       - JWKS endpoint for JWT validation
INTEXURAOS_AUTH_ISSUER         - Expected JWT issuer claim
INTEXURAOS_AUTH_AUDIENCE       - Expected JWT audience claim
INTEXURAOS_INTERNAL_AUTH_TOKEN - Shared token for service-to-service auth
```

## Dependency Graph

```
common-core -> common-http -> http-server -> all apps
                           -> all apps directly
```

## Typical Service Registration Order

```typescript
await app.register(intexuraFastifyPlugin); // 1. reply.ok/fail + requestId
await app.register(fastifyAuthPlugin);     // 2. JWT config (depends on intexura-plugin)
registerQuietHealthCheckLogging(app);      // 3. Suppress /health logs
app.setErrorHandler(createValidationErrorHandler()); // 4. (from http-server)
```
