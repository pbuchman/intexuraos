/**
 * Error codes for IntexuraOS API responses.
 * These codes are stable and must not change meaning.
 */
export type ErrorCode =
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
  | 'TASK_NOT_CANCELLABLE'
  | 'QUEUE_FULL'
  | 'PLAN_PR_MERGE_FAILED';

/**
 * HTTP status codes mapped to error codes.
 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PRECONDITION_FAILED: 412,
  UNPROCESSABLE_ENTITY: 422,
  RATE_LIMITED: 429,
  LOCKED: 423,
  DOWNSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
  MISCONFIGURED: 503,
  WORKER_NOT_CONFIGURED: 424,
  INVALID_WORKER: 400,
  WORKER_UNHEALTHY: 400,
  WORKER_UNAVAILABLE: 502,
  NOTION_NOT_CONNECTED: 400,
  PAGE_NOT_CONFIGURED: 400,
  RESEARCH_NOT_COMPLETED: 400,
  NO_SYNTHESIS: 400,
  ALREADY_EXPORTED: 409,
  NOTION_UNAUTHORIZED: 401,
  INVALID_NONCE: 400,
  NONCE_EXPIRED: 400,
  NOT_OWNER: 403,
  TASK_NOT_CANCELLABLE: 400,
  QUEUE_FULL: 503,
  PLAN_PR_MERGE_FAILED: 422,
};

/**
 * Base error class for IntexuraOS services.
 */
export class IntexuraOSError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'IntexuraOSError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

/**
 * Extract a message from an unknown error value.
 * @param error - Any caught error value (may not be Error instance)
 * @param fallback - Default message when error has no message (default: 'Unknown error')
 * @returns The error message or fallback
 */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error.length > 0 ? error : fallback;
  }
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      const msg = (error as { message: string }).message;
      if (msg.length > 0) return msg;
    }
    if ('details' in error && typeof (error as { details: unknown }).details === 'string') {
      const det = (error as { details: string }).details;
      if (det.length > 0) return det;
    }
  }
  return fallback;
}

const MAX_STACK_LENGTH = 2000;
const MAX_CAUSE_DEPTH = 10;

/**
 * Serialized error object suitable for structured logging.
 * Contains all non-enumerable Error properties extracted explicitly.
 *
 * @property cause - Recursive chain of serialized causes (max depth 10).
 *   Present when the original error has an `error.cause` property, mirroring
 *   the standard `Error.cause` chain as a plain JSON-safe structure.
 */
export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  errno?: number;
  syscall?: string;
  cause?: SerializedError;
}

/**
 * Serialize an error for structured logging.
 *
 * JavaScript Error properties (message, stack, name) are non-enumerable,
 * so logging `{ error }` directly produces `{"error":{}}`.
 * This function extracts all useful properties for proper logging.
 *
 * @param error - Any caught error value (may not be Error instance)
 * @returns Serialized error object with message, stack, code, etc.
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logger.error({ error: serializeError(error) }, 'Operation failed');
 * }
 * ```
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    const message = getErrorMessage(error);
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      return {
        message,
        ...(typeof obj['name'] === 'string' && { name: obj['name'] }),
        ...(typeof obj['code'] === 'string' && { code: obj['code'] }),
      };
    }
    return { message };
  }

  const result: SerializedError = {
    message: error.message,
    name: error.name,
  };

  if (error.stack !== undefined) {
    result.stack =
      error.stack.length > MAX_STACK_LENGTH
        ? error.stack.substring(0, MAX_STACK_LENGTH)
        : error.stack;
  }

  const errorWithCode = error as Error & { code?: unknown; errno?: unknown; syscall?: unknown };

  if (typeof errorWithCode.code === 'string') {
    result.code = errorWithCode.code;
  }

  if (typeof errorWithCode.errno === 'number') {
    result.errno = errorWithCode.errno;
  }

  if (typeof errorWithCode.syscall === 'string') {
    result.syscall = errorWithCode.syscall;
  }

  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    result.cause = serializeError(error.cause, depth + 1);
  }

  return result;
}

/**
 * Walk the error.cause chain and return a human-readable string.
 *
 * Each cause is rendered as `message [CODE]` (code only if present),
 * joined by ` -> `. Returns `undefined` when no cause chain exists.
 *
 * @example
 * ```typescript
 * // TypeError: fetch failed
 * //   cause: Error: connect ECONNREFUSED 34.143.76.2:443 { code: 'ECONNREFUSED' }
 * getErrorCauseChain(error)
 * // => 'connect ECONNREFUSED 34.143.76.2:443 [ECONNREFUSED]'
 * ```
 */
export function getErrorCauseChain(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.cause === undefined) {
    return undefined;
  }

  const parts: string[] = [];
  let current: unknown = error.cause;
  let depth = 0;

  while (current !== undefined && depth < MAX_CAUSE_DEPTH) {
    if (current instanceof Error) {
      const code = (current as Error & { code?: unknown }).code;
      const suffix = typeof code === 'string' ? ` [${code}]` : '';
      parts.push(`${current.message}${suffix}`);
      current = current.cause;
      depth++;
    } else {
      parts.push(getErrorMessage(current));
      break;
    }
  }

  return parts.join(' -> ');
}
