import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import { loadPullRequestDetails } from '../usecases/mergeConflicts/detectConflicts.js';
import { parseOwnerRepo } from '../utils/parseOwnerRepo.js';
import type { WhatsAppNotifier } from './whatsappNotifier.js';

const READY_TO_MERGE_NOTIFICATION_RETRIES = 0;
const READY_TO_MERGE_NOTIFICATION_RETRY_DELAY_MS = 0;

export interface ReadyToMergeNotificationDeps {
  gitHubPRClient: Pick<GitHubPRClient, 'getPullRequestDetails'>;
  whatsappNotifier: Pick<WhatsAppNotifier, 'notifyTaskReadyForMerge'>;
  resolveGitHubToken: (userId: string) => Promise<string | null>;
  logger: Logger;
}

export interface ReadyToMergeNotificationInput {
  task: CodeTask;
  repository: string;
  prNumber?: number;
  prUrl?: string;
  userId?: string;
  linearIssueId?: string;
}

export async function notifyTaskReadyForMergeIfEligible(
  deps: ReadyToMergeNotificationDeps,
  input: ReadyToMergeNotificationInput,
): Promise<void> {
  const { task, repository, prNumber, userId, linearIssueId } = input;
  const context = { taskId: task.id, repository, prNumber, linearIssueId, userId };

  if (userId === undefined) {
    deps.logger.debug(context, 'Skipping ready-to-merge notification: no target user');
    return;
  }

  if (prNumber === undefined) {
    deps.logger.debug(context, 'Skipping ready-to-merge notification: no PR number');
    return;
  }

  const parsedRepository = parseOwnerRepo(repository);
  if (parsedRepository === null) {
    deps.logger.warn(context, 'Skipping ready-to-merge notification: invalid repository');
    return;
  }

  const prUrl = input.prUrl ?? `https://github.com/${repository}/pull/${String(prNumber)}`;
  if (prUrl.length === 0) {
    deps.logger.debug(context, 'Skipping ready-to-merge notification: no PR URL');
    return;
  }

  const token = await deps.resolveGitHubToken(userId);
  if (token === null) {
    deps.logger.debug(context, 'Skipping ready-to-merge notification: no GitHub token');
    return;
  }

  const detailsResult = await loadPullRequestDetails(
    { gitHubPRClient: deps.gitHubPRClient },
    token,
    parsedRepository.owner,
    parsedRepository.repo,
    prNumber,
    READY_TO_MERGE_NOTIFICATION_RETRIES,
    READY_TO_MERGE_NOTIFICATION_RETRY_DELAY_MS,
  );
  if (!detailsResult.ok) {
    deps.logger.warn(
      { ...context, error: detailsResult.error },
      'Failed to load PR details for ready-to-merge notification',
    );
    return;
  }

  if (detailsResult.value.state !== 'open') {
    deps.logger.info(
      { ...context, prState: detailsResult.value.state },
      'Skipping ready-to-merge notification: PR is not open',
    );
    return;
  }

  if (detailsResult.value.mergeable !== true) {
    deps.logger.info(
      {
        ...context,
        mergeable: detailsResult.value.mergeable,
        mergeableState: detailsResult.value.mergeableState,
      },
      'Skipping ready-to-merge notification: PR is not mergeable',
    );
    return;
  }

  const notifyResult = await deps.whatsappNotifier.notifyTaskReadyForMerge(userId, task, {
    prUrl,
    ...(linearIssueId !== undefined ? { linearIssueId } : {}),
  });
  if (!notifyResult.ok) {
    deps.logger.warn(
      { ...context, error: notifyResult.error },
      'Failed to send ready-to-merge notification',
    );
  }
}
