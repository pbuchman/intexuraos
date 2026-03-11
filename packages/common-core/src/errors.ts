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
  | 'TASK_NOT_CANCELLABLE';

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

/**
 * Serialized error object suitable for structured logging.
 * Contains all non-enumerable Error properties extracted explicitly.
 */
export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  errno?: number;
  syscall?: string;
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
export function serializeError(error: unknown): SerializedError {
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

  return result;
}
