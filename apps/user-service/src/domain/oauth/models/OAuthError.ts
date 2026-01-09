/**
 * OAuth domain error types.
 */

export type OAuthErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_CODE'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'TOKEN_REFRESH_FAILED'
  | 'INVALID_GRANT'
  | 'CONNECTION_NOT_FOUND'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR';

export interface OAuthError {
  code: OAuthErrorCode;
  message: string;
  details?: unknown;
}
