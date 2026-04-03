/**
 * Use case: Handle PR close events (merged or closed without merge).
 *
 * When merged:
 * - Plan PRs (detected by `[plan]` in title) transition to Todo.
 * - All other PRs transition to QA.
 * - Remove `ready-to-merge` label.
 * - Destroy preserved pull_request container.
 *
 * When closed without merge:
 * - Remove `ready-to-merge` label only (no state transition).
 *
 * Discovery methods:
 * 1. Code task lookup via findByPR / findLatestExecutionTaskByPR
 * 2. INT-XXX extraction from PR body/title
 *
 * Fire-and-forget: catches errors, logs, never throws.
 */

import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { TaskGroupSummaryRepository } from '../ports/taskGroupSummaryRepository.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { extractIntIssueId } from '../utils/linearIdentifierParser.js';
import { resolveWorkerCredentials } from '../services/gitHubDispatchService.js';

function isPlanPr(prTitle: string | null): boolean {
  return prTitle !== null && /\[plan\]/i.test(prTitle);
}

export interface HandlePrCloseDeps {
  codeTaskRepo: CodeTaskRepository;
  linearIssueService: LinearIssueService;
  userServiceClient: UserServiceClient;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
  groupSummaryRepo: TaskGroupSummaryRepository;
  logger: Logger;
}

export interface HandlePrCloseInput {
  repository: string;
  prNumber: number;
  prBody: string | null;
  prTitle: string | null;
  prAuthorLogin: string | null;
  senderLogin: string;
  isMerged: boolean;
  sourceTimestamp: string;
}

export async function handlePrClose(deps: HandlePrCloseDeps, input: HandlePrCloseInput): Promise<void> {
  const { codeTaskRepo, linearIssueService, userServiceClient, taskDispatcher, workerSettingsRepo, groupSummaryRepo, logger } = deps;
  const { repository, prNumber, prBody, prTitle, prAuthorLogin, senderLogin, isMerged, sourceTimestamp } = input;

  // Map of linearIssueId → userId (deduplicates)
  const issueMap = new Map<string, string>();

  // --- Discovery method 1: Code tasks (parallel queries) ---

  const [findByPRResult, findLatestResult] = await Promise.all([
    codeTaskRepo.findByPR(repository, prNumber),
    codeTaskRepo.findLatestExecutionTaskByPR(repository, prNumber),
  ]);

  if (!findByPRResult.ok) {
    logger.warn(
      { error: findByPRResult.error, repository, prNumber },
      'handlePrClose: findByPR failed'
    );
  } else if (findByPRResult.value?.linearIssueId !== undefined) {
    issueMap.set(findByPRResult.value.linearIssueId, findByPRResult.value.userId);
  }

  if (!findLatestResult.ok) {
    logger.warn(
      { error: findLatestResult.error, repository, prNumber },
      'handlePrClose: findLatestExecutionTaskByPR failed'
    );
  } else if (findLatestResult.value?.linearIssueId !== undefined) {
    if (!issueMap.has(findLatestResult.value.linearIssueId)) {
      issueMap.set(findLatestResult.value.linearIssueId, findLatestResult.value.userId);
    }
  }

  // --- Discovery method 2: INT-XXX / Linear URL from PR body/title ---
  // Note: extractIntIssueId captures only the first INT-XXX per field (by design).

  const bodyIssueId = extractIntIssueId(prBody ?? undefined);
  const titleIssueId = extractIntIssueId(prTitle ?? undefined);

  const textIssueIds = new Set<string>();
  if (bodyIssueId !== null && !issueMap.has(bodyIssueId)) {
    textIssueIds.add(bodyIssueId);
  }
  if (titleIssueId !== null && !issueMap.has(titleIssueId)) {
    textIssueIds.add(titleIssueId);
  }

  if (textIssueIds.size > 0) {
    const login = prAuthorLogin ?? senderLogin;
    const userResult = await userServiceClient.resolveGitHubUsername(login);

    if (!userResult.ok) {
      for (const issueId of textIssueIds) {
        logger.warn(
          { linearIssueId: issueId, login, error: userResult.error },
          'handlePrClose: failed to resolve userId for PR body/title issue'
        );
      }
    } else if (userResult.value === null) {
      for (const issueId of textIssueIds) {
        logger.warn(
          { linearIssueId: issueId, login },
          'handlePrClose: failed to resolve userId — user not found'
        );
      }
    } else {
      const { userId } = userResult.value;
      for (const issueId of textIssueIds) {
        issueMap.set(issueId, userId);
      }
    }
  }

  // --- Transition / Label Cleanup ---

  if (issueMap.size === 0) {
    logger.debug({ repository, prNumber, isMerged }, 'No Linear issues found for closed PR');
  } else {
    const isPlan = isMerged ? isPlanPr(prTitle) : false;
    const mark = isPlan
      ? linearIssueService.markTodo.bind(linearIssueService)
      : linearIssueService.markQa.bind(linearIssueService);

    await Promise.all(
      [...issueMap].map(([linearIssueId, userId]) => {
        const promises: Promise<void>[] = [
          linearIssueService.removeLabel(userId, linearIssueId, 'ready-to-merge'),
        ];
        if (isMerged) {
          const targetState = isPlan ? 'todo' : 'qa';
          logger.info(
            { linearIssueId, userId, repository, prNumber, targetState },
            'Transitioning Linear issue on PR merge'
          );
          promises.push(mark(userId, linearIssueId));
        } else {
          logger.info(
            { linearIssueId, userId, repository, prNumber },
            'Removing ready-to-merge label on PR close without merge'
          );
        }
        return Promise.all(promises);
      })
    );

    // Best-effort: recompute group summary now that ready-to-merge label is removed.
    // Passing [] ensures hasMergeReadyLabel becomes false in the cached summary.
    for (const [linearIssueId, userId] of issueMap) {
      void groupSummaryRepo.recomputeWithLabels(userId, linearIssueId, [], sourceTimestamp).catch((recomputeErr: unknown) => {
        logger.warn({ linearIssueId, error: recomputeErr },
          'handlePrClose: failed to recompute group summary (best-effort)');
      });
    }
  }

  // Best-effort: destroy preserved pull_request container (only on merge)
  if (isMerged) {
    try {
      const preservedResult = await codeTaskRepo.findPreservedPullRequestTask(repository, prNumber);
      if (preservedResult.ok && preservedResult.value !== null) {
        const preserved = preservedResult.value;
        logger.info({ taskId: preserved.id, prNumber }, 'Destroying preserved container for merged PR');
        const workerCreds = await resolveWorkerCredentials(
          workerSettingsRepo, preserved.userId, preserved.workerLocation,
        );
        await taskDispatcher.cancelOnWorker(preserved.id, preserved.workerLocation, workerCreds);
      }
    } catch (error) {
      logger.warn({ prNumber, error }, 'Failed to cleanup preserved container on PR merge (best-effort)');
    }
  }
}
