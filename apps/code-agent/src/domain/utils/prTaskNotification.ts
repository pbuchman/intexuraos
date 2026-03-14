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
  skipComment?: boolean;
}

export type PRTaskDispatchOutcome =
  | 'created_and_dispatched'
  | 'created_and_queued'
  | 'existing_task_resumed'
  | 'existing_task_queued'
  | 'review_task_dispatched';

export type PRCommentOutcome =
  | 'review_dispatch_failed'
  | 'pr_task_dispatch_failed'
  | 'review_failed'
  | 'implementation_completed'
  | 'implementation_failed'
  | 'reply_completed'
  | 'reply_failed';

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

export interface DispatchFailedCommentRequest {
  taskId: string;
  repository: string;
  prNumber: number;
  userId: string;
  failureType: 'review' | 'pr_task';
  errorCode: string;
}

export interface TaskOutcomeCommentRequest {
  taskId: string;
  repository: string;
  prNumber: number;
  userId: string;
  outcome: 'review_failed' | 'implementation_completed' | 'implementation_failed' | 'reply_completed' | 'reply_failed';
  reviewTypes?: string[];
  errorCode?: string;
  workerType?: string;
}

/**
 * Build comment for dispatch failure (task not queued, not in progress).
 */
function buildDispatchFailedComment(request: DispatchFailedCommentRequest): string {
  const workType = request.failureType === 'review' ? 'review' : 'requested work';
  /* v8 ignore start -- ts-type: split always returns at least one element but TypeScript noUncheckedIndexedAccess narrows @preserve */
  const safeErrorCode = request.errorCode.split('/')[0]?.toUpperCase() ?? 'UNKNOWN_ERROR';
  /* v8 ignore stop @preserve */

  return [
    '@ignore',
    `### ${request.failureType === 'review' ? 'Review' : 'Task'} Dispatch Failed`,
    '',
    `The ${workType} could not be started at this time.`,
    '',
    `**Task ID:** \`${request.taskId}\``,
    `**Error:** ${safeErrorCode}`,
    '',
    `**Status:** Task was NOT queued. ${request.failureType === 'review' ? 'Review' : 'The requested work'} is not currently in progress.`,
    '',
    'Please try again later or check internal logs for details.',
  ].join('\n');
}

/**
 * Build comment for task completion outcome (success or failure).
 */
export function buildTaskOutcomeComment(request: TaskOutcomeCommentRequest): string {
  const isReview = request.outcome.startsWith('review_');
  const isFailure = request.outcome.endsWith('_failed');

  const outcomeLabels: Record<typeof request.outcome, string> = {
    review_failed: 'Automated Review Failed',
    implementation_completed: 'Implementation Completed',
    implementation_failed: 'Implementation Failed',
    reply_completed: 'Reply Posted',
    reply_failed: 'Reply Failed',
  };

  const lines: string[] = [
    '@ignore',
    `### ${outcomeLabels[request.outcome]}`,
    '',
    `**Task ID:** \`${request.taskId}\``,
  ];

  if (isReview && request.workerType !== undefined) {
    lines.push(`**Reviewer:** \`${request.workerType}\``);
  }

  if (isReview && request.reviewTypes !== undefined && request.reviewTypes.length > 0) {
    const reviewTypesStr = request.reviewTypes.map((t) => `\`${t}\``).join(', ');
    lines.push(`**Review types:** ${reviewTypesStr}`);
  }

  if (isFailure && request.errorCode !== undefined) {
    /* v8 ignore start -- ts-type: split always returns at least one element but TypeScript noUncheckedIndexedAccess narrows @preserve */
    const safeErrorCode = request.errorCode.split('/')[0]?.toUpperCase() ?? 'UNKNOWN_ERROR';
    /* v8 ignore stop @preserve */
    lines.push(`**Error:** ${safeErrorCode}`);

    if (request.outcome === 'review_failed') {
      lines.push('', '**Review output did not complete.** Check internal logs for details.');
    }
  } else {
    // Success case - all non-failure outcomes
    if (request.outcome === 'implementation_completed') {
      lines.push('', '**Implementation finished.** Changes have been pushed to the PR.');
    } else {
      // reply_completed is the only remaining success outcome
      lines.push('', '**Reply posted.** Check the PR comments for the response.');
    }
  }

  lines.push(
    '',
    `[View Task](https://intexuraos.cloud/#/code-tasks/${request.taskId})`,
  );

  return lines.join('\n');
}

/**
 * Split repository string into owner and repo parts.
 * Returns null if the format is invalid (missing slash).
 */
function splitRepository(
  repository: string,
  logger: Logger,
  context: string,
): { owner: string; repo: string } | null {
  const [owner, repo] = repository.split('/');
  if (owner === undefined || repo === undefined) {
    logger.warn({ repository }, `Invalid repository format, skipping ${context}`);
    return null;
  }
  return { owner, repo };
}

export async function notifyPROfTaskDispatch(
  deps: PRTaskNotificationDeps,
  request: PRTaskNotificationRequest,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;

  try {
    // Split repository into owner/repo
    const parsed = splitRepository(request.repository, logger, 'PR notification');
    if (parsed === null) return;
    const { owner, repo } = parsed;

    // Fetch OAuth token
    const githubToken = await fetchGitHubToken(userServiceClient, request.userId, logger);
    if (githubToken === null) {
      logger.info(
        { userId: request.userId, taskId: request.taskId },
        'Skipping PR notification: no GitHub OAuth token available',
      );
      return;
    }

    // Post dispatch comment (skip for review tasks where triage comment already posted)
    if (request.skipComment !== true) {
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

/**
 * Post comment when task dispatch fails (not queued, not in progress).
 */
export async function notifyDispatchFailed(
  deps: PRTaskNotificationDeps,
  request: DispatchFailedCommentRequest,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;

  try {
    const parsed = splitRepository(request.repository, logger, 'dispatch failure notification');
    if (parsed === null) return;
    const { owner, repo } = parsed;

    const githubToken = await fetchGitHubToken(userServiceClient, request.userId, logger);
    if (githubToken === null) {
      logger.info(
        { userId: request.userId },
        'Skipping dispatch failure notification: no GitHub token',
      );
      return;
    }

    const commentBody = buildDispatchFailedComment(request);
    const commentResult = await gitHubPRClient.postPRComment(
      githubToken, owner, repo, request.prNumber, commentBody,
    );
    if (!commentResult.ok) {
      logger.warn(
        { error: commentResult.error, prNumber: request.prNumber },
        'Failed to post dispatch failure comment (best-effort)',
      );
    }
  } catch (error: unknown) {
    logger.warn(
      { error, taskId: request.taskId },
      'Unexpected error in dispatch failure notification (best-effort)',
    );
  }
}

/**
 * Post comment when task completes (success or failure).
 */
export async function notifyTaskOutcome(
  deps: PRTaskNotificationDeps,
  request: TaskOutcomeCommentRequest,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;

  try {
    const parsed = splitRepository(request.repository, logger, 'task outcome notification');
    if (parsed === null) return;
    const { owner, repo } = parsed;

    const githubToken = await fetchGitHubToken(userServiceClient, request.userId, logger);
    if (githubToken === null) {
      logger.info(
        { userId: request.userId },
        'Skipping task outcome notification: no GitHub token',
      );
      return;
    }

    const commentBody = buildTaskOutcomeComment(request);
    const commentResult = await gitHubPRClient.postPRComment(
      githubToken, owner, repo, request.prNumber, commentBody,
    );
    if (!commentResult.ok) {
      logger.warn(
        { error: commentResult.error, prNumber: request.prNumber },
        'Failed to post task outcome comment (best-effort)',
      );
    }
  } catch (error: unknown) {
    logger.warn(
      { error, taskId: request.taskId },
      'Unexpected error in task outcome notification (best-effort)',
    );
  }
}

export interface ReviewReplacementCommentRequest {
  taskId: string;
  repository: string;
  prNumber: number;
  userId: string;
  replacedTaskId: string;
  replacedWorkerType?: string;
}

/**
 * Build comment when a review is cancelled due to replacement.
 */
export function buildReviewReplacementComment(request: ReviewReplacementCommentRequest): string {
  const lines: string[] = [
    '@ignore',
    '### Automated Code Review Cancelled',
    '',
    'A new review has been requested for this PR.',
    '',
    `**Cancelled Task ID:** \`${request.replacedTaskId}\``,
  ];

  if (request.replacedWorkerType !== undefined) {
    lines.push(`**Previous Reviewer:** \`${request.replacedWorkerType}\``);
  }

  lines.push(
    '',
    'The previous review task has been cancelled. A new review task will start shortly.',
  );

  return lines.join('\n');
}

/**
 * Post comment when a review is cancelled because a new review was requested.
 */
export async function notifyReviewReplaced(
  deps: PRTaskNotificationDeps,
  request: ReviewReplacementCommentRequest,
): Promise<void> {
  const { logger, gitHubPRClient, userServiceClient } = deps;

  try {
    const parsed = splitRepository(request.repository, logger, 'review replacement notification');
    if (parsed === null) return;
    const { owner, repo } = parsed;

    const githubToken = await fetchGitHubToken(userServiceClient, request.userId, logger);
    if (githubToken === null) {
      logger.info(
        { userId: request.userId },
        'Skipping review replacement notification: no GitHub token',
      );
      return;
    }

    const commentBody = buildReviewReplacementComment(request);
    const commentResult = await gitHubPRClient.postPRComment(
      githubToken, owner, repo, request.prNumber, commentBody,
    );
    if (!commentResult.ok) {
      logger.warn(
        { error: commentResult.error, prNumber: request.prNumber },
        'Failed to post review replacement comment (best-effort)',
      );
    }
  } catch (error: unknown) {
    logger.warn(
      { error, taskId: request.taskId },
      'Unexpected error in review replacement notification (best-effort)',
    );
  }
}
