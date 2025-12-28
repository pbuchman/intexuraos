/**
 * Refresh Access Token Use-Case
 *
 * Refreshes an access token using a stored refresh token.
 * Handles token retrieval, refresh, storage, and error mapping.
 */

import { ok, err, isErr, type Result } from '@intexuraos/common';
import type { AuthTokenRepository } from '../ports/AuthTokenRepository.js';
import type { Auth0Client } from '../ports/Auth0Client.js';
import type { AuthTokens, RefreshResult } from '../models/AuthToken.js';

/**
 * Input for the refresh access token use-case.
 */
export interface RefreshAccessTokenInput {
  userId: string;
}

/**
 * Successful token refresh result.
 */
export interface RefreshAccessTokenResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
  idToken?: string;
}

/**
 * Error codes for token refresh failures.
 */
export type RefreshAccessTokenErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'DOWNSTREAM_ERROR'
  | 'INTERNAL_ERROR';

/**
 * Token refresh error.
 */
export interface RefreshAccessTokenError {
  code: RefreshAccessTokenErrorCode;
  message: string;
}

/**
 * Dependencies for the use-case.
 */
export interface RefreshAccessTokenDeps {
  authTokenRepository: AuthTokenRepository;
  auth0Client: Auth0Client;
  logger?: {
    warn: (obj: object, msg: string) => void;
  };
}

/**
 * Execute the refresh access token use-case.
 *
 * @param input - User ID to refresh token for
 * @param deps - Repository and client dependencies
 * @returns Result with new tokens or error
 */
export async function refreshAccessToken(
  input: RefreshAccessTokenInput,
  deps: RefreshAccessTokenDeps
): Promise<Result<RefreshAccessTokenResult, RefreshAccessTokenError>> {
  const { userId } = input;
  const { authTokenRepository, auth0Client, logger } = deps;

  // Get stored refresh token
  const refreshTokenResult = await authTokenRepository.getRefreshToken(userId);
  if (isErr(refreshTokenResult)) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to retrieve refresh token: ${refreshTokenResult.error.message}`,
    });
  }

  // Type narrowing: after isErr check, we know it's ok
  const storedRefreshToken = (refreshTokenResult as { ok: true; value: string | null }).value;
  if (storedRefreshToken === null) {
    return err({
      code: 'NOT_FOUND',
      message: 'No refresh token found. User must re-authenticate.',
    });
  }

  // Refresh access token via Auth0
  const refreshResult = await auth0Client.refreshAccessToken(storedRefreshToken);
  if (isErr(refreshResult)) {
    const error = refreshResult.error;

    // If invalid_grant, delete stored token and require reauth
    if (error.code === 'INVALID_GRANT') {
      await authTokenRepository.deleteTokens(userId);
      return err({
        code: 'UNAUTHORIZED',
        message: 'Refresh token is invalid or expired. User must re-authenticate.',
      });
    }

    return err({
      code: 'DOWNSTREAM_ERROR',
      message: `Token refresh failed: ${error.message}`,
    });
  }

  // Type narrowing: after isErr check, we know it's ok
  // Use RefreshResult type from domain models for type safety
  const newTokens = (refreshResult as { ok: true; value: RefreshResult }).value;

  // Store updated tokens (including new refresh token if rotation enabled)
  const tokensToStore: AuthTokens = {
    accessToken: newTokens.accessToken,
    refreshToken: newTokens.refreshToken ?? storedRefreshToken,
    tokenType: newTokens.tokenType,
    expiresIn: newTokens.expiresIn,
    scope: newTokens.scope,
    idToken: newTokens.idToken,
  };

  const saveResult = await authTokenRepository.saveTokens(userId, tokensToStore);
  if (isErr(saveResult)) {
    // Best-effort save, log warning but don't fail the request
    logger?.warn(
      { userId, errorMessage: saveResult.error.message },
      'Failed to save refreshed tokens'
    );
  }

  // Return access token to client (never return refresh token in response)
  // Build result with only defined optional fields
  const result: RefreshAccessTokenResult = {
    accessToken: newTokens.accessToken,
    tokenType: newTokens.tokenType,
    expiresIn: newTokens.expiresIn,
  };
  if (newTokens.scope !== undefined) {
    result.scope = newTokens.scope;
  }
  if (newTokens.idToken !== undefined) {
    result.idToken = newTokens.idToken;
  }

  return ok(result);
}
