/**
 * Port for Auth token persistence.
 * Implemented by infra layer (Firestore).
 */

import type { Result } from '@intexuraos/common-core';
import type { AuthTokens, AuthTokensPublic } from '../models/AuthToken.js';
import type { AuthError } from '../models/AuthError.js';

/**
 * Repository for storing and retrieving Auth0 tokens.
 */
export interface AuthTokenRepository {
  /**
   * Save tokens for a user.
   * Encrypts sensitive data before storage.
   */
  saveTokens(userId: string, tokens: AuthTokens): Promise<Result<AuthTokensPublic, AuthError>>;

  /**
   * Get public token metadata for a user.
   * Does not return sensitive token values.
   */
  getTokenMetadata(userId: string): Promise<Result<AuthTokensPublic | null, AuthError>>;

  /**
   * Get refresh token for a user.
   * Returns decrypted refresh token.
   */
  getRefreshToken(userId: string): Promise<Result<string | null, AuthError>>;

  /**
   * Check if user has a valid refresh token.
   */
  hasRefreshToken(userId: string): Promise<Result<boolean, AuthError>>;

  /**
   * Delete tokens for a user.
   * Used on logout or when refresh token is revoked.
   */
  deleteTokens(userId: string): Promise<Result<void, AuthError>>;
}
