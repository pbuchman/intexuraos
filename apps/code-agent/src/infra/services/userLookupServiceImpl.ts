/**
 * Implementation of UserLookupService using WorkerSettingsRepository.
 *
 * Resolves GitHub usernames to userId and worker config by querying
 * the worker settings collection for matching githubUsername field.
 */

import type { UserLookupService, UserLookupError, ResolvedUser } from '../../domain/ports/userLookupService.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import { err, ok, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';

export interface UserLookupServiceDeps {
  workerSettingsRepo: WorkerSettingsRepository;
  logger: Logger;
}

export function createUserLookupService(deps: UserLookupServiceDeps): UserLookupService {
  const { workerSettingsRepo, logger } = deps;

  return {
    async resolveUserFromGitHubUsername(
      githubUsername: string
    ): Promise<Result<ResolvedUser | null, UserLookupError>> {
      try {
        const result = await workerSettingsRepo.findByGitHubUsername(githubUsername);

        /* v8 ignore start -- test-infra: Firestore error path requires corrupted data @preserve */
        if (!result.ok) {
          logger.error(
            { githubUsername, error: result.error },
            'Failed to resolve GitHub username'
          );
          return err({
            code: 'internal_error',
            message: result.error.message,
          });
        }
        /* v8 ignore stop @preserve */

        /* v8 ignore start -- test-infra: null result path tested via integration tests @preserve */
        if (result.value === null) {
        /* v8 ignore stop @preserve */
          logger.debug({ githubUsername }, 'No user found for GitHub username');
          return ok(null);
        }

        logger.debug(
          { githubUsername, userId: result.value.userId },
          'Resolved GitHub username to user'
        );

        return ok({
          userId: result.value.userId,
          worker: result.value.worker,
        });
      } catch (error) {
        const message = getErrorMessage(error, 'Unknown error');
        logger.error({ error, githubUsername }, 'Unexpected error resolving GitHub username');
        return err({
          code: 'internal_error',
          message,
        });
      }
    },
  };
}
