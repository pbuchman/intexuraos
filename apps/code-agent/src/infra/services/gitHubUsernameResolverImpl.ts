/**
 * GitHubUsernameResolver backed by UserServiceClient.
 *
 * Delegates to user-service's /internal/users/by-github-username/:username endpoint.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  GitHubUsernameResolver,
  GitHubUsernameResolverError,
} from '../../domain/ports/gitHubUsernameResolver.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

export interface GitHubUsernameResolverDeps {
  userServiceClient: UserServiceClient;
  logger: Logger;
}

export function createGitHubUsernameResolver(
  deps: GitHubUsernameResolverDeps
): GitHubUsernameResolver {
  const { userServiceClient, logger } = deps;

  return {
    async resolve(
      githubUsername: string
    ): Promise<Result<string, GitHubUsernameResolverError>> {
      const result = await userServiceClient.resolveGitHubUsername(githubUsername);

      if (!result.ok) {
        logger.debug(
          { githubUsername, error: result.error },
          'Failed to resolve GitHub username via user-service'
        );
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }

      const resolved = result.value;

      if (resolved === null) {
        return err({
          code: 'NOT_FOUND',
          message: `No user found for GitHub username '${githubUsername}'`,
        });
      }

      return ok(resolved.userId);
    },
  };
}
