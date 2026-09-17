/**
 * Error types for Linear integration.
 */

export type LinearErrorCode =
  | 'NOT_CONNECTED'
  | 'INVALID_API_KEY'
  | 'TEAM_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'API_ERROR'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL_ERROR';

export interface LinearError {
  code: LinearErrorCode;
  message: string;
  /** Internal, payload-free evidence; removed at the fullSync boundary. */
  diagnostics?: {
    message: string;
    operation: string;
    statusCode?: number;
    attemptCount?: number;
    attempts?: { attempt: number; outcome: string; durationMs: number; delayMs: number }[];
  };
}

export function createLinearError(code: LinearErrorCode, message: string): LinearError {
  return { code, message };
}
