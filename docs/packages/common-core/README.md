# @intexuraos/common-core

Pure utilities with zero infrastructure dependencies. This is a leaf package that forms the foundation of the IntexuraOS type system. Every other package and app in the monorepo depends on it.

**Version:** 2.1.0
**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## Exports

The package provides two entry points:

| Entry Point | Path             | Contents                                     |
| ----------- | ---------------- | -------------------------------------------- |
| Main        | `.` (index)      | Result types, Logger, nullability, tracing   |
| Errors      | `./errors`       | ErrorCode, IntexuraOSError, serializeError   |

## API Reference

### Result Types (`result.ts`)

Discriminated union for explicit error handling. IntexuraOS follows a "no dummy success" principle where failures must be explicit.

```typescript
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

function ok<T>(value: T): Result<T, never>;
function err<E>(error: E): Result<never, E>;
function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T };
function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E };
```

**Usage:**

```typescript
import { ok, err, type Result } from '@intexuraos/common-core';

function findUser(id: string): Result<User, 'NOT_FOUND'> {
  const user = db.get(id);
  if (!user) return err('NOT_FOUND');
  return ok(user);
}

const result = findUser('abc');
if (!result.ok) {
  console.log(result.error); // 'NOT_FOUND'
  return;
}
console.log(result.value); // User object
```

### Error Types (`errors.ts`)

Stable error codes for API responses with HTTP status mapping.

```typescript
type ErrorCode =
  | 'INVALID_REQUEST'     // 400
  | 'UNAUTHORIZED'        // 401
  | 'FORBIDDEN'           // 403
  | 'NOT_FOUND'           // 404
  | 'CONFLICT'            // 409
  | 'GONE'                // 410
  | 'PRECONDITION_FAILED' // 412
  | 'UNPROCESSABLE_ENTITY'// 422
  | 'RATE_LIMITED'        // 429
  | 'LOCKED'              // 423
  | 'DOWNSTREAM_ERROR'    // 502
  | 'INTERNAL_ERROR'      // 500
  | 'MISCONFIGURED'       // 503
  | /* ...domain-specific codes */;

const ERROR_HTTP_STATUS: Record<ErrorCode, number>;

class IntexuraOSError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown);
}

function getErrorMessage(error: unknown, fallback?: string): string;

interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  errno?: number;
  syscall?: string;
}

function serializeError(error: unknown): SerializedError;
```

**Usage:**

```typescript
import { IntexuraOSError, serializeError, getErrorMessage } from '@intexuraos/common-core';

throw new IntexuraOSError('NOT_FOUND', 'User not found', { userId: 'abc' });

try {
  await riskyOperation();
} catch (error) {
  logger.error({ error: serializeError(error) }, 'Operation failed');
  const msg = getErrorMessage(error, 'Something went wrong');
}
```

### Logger Interface (`logging.ts`)

Minimal logger contract matching pino's signature. All domain use cases accept this interface as a dependency.

```typescript
interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

function getLogLevel(): 'silent' | 'debug' | 'info' | 'warn' | 'error';
```

`getLogLevel()` returns `'silent'` when `NODE_ENV=test`, otherwise respects `LOG_LEVEL` env var (defaults to `'info'`).

### Nullability Utilities (`nullability.ts`)

Type-safe helpers for common null-handling patterns, designed for `noUncheckedIndexedAccess`.

```typescript
function ensureAllDefined<T>(
  values: readonly (T | null | undefined)[],
  fieldNames: readonly string[]
): T[];

function getFirstOrNull<T>(arr: readonly T[]): T | null;
function toDateOrNull(isoString: string | null | undefined): Date | null;
function toISOStringOrNull(date: Date | null | undefined): string | null;
```

### Service Feedback (`serviceFeedback.ts`)

Unified contract for downstream service execution results. Propagated from workers to the frontend.

```typescript
interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;
  errorCode?: string;
}

function isSuccessFeedback(feedback: ServiceFeedback): feedback is ServiceFeedback & { status: 'completed' };
function isFailureFeedback(feedback: ServiceFeedback): feedback is ServiceFeedback & { status: 'failed'; errorCode: string };
function successFeedback(message: string, resourceUrl?: string): ServiceFeedback;
function failureFeedback(message: string, errorCode: string): ServiceFeedback;
```

### Service Error Codes (`serviceErrorCodes.ts`)

Standard error codes for service execution failures, used with `ServiceFeedback.errorCode`.

```typescript
const ServiceErrorCodes = {
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  AUTH_FAILED: 'AUTH_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  DUPLICATE: 'DUPLICATE',
  NOT_FOUND: 'NOT_FOUND',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
} as const;

type ServiceErrorCode = (typeof ServiceErrorCodes)[keyof typeof ServiceErrorCodes];
```

### Distributed Tracing (`tracing/traceId.ts`)

End-to-end request tracing across service boundaries via the `X-Trace-Id` header.

```typescript
const TRACE_ID_HEADER = 'X-Trace-Id';

function extractOrGenerateTraceId(
  headers: Record<string, string | string[] | undefined>
): string;

function traceIdHeaders(traceId: string): Record<string, string>;
```

## Used By

Nearly every package and app in the monorepo depends on `common-core`:

**Packages (13):** `common-http`, `http-server`, `infra-pubsub`, `infra-firestore`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-glm`, `infra-notion`, `infra-perplexity`, `infra-sentry`, `infra-whatsapp`, `internal-clients`, `llm-utils`, `llm-prompts`, `llm-pricing`, `llm-factory`, `llm-audit`, `llm-contract`

**Apps (18):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web-agent`, `whatsapp-service`

**Workers (3):** `orchestrator`, `vm-lifecycle`, `log-cleanup`

## Recent Changes

| Commit   | Description                                          | Age     |
| -------- | ---------------------------------------------------- | ------- |
| 474ea6d1 | Validate workerLocation exists and is healthy        | 5 days  |
| f10ebdbf | Fix empty error objects in log output                | 7 days  |
| 44017d5c | Fix ESLint OOM with batched parallel lint runner     | 7 days  |
| af5442c2 | Implement per-user worker configuration              | 8 days  |
| 186f7ad8 | Enforce standardized HTTP response contract          | 9 days  |
| b4aaafdf | Add distributed tracing with X-Trace-Id header       | 13 days |
| 4fa0fed3 | Release v2.0.0                                       | 2 weeks |

## Source Files

| File                       | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `src/index.ts`             | Main entry point, re-exports all modules  |
| `src/errors.ts`            | ErrorCode, IntexuraOSError, serialization |
| `src/result.ts`            | Result discriminated union                |
| `src/logging.ts`           | Logger interface, getLogLevel             |
| `src/nullability.ts`       | Null-safe utility functions               |
| `src/serviceFeedback.ts`   | ServiceFeedback contract                  |
| `src/serviceErrorCodes.ts` | Standard service error codes              |
| `src/tracing/traceId.ts`   | X-Trace-Id header utilities               |
