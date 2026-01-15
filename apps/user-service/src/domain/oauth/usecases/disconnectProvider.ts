/**
 * Disconnect Provider Use-Case
 *
 * Removes OAuth connection and optionally revokes token.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { OAuthProvider } from '../models/OAuthConnection.js';
import type { OAuthError } from '../models/OAuthError.js';
import type { OAuthConnectionRepository } from '../ports/OAuthConnectionRepository.js';
import type { GoogleOAuthClient } from '../ports/GoogleOAuthClient.js';

export interface DisconnectProviderInput {
  userId: string;
  provider: OAuthProvider;
}

export interface DisconnectProviderDeps {
  oauthConnectionRepository: OAuthConnectionRepository;
  googleOAuthClient: GoogleOAuthClient;
  logger: { warn: (obj: object, msg: string) => void };
}

export async function disconnectProvider(
  input: DisconnectProviderInput,
  deps: DisconnectProviderDeps
): Promise<Result<void, OAuthError>> {
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
  if (connection !== null) {
    const revokeResult = await googleOAuthClient.revokeToken(connection.tokens.accessToken);
    if (!revokeResult.ok) {
      logger.warn(
        { userId, provider, error: revokeResult.error.message },
        'Failed to revoke OAuth token (continuing with deletion)'
      );
    }
  }

  const deleteResult = await oauthConnectionRepository.deleteConnection(userId, provider);
  if (!deleteResult.ok) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to delete connection: ${deleteResult.error.message}`,
    });
  }

  return ok(undefined);
}
