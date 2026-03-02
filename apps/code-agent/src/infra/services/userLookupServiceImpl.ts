/**
 * Implementation of UserLookupService.
 *
 * Resolves a GitHub username to a user ID via GitHubUsernameResolver,
 * then fetches the user's worker settings to find the first enabled worker.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  UserLookupService,
  UserLookupResult,
  UserLookupError,
} from '../../domain/ports/userLookupService.js';
import type { GitHubUsernameResolver } from '../../domain/ports/gitHubUsernameResolver.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';

export interface UserLookupServiceDeps {
  gitHubUsernameResolver: GitHubUsernameResolver;
  workerSettingsRepo: WorkerSettingsRepository;
  logger: Logger;
}

export function createUserLookupService(
  deps: UserLookupServiceDeps
): UserLookupService {
  const { gitHubUsernameResolver, workerSettingsRepo, logger } = deps;

  return {
    async resolveByGitHubUsername(
      githubUsername: string
    ): Promise<Result<UserLookupResult, UserLookupError>> {
      // Step 1: Resolve GitHub username to userId
      const resolveResult = await gitHubUsernameResolver.resolve(githubUsername);

      if (!resolveResult.ok) {
        logger.debug(
          { githubUsername, error: resolveResult.error },
          'Could not resolve GitHub username to user ID'
        );
        return err({
          code: 'USER_NOT_FOUND',
          message: `No IntexuraOS user found for GitHub username '${githubUsername}'`,
        });
      }

      const userId = resolveResult.value;

      // Step 2: Fetch worker settings
      const settingsResult = await workerSettingsRepo.getSettings(userId);

      if (!settingsResult.ok) {
        logger.error(
          { userId, error: settingsResult.error },
          'Failed to get worker settings for resolved user'
        );
        return err({
          code: 'INTERNAL_ERROR',
          message: `Failed to fetch worker settings: ${settingsResult.error.message}`,
        });
      }

      const settings = settingsResult.value;

      if (settings === null) {
        return err({
          code: 'NO_ENABLED_WORKER',
          message: `User '${userId}' has no worker settings configured`,
        });
      }

      // Step 3: Find first enabled worker
      const enabledWorker = settings.workers.find((w) => w.enabled);

      if (enabledWorker === undefined) {
        return err({
          code: 'NO_ENABLED_WORKER',
          message: `User '${userId}' has no enabled workers`,
        });
      }

      return ok({ userId, worker: enabledWorker });
    },
  };
}
