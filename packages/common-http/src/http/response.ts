import type { ErrorCode } from '@intexuraos/common-core';

/**
 * Diagnostics object for request tracing.
 */
export interface Diagnostics {
  requestId: string;
  durationMs?: number;
  downstreamStatus?: number;
  downstreamRequestId?: string;
  endpointCalled?: string;
}

/**
 * Success response envelope.
 */
export interface ApiOk<T> {
  success: true;
  data: T;
  diagnostics?: Diagnostics;
}

/**
 * Error body within error response.
 */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Error response envelope.
 */
export interface ApiError {
  success: false;
  error: ErrorBody;
  diagnostics?: Diagnostics;
}

/**
 * Union type for API responses.
 */
export type ApiResponse<T> = ApiOk<T> | ApiError;

/**
 * Create a success response.
 */
export function ok<T>(data: T, diagnostics?: Diagnostics): ApiOk<T> {
  return {
    success: true,
    data,
    ...(diagnostics !== undefined && { diagnostics }),
  };
}

/**
 * Create an error response.
 */
export function fail(
  code: ErrorCode,
  message: string,
  diagnostics?: Diagnostics,
  details?: unknown
): ApiError {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    ...(diagnostics !== undefined && { diagnostics }),
  };
}
