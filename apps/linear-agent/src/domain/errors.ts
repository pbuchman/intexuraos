/**
 * Error types for Linear integration.
 */

export type LinearErrorCode =
  | 'NOT_CONNECTED'
  | 'INVALID_API_KEY'
  | 'TEAM_NOT_FOUND'
  | 'RATE_LIMIT'
  | 'API_ERROR'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL_ERROR';

export interface LinearError {
  code: LinearErrorCode;
  message: string;
}

export function createLinearError(code: LinearErrorCode, message: string): LinearError {
  return { code, message };
}
