/**
 * Use case: Transition associated Linear issues on PR merge.
 *
 * Plan PRs (detected by `[plan]` in title) transition to Todo.
 * All other PRs transition to QA.
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
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { extractIntIssueId } from '../utils/linearIdentifierParser.js';

function isPlanPr(prTitle: string | null): boolean {
  return prTitle !== null && /\[plan\]/i.test(prTitle);
}

export interface HandlePrMergeDeps {
  codeTaskRepo: CodeTaskRepository;
  linearIssueService: LinearIssueService;
  userServiceClient: UserServiceClient;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
  logger: Logger;
}

export interface HandlePrMergeInput {
  repository: string;
  prNumber: number;
  prBody: string | null;
  prTitle: string | null;
  prAuthorLogin: string | null;
  senderLogin: string;
}

export async function handlePrMerge(deps: HandlePrMergeDeps, input: HandlePrMergeInput): Promise<void> {
  const { codeTaskRepo, linearIssueService, userServiceClient, taskDispatcher, workerSettingsRepo, logger } = deps;
  const { repository, prNumber, prBody, prTitle, prAuthorLogin, senderLogin } = input;

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
      'handlePrMerge: findByPR failed'
    );
  } else if (findByPRResult.value?.linearIssueId !== undefined) {
    issueMap.set(findByPRResult.value.linearIssueId, findByPRResult.value.userId);
  }

  if (!findLatestResult.ok) {
    logger.warn(
      { error: findLatestResult.error, repository, prNumber },
      'handlePrMerge: findLatestExecutionTaskByPR failed'
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
          'handlePrMerge: failed to resolve userId for PR body/title issue'
        );
      }
    } else if (userResult.value === null) {
      for (const issueId of textIssueIds) {
        logger.warn(
          { linearIssueId: issueId, login },
          'handlePrMerge: failed to resolve userId — user not found'
        );
      }
    } else {
      const { userId } = userResult.value;
      for (const issueId of textIssueIds) {
        issueMap.set(issueId, userId);
      }
    }
  }

  // --- Transition ---

  if (issueMap.size === 0) {
    logger.debug({ repository, prNumber }, 'No Linear issues found for merged PR');
  } else {
    const isPlan = isPlanPr(prTitle);
    const mark = isPlan
      ? linearIssueService.markTodo.bind(linearIssueService)
      : linearIssueService.markQa.bind(linearIssueService);
    const targetState = isPlan ? 'todo' : 'qa';

    await Promise.all(
      [...issueMap].map(([linearIssueId, userId]) => {
        logger.info(
          { linearIssueId, userId, repository, prNumber, targetState },
          'Transitioning Linear issue on PR merge'
        );
        return mark(userId, linearIssueId);
      })
    );
  }

  // Best-effort: destroy preserved pull_request container for merged PR
  try {
    const preservedResult = await codeTaskRepo.findPreservedPullRequestTask(repository, prNumber);
    if (preservedResult.ok && preservedResult.value !== null) {
      const preserved = preservedResult.value;
      logger.info({ taskId: preserved.id, prNumber }, 'Destroying preserved container for merged PR');
      let workerCreds: { url: string; cfAccessClientId: string; cfAccessClientSecret: string } | undefined;
      const settingsResult = await workerSettingsRepo.getSettings(preserved.userId);
      if (settingsResult.ok && settingsResult.value !== null) {
        const settings = settingsResult.value;
        const workerConfig = settings.workers.find((w) => w.name === preserved.workerLocation);
        if (workerConfig?.enabled === true) {
          workerCreds = {
            url: workerConfig.url,
            cfAccessClientId: workerConfig.cfAccessClientId,
            cfAccessClientSecret: workerConfig.cfAccessClientSecret,
          };
        }
      }
      await taskDispatcher.cancelOnWorker(preserved.id, preserved.workerLocation, workerCreds);
    }
  } catch (error) {
    logger.warn({ prNumber, error }, 'Failed to cleanup preserved container on PR merge (best-effort)');
  }
}
