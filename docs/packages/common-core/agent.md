# @intexuraos/common-core — Agent Reference

Machine-readable export map and interface definitions for automated tooling.

## Package Metadata

```
name: @intexuraos/common-core
type: module
leaf: true
dependencies: none
entry_points:
  - ".": ./src/index.ts
  - "./errors": ./src/errors.ts
```

## Exported Types

```typescript
// result.ts
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// errors.ts
type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'PRECONDITION_FAILED'
  | 'UNPROCESSABLE_ENTITY'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'MISCONFIGURED'
  | 'WORKER_NOT_CONFIGURED'
  | 'INVALID_WORKER'
  | 'WORKER_UNHEALTHY'
  | 'WORKER_UNAVAILABLE'
  | 'NOTION_NOT_CONNECTED'
  | 'PAGE_NOT_CONFIGURED'
  | 'RESEARCH_NOT_COMPLETED'
  | 'NO_SYNTHESIS'
  | 'ALREADY_EXPORTED'
  | 'NOTION_UNAUTHORIZED'
  | 'INVALID_NONCE'
  | 'NONCE_EXPIRED'
  | 'NOT_OWNER'
  | 'TASK_NOT_CANCELLABLE';

interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  errno?: number;
  syscall?: string;
}

// logging.ts
interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

// serviceFeedback.ts
interface ServiceFeedback {
  status: 'completed' | 'failed';
  message: string;
  resourceUrl?: string;
  errorCode?: string;
}

// serviceErrorCodes.ts
type ServiceErrorCode =
  | 'TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'AUTH_FAILED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'INVALID_INPUT'
  | 'DUPLICATE'
  | 'NOT_FOUND'
  | 'EXTRACTION_FAILED'
  | 'EXTERNAL_API_ERROR';

// codeTaskWorkerTypes.ts
type CodeTaskWorkerType = 'auto' | 'opus' | 'sonnet' | 'minimax' | 'glm' | 'qwen' | 'kimi';
```

## Exported Functions

```typescript
// result.ts
function ok<T>(value: T): Result<T, never>;
function err<E>(error: E): Result<never, E>;
function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T };
function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E };

// errors.ts
function getErrorMessage(error: unknown, fallback?: string): string;
function serializeError(error: unknown): SerializedError;

// logging.ts
function getLogLevel(): 'silent' | 'debug' | 'info' | 'warn' | 'error';

// nullability.ts
function ensureAllDefined<T>(
  values: readonly (T | null | undefined)[],
  fieldNames: readonly string[]
): T[];
function getFirstOrNull<T>(arr: readonly T[]): T | null;
function toDateOrNull(isoString: string | null | undefined): Date | null;
function toISOStringOrNull(date: Date | null | undefined): string | null;

// serviceFeedback.ts
function isSuccessFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'completed' };
function isFailureFeedback(
  feedback: ServiceFeedback
): feedback is ServiceFeedback & { status: 'failed'; errorCode: string };
function successFeedback(message: string, resourceUrl?: string): ServiceFeedback;
function failureFeedback(message: string, errorCode: string): ServiceFeedback;

// labels.ts
function normalizeLabel(label: string): string;
function hasCodeTaskLabel(labels: string[]): boolean;
function hasPlanningTaskLabel(labels: string[]): boolean;

// codeTaskWorkerTypes.ts
function isCodeTaskWorkerType(value: string): value is CodeTaskWorkerType;

// tracing/traceId.ts
function extractOrGenerateTraceId(headers: Record<string, string | string[] | undefined>): string;
function traceIdHeaders(traceId: string): Record<string, string>;
```

## Exported Constants

```typescript
const ERROR_HTTP_STATUS: Record<ErrorCode, number>;
const ServiceErrorCodes: {
  TIMEOUT: 'TIMEOUT';
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE';
  AUTH_FAILED: 'AUTH_FAILED';
  UNAUTHORIZED: 'UNAUTHORIZED';
  VALIDATION_ERROR: 'VALIDATION_ERROR';
  INVALID_INPUT: 'INVALID_INPUT';
  DUPLICATE: 'DUPLICATE';
  NOT_FOUND: 'NOT_FOUND';
  EXTRACTION_FAILED: 'EXTRACTION_FAILED';
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR';
};
const TRACE_ID_HEADER: 'X-Trace-Id';
const CODE_TASK_WORKER_TYPES: readonly ['auto', 'opus', 'sonnet', 'minimax', 'glm', 'qwen', 'kimi'];
```

## Exported Classes

```typescript
class IntexuraOSError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown);
}
```

## Dependency Graph

```
common-core (leaf)
  <- common-http
  <- http-server
  <- infra-pubsub
  <- infra-firestore
  <- infra-claude, infra-gemini, infra-gpt
  <- infra-notion, infra-perplexity, infra-sentry, infra-whatsapp
  <- llm-utils, llm-prompts, llm-pricing, llm-factory, llm-audit, llm-contract
  <- internal-clients
  <- all apps (19) and workers (3)
```

## Test Mock Pattern

```typescript
const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
```
