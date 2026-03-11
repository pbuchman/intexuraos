/**
 * Shared PR notification utility.
 *
 * Posts a dispatch-accepted comment and optionally updates the PR title
 * with a Linear issue tag. Used by task-creation and existing-task-dispatch
 * flows to avoid duplicating GitHub PR notification logic.
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
  dispatchOutcome: PRTaskDispatchOutcome;
  linearIssueId?: string;
  prTitle?: string;
  updateTitle: boolean;
  titleAlreadyTagged?: boolean;
  reviewTypes?: string[];
  workerType?: string;
}

export type PRTaskDispatchOutcome =
  | 'created_and_dispatched'
  | 'created_and_queued'
  | 'existing_task_resumed'
  | 'existing_task_queued'
  | 'review_task_dispatched';

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

const dispatchOutcomeLabels: Record<PRTaskDispatchOutcome, string> = {
  created_and_dispatched: 'Created and dispatched',
  created_and_queued: 'Created and queued',
  existing_task_resumed: 'Existing task resumed',
  existing_task_queued: 'Existing task queued',
  review_task_dispatched: 'Review task dispatched',
};

function buildTaskDispatchComment(request: PRTaskNotificationRequest): string {
  const lines: string[] = [
    '@ignore',
    '### Automated Code Review Task Accepted',
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

  if (request.workerType !== undefined) {
    lines.push(`**Reviewer:** \`${request.workerType}\``);
  }

  lines.push(`**Dispatch outcome:** ${dispatchOutcomeLabels[request.dispatchOutcome]}`);
  lines.push(
    '',
    `[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/${request.taskId})`,
  );

  return lines.join('\n');
}

export async function notifyPROfTaskDispatch(
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

    // Post dispatch comment
    const commentBody = buildTaskDispatchComment(request);
    const commentResult = await gitHubPRClient.postPRComment(
      githubToken, owner, repo, request.prNumber, commentBody,
    );
    if (!commentResult.ok) {
      logger.warn(
        { error: commentResult.error, taskId: request.taskId, prNumber: request.prNumber },
        'Failed to post task-dispatch comment (best-effort)',
      );
    }

    // Best-effort: update PR title with Linear issue tag after the ack comment.
    if (
      request.updateTitle &&
      request.titleAlreadyTagged !== true &&
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
  } catch (error: unknown) {
    logger.warn(
      { error, taskId: request.taskId },
      'Unexpected error in PR task notification (best-effort)',
    );
  }
}
