/**
 * Shared PR notification utility.
 *
 * Posts a "task created" comment and optionally updates the PR title
 * with a Linear issue tag. Used by both createReviewTask and createTaskForPR
 * to avoid duplicating post-task-creation logic.
 *
 * All operations are best-effort — errors are logged and swallowed.
 */

import type { Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

export interface PRTaskNotificationDeps {
  logger: Logger;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

export interface PRTaskNotificationRequest {
  taskId: string;
  repository: string;
  prNumber: number;
  userId: string;
  linearIssueId?: string;
  prTitle?: string;
  titleAlreadyTagged: boolean;
  reviewTypes?: string[];
}

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

function buildTaskCreatedComment(request: PRTaskNotificationRequest): string {
  const lines: string[] = [
    '@ignore',
    '### Automated Code Review Task Created',
    '',
    `**Task ID:** \`${request.taskId}\``,
  ];

  if (request.linearIssueId !== undefined) {
    lines.push(`**Linear Issue:** ${request.linearIssueId}`);
  }

  if (request.reviewTypes !== undefined && request.reviewTypes.length > 0) {
    const reviewTypesStr = request.reviewTypes.map((t) => `\`${t}\``).join(', ');
    lines.push(`**Review types:** ${reviewTypesStr}`);
  }

  lines.push(
    '',
    `[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/${request.taskId})`,
  );

  return lines.join('\n');
}

export async function notifyPROfTaskCreation(
  deps: PRTaskNotificationDeps,
  request: PRTaskNotificationRequest,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;

  try {
    // Split repository into owner/repo
    const [owner, repo] = request.repository.split('/');
    if (owner === undefined || repo === undefined) {
      logger.warn(
        { repository: request.repository, taskId: request.taskId },
        'Invalid repository format, skipping PR notification',
      );
      return;
    }

    // Fetch OAuth token
    const githubToken = await fetchGitHubToken(userServiceClient, request.userId, logger);
    if (githubToken === null) {
      logger.info(
        { userId: request.userId, taskId: request.taskId },
        'Skipping PR notification: no GitHub OAuth token available',
      );
      return;
    }

    // Best-effort: update PR title with Linear issue tag
    if (
      !request.titleAlreadyTagged &&
      request.linearIssueId !== undefined &&
      request.prTitle !== undefined
    ) {
      const newTitle = `[${request.linearIssueId}] ${request.prTitle}`;
      const titleResult = await gitHubPRClient.updatePRTitle(
        githubToken, owner, repo, request.prNumber, newTitle,
      );
      if (!titleResult.ok) {
        logger.warn(
          { error: titleResult.error, prNumber: request.prNumber, linearIssueId: request.linearIssueId },
          'Failed to update PR title with Linear issue ID (best-effort)',
        );
      }
    }

    // Post task-created comment
    const commentBody = buildTaskCreatedComment(request);
    const commentResult = await gitHubPRClient.postPRComment(
      githubToken, owner, repo, request.prNumber, commentBody,
    );
    if (!commentResult.ok) {
      logger.warn(
        { error: commentResult.error, taskId: request.taskId, prNumber: request.prNumber },
        'Failed to post task-created comment (best-effort)',
      );
    }
  } catch (error: unknown) {
    logger.warn(
      { error, taskId: request.taskId },
      'Unexpected error in PR task notification (best-effort)',
    );
  }
}
