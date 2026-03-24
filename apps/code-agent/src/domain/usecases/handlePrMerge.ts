/**
 * Use case: Transition associated Linear issues to QA when a PR is merged.
 *
 * Discovery methods:
 * 1. Code task lookup via findByPR / findLatestNonReviewTaskByPR
 * 2. INT-XXX extraction from PR body/title
 *
 * Fire-and-forget: catches errors, logs, never throws.
 */

import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../services/linearIssueService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { extractIntIssueId } from '../utils/linearIdentifierParser.js';

export interface HandlePrMergeDeps {
  codeTaskRepo: CodeTaskRepository;
  linearIssueService: LinearIssueService;
  userServiceClient: UserServiceClient;
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
  const { codeTaskRepo, linearIssueService, userServiceClient, logger } = deps;
  const { repository, prNumber, prBody, prTitle, prAuthorLogin, senderLogin } = input;

  // Map of linearIssueId → userId (deduplicates)
  const issueMap = new Map<string, string>();

  // --- Discovery method 1: Code tasks (parallel queries) ---

  const [findByPRResult, findLatestResult] = await Promise.all([
    codeTaskRepo.findByPR(repository, prNumber),
    codeTaskRepo.findLatestNonReviewTaskByPR(repository, prNumber),
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
      'handlePrMerge: findLatestNonReviewTaskByPR failed'
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
    return;
  }

  await Promise.all(
    [...issueMap].map(([linearIssueId, userId]) => {
      logger.info(
        { linearIssueId, userId, repository, prNumber },
        'Transitioning Linear issue to QA on PR merge'
      );
      return linearIssueService.markQa(userId, linearIssueId);
    })
  );
}
