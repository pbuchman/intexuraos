/**
 * Auth domain error types.
 */

export type AuthErrorCode =
  | 'INVALID_GRANT' // Refresh token invalid/expired/revoked
  | 'REAUTH_REQUIRED' // User must re-authenticate
  | 'TOKEN_NOT_FOUND' // No stored refresh token for user
  | 'CONFIGURATION_ERROR' // Auth0 config missing
  | 'INTERNAL_ERROR'; // Unexpected error

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  details?: unknown;
}
