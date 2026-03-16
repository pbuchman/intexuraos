# @intexuraos/common-core

Pure utilities with zero infrastructure dependencies. This is a leaf package that forms the foundation of the IntexuraOS type system. Every other package and app in the monorepo depends on it.

**Node:** >=22.0.0
**Type:** ESM
**Dependencies:** None (leaf package)

## Exports

| Entry Point | Path        | Contents                                   |
| ----------- | ----------- | ------------------------------------------ |
| Main        | `.` (index) | Result types, Logger, nullability, tracing |
| Errors      | `./errors`  | ErrorCode, IntexuraOSError, serializeError |

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
  | 'INVALID_REQUEST' // 400
  | 'UNAUTHORIZED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409
  | 'GONE' // 410
  | 'PRECONDITION_FAILED' // 412
  | 'UNPROCESSABLE_ENTITY' // 422
  | 'RATE_LIMITED' // 429
  | 'LOCKED' // 423
  | 'DOWNSTREAM_ERROR' // 502
  | 'INTERNAL_ERROR' // 500
  | 'MISCONFIGURED' // 503
  // Worker lifecycle
  | 'WORKER_NOT_CONFIGURED' // 424
  | 'INVALID_WORKER' // 400
  | 'WORKER_UNHEALTHY' // 400
  | 'WORKER_UNAVAILABLE' // 502
  // Notion integration
  | 'NOTION_NOT_CONNECTED' // 400
  | 'PAGE_NOT_CONFIGURED' // 400
  | 'NOTION_UNAUTHORIZED' // 401
  // Research
  | 'RESEARCH_NOT_COMPLETED' // 400
  | 'NO_SYNTHESIS' // 400
  | 'ALREADY_EXPORTED' // 409
  // Security / nonces
  | 'INVALID_NONCE' // 400
  | 'NONCE_EXPIRED' // 400
  | 'NOT_OWNER' // 403
  // Task management
  | 'TASK_NOT_CANCELLABLE'; // 400

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

function isSuccessFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'completed' };
function isFailureFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'failed'; errorCode: string };
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

function extractOrGenerateTraceId(headers: Record<string, string | string[] | undefined>): string;
function traceIdHeaders(traceId: string): Record<string, string>;
```

### Linear Label Utilities (`labels.ts`)

Canonical normalization and detection for Linear issue labels. Consolidated here from four services during v3.2.0.

```typescript
function normalizeLabel(label: string): string;
function hasCodeTaskLabel(labels: string[]): boolean;
function hasPlanningTaskLabel(labels: string[]): boolean;
```

### Code Task Worker Types (`codeTaskWorkerTypes.ts`)

Shared contract for the set of valid worker type identifiers.

```typescript
const CODE_TASK_WORKER_TYPES = ['auto', 'opus', 'sonnet', 'minimax', 'glm', 'qwen', 'kimi'] as const;
type CodeTaskWorkerType = (typeof CODE_TASK_WORKER_TYPES)[number];

function isCodeTaskWorkerType(value: string): value is CodeTaskWorkerType;
```

## Used By

Nearly every package and app in the monorepo depends on `common-core`:

**Packages (19):** `common-http`, `http-server`, `infra-pubsub`, `infra-firestore`, `infra-claude`, `infra-gemini`, `infra-gpt`, `infra-notion`, `infra-perplexity`, `infra-sentry`, `infra-whatsapp`, `internal-clients`, `llm-utils`, `llm-prompts`, `llm-pricing`, `llm-factory`, `llm-audit`, `llm-contract`, `infra-otel`

**Apps (19):** `actions-agent`, `app-settings-service`, `bookmarks-agent`, `calendar-agent`, `chat-agent`, `code-agent`, `commands-agent`, `data-insights-agent`, `image-service`, `linear-agent`, `mobile-notifications-service`, `notes-agent`, `notion-service`, `research-agent`, `todos-agent`, `user-service`, `web`, `web-agent`, `whatsapp-service`

**Workers (3):** `orchestrator`, `vm-lifecycle`, `log-cleanup`

## Recent Changes

| Commit      | Description                                           |
| ----------- | ----------------------------------------------------- |
| `71968fa01` | Add kimi worker type                                  |
| `33129fd77` | Normalize qwen worker naming                          |
| `daa15657b` | Extract shared code-task worker types                 |
| `092a937d7` | Add hasPlanningTaskLabel utility                      |
| `eed6e8baf` | Add tests for v8-ignore blocks in errors.ts           |

## Source Files

| File                         | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `src/index.ts`               | Main entry point, re-exports all modules  |
| `src/errors.ts`              | ErrorCode, IntexuraOSError, serialization |
| `src/result.ts`              | Result discriminated union                |
| `src/logging.ts`             | Logger interface, getLogLevel             |
| `src/nullability.ts`         | Null-safe utility functions               |
| `src/serviceFeedback.ts`     | ServiceFeedback contract                  |
| `src/serviceErrorCodes.ts`   | Standard service error codes              |
| `src/labels.ts`              | Linear label normalization                |
| `src/codeTaskWorkerTypes.ts` | Worker type contract                      |
| `src/tracing/traceId.ts`     | X-Trace-Id header utilities               |
