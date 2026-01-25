/**
 * Signing-related domain models.
 */

/**
 * Signing error types for HMAC operations.
 */
export interface SigningError {
  code: 'missing_secret' | 'signing_failed';
  message: string;
}
