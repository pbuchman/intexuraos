/**
 * Get Valid Access Token Use-Case
 *
 * Returns a valid access token, refreshing if necessary.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { OAuthProvider, OAuthTokens } from '../models/OAuthConnection.js';
import type { OAuthError } from '../models/OAuthError.js';
import type { OAuthConnectionRepository } from '../ports/OAuthConnectionRepository.js';
import type { GoogleOAuthClient } from '../ports/GoogleOAuthClient.js';

export interface GetValidAccessTokenInput {
  userId: string;
  provider: OAuthProvider;
}

export interface GetValidAccessTokenResult {
  accessToken: string;
  email: string;
}

export interface GetValidAccessTokenDeps {
  oauthConnectionRepository: OAuthConnectionRepository;
  googleOAuthClient: GoogleOAuthClient;
  logger?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getValidAccessToken(
  input: GetValidAccessTokenInput,
  deps: GetValidAccessTokenDeps
): Promise<Result<GetValidAccessTokenResult, OAuthError>> {
  const { userId, provider } = input;
  const { oauthConnectionRepository, googleOAuthClient, logger } = deps;

  const connectionResult = await oauthConnectionRepository.getConnection(userId, provider);
  if (!connectionResult.ok) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get connection: ${connectionResult.error.message}`,
    });
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({
      code: 'CONNECTION_NOT_FOUND',
      message: `No ${provider} connection found for user`,
    });
  }

  const expiresAt = new Date(connection.tokens.expiresAt).getTime();
  const isExpired = Date.now() + TOKEN_EXPIRY_BUFFER_MS > expiresAt;

  if (!isExpired) {
    return ok({
      accessToken: connection.tokens.accessToken,
      email: connection.email,
    });
  }

  logger?.info({ userId, provider }, 'Refreshing expired OAuth token');

  const refreshResult = await googleOAuthClient.refreshAccessToken(connection.tokens.refreshToken);
  if (!refreshResult.ok) {
    if (refreshResult.error.code === 'INVALID_GRANT') {
      await oauthConnectionRepository.deleteConnection(userId, provider);
      return err({
        code: 'CONNECTION_NOT_FOUND',
        message: 'OAuth connection expired. User must reconnect.',
      });
    }

    return err({
      code: 'TOKEN_REFRESH_FAILED',
      message: `Failed to refresh token: ${refreshResult.error.message}`,
    });
  }

  const newTokens = refreshResult.value;
  const updatedTokens: OAuthTokens = {
    accessToken: newTokens.accessToken,
    refreshToken: newTokens.refreshToken || connection.tokens.refreshToken,
    expiresAt: new Date(Date.now() + newTokens.expiresIn * 1000).toISOString(),
    scope: newTokens.scope || connection.tokens.scope,
  };

  const updateResult = await oauthConnectionRepository.updateTokens(userId, provider, updatedTokens);
  if (!updateResult.ok) {
    logger?.warn(
      { userId, provider, error: updateResult.error.message },
      'Failed to save refreshed tokens'
    );
  }

  return ok({
    accessToken: updatedTokens.accessToken,
    email: connection.email,
  });
}
