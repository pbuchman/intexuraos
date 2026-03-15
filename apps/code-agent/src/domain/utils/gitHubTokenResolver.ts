/**
 * Resolves a per-user GitHub OAuth token via the user service.
 *
 * Shared by task-creation, merge-conflict detection, and continuation-PR flows.
 */

import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';

/**
 * Fetch per-user GitHub OAuth token.
 * Returns null if token is not available (best-effort).
 */
export async function fetchGitHubToken(
  userServiceClient: UserServiceClient,
  userId: string,
  logger: Logger,
): Promise<string | null> {
  const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');

  if (!tokenResult.ok) {
    logger.debug(
      { userId, errorCode: tokenResult.error.code },
      'GitHub OAuth token not available for user (best-effort)',
    );
    return null;
  }

  return tokenResult.value.accessToken; // @allow-result-access -- narrowed by !tokenResult.ok above
}
