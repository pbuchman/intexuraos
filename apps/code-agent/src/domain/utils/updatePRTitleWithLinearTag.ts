/**
 * Best-effort: update PR title with Linear issue tag (e.g. "[INT-123] Original title").
 *
 * Shared by createTaskForPR and createReviewTask use cases.
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { fetchGitHubToken } from './gitHubTokenResolver.js';

export interface UpdatePRTitleDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

export interface UpdatePRTitleParams {
  repository: string;
  prNumber: number;
  userId: string;
  linearIssueId?: string;
  prTitle?: string;
  titleAlreadyTagged: boolean;
}

export async function updatePRTitleWithLinearTag(
  deps: UpdatePRTitleDeps,
  params: UpdatePRTitleParams,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;
  const { repository, prNumber, userId, linearIssueId, prTitle, titleAlreadyTagged } = params;

  if (titleAlreadyTagged || linearIssueId === undefined || prTitle === undefined) {
    return;
  }

  try {
    const [owner, repo] = repository.split('/');
    if (owner === undefined || repo === undefined) return;

    const githubToken = await fetchGitHubToken(userServiceClient, userId, logger);
    if (githubToken === null) return;

    const newTitle = `[${linearIssueId}] ${prTitle}`;
    const titleResult = await gitHubPRClient.updatePRTitle(githubToken, owner, repo, prNumber, newTitle);
    if (!titleResult.ok) {
      logger.warn(
        { error: titleResult.error, prNumber, linearIssueId },
        'Failed to update PR title with Linear issue ID (best-effort)',
      );
    }
  } catch (error: unknown) {
    logger.warn({ error, prNumber }, 'Unexpected error updating PR title (best-effort)');
  }
}
