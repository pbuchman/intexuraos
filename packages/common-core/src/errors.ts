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
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'MISCONFIGURED';

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
  RATE_LIMITED: 429,
  LOCKED: 423,
  DOWNSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
  MISCONFIGURED: 503,
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
  return error instanceof Error ? error.message : fallback;
}
