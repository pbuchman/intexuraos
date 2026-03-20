/**
 * Use case: Merge queue tick — processes one merge cycle for all active watches.
 *
 * Called by Cloud Scheduler. For each active watch, attempts to merge the oldest
 * eligible PR that passes checks and is mergeable.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { MergeQueueWatchRepository } from '../repositories/mergeQueueWatchRepository.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { SkippedPr, SkipReason } from '../models/mergeQueueWatch.js';
import type { MergeQueueWatchRepositoryError } from '../repositories/mergeQueueWatchRepository.js';
import { Timestamp } from '@google-cloud/firestore';

export type TickAction = 'merged' | 'skipped_all' | 'drained' | 'error';

export interface TickResult {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  action: TickAction;
  mergedPrNumber?: number | undefined;
  remainingPrs: number;
  skipped: SkippedPr[];
}

export interface MergeQueueTickDeps {
  mergeQueueWatchRepo: MergeQueueWatchRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  allowedBots: ReadonlySet<string>;
  logger: Logger;
}

export type MergeQueueTickUseCase = () => Promise<Result<TickResult[], MergeQueueWatchRepositoryError>>;

export function createMergeQueueTick(deps: MergeQueueTickDeps): MergeQueueTickUseCase {
  const { mergeQueueWatchRepo, gitHubPRClient, userServiceClient, allowedBots, logger } = deps;

  return async (): Promise<Result<TickResult[], MergeQueueWatchRepositoryError>> => {
    // Step 1: Query all active watches
    const activeResult = await mergeQueueWatchRepo.findAllActive();
    if (!activeResult.ok) {
      return err(activeResult.error);
    }

    const watches = activeResult.value;
    if (watches.length === 0) {
      return ok([]);
    }

    const results: TickResult[] = [];

    for (const watch of watches) {
      const tickResult = await processWatch(watch);
      results.push(tickResult);
    }

    return ok(results);
  };

  async function processWatch(
    watch: { id: string; userId: string; gitHubUsername: string; owner: string; repo: string; baseBranch: string }
  ): Promise<TickResult> {
    const { id: watchId, userId, gitHubUsername, owner, repo, baseBranch } = watch;

    // Step 3a: Resolve GitHub token
    const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
    if (!tokenResult.ok) {
      const errorMessage = `Token resolution failed: ${tokenResult.error.message}`;
      logger.error({ watchId, error: tokenResult.error }, errorMessage);
      await mergeQueueWatchRepo.update(watchId, {
        lastTickAt: new Date(),
        lastError: errorMessage,
        lastErrorAt: new Date(),
      });
      return {
        watchId,
        owner,
        repo,
        baseBranch,
        action: 'error',
        remainingPrs: 0,
        skipped: [],
      };
    }

    const token = tokenResult.value.accessToken;

    // Step 3c: List open PRs
    const listResult = await gitHubPRClient.listOpenPullRequestsByBaseBranch(token, owner, repo, baseBranch);
    if (!listResult.ok) {
      const errorMessage = `Failed to list PRs: ${listResult.error.message}`;
      logger.error({ watchId, error: listResult.error }, errorMessage);
      await mergeQueueWatchRepo.update(watchId, {
        lastTickAt: new Date(),
        lastError: errorMessage,
        lastErrorAt: new Date(),
      });
      return {
        watchId,
        owner,
        repo,
        baseBranch,
        action: 'error',
        remainingPrs: 0,
        skipped: [],
      };
    }

    const allPrs = listResult.value;

    // Step 3e: Filter to eligible authors
    const eligiblePrs = allPrs.filter(
      (pr) => pr.authorLogin === gitHubUsername || allowedBots.has(pr.authorLogin)
    );

    // Step 3f: Sort by createdAt ASC, tiebreak by PR number ASC
    eligiblePrs.sort((a, b) => {
      const dateCompare = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.number - b.number;
    });

    // Step 3g: If zero eligible PRs, drain
    if (eligiblePrs.length === 0) {
      await mergeQueueWatchRepo.update(watchId, {
        status: 'drained',
        drainedAt: new Date(),
        skippedPrs: [],
        lastTickAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      });
      return {
        watchId,
        owner,
        repo,
        baseBranch,
        action: 'drained',
        remainingPrs: 0,
        skipped: [],
      };
    }

    // Step 3h: Iterate eligible PRs
    const skippedList: SkippedPr[] = [];
    let mergedCount = 0;

    for (const pr of eligiblePrs) {
      // Get PR details
      const detailsResult = await gitHubPRClient.getPullRequestDetails(token, owner, repo, pr.number);
      if (!detailsResult.ok) {
        const reason: SkipReason = 'checks_pending';
        skippedList.push({ prNumber: pr.number, reason });
        logger.warn({ watchId, prNumber: pr.number, error: detailsResult.error }, 'Failed to get PR details, skipping');
        continue;
      }

      const details = detailsResult.value;

      // Check mergeable
      if (details.mergeable === null) {
        skippedList.push({ prNumber: pr.number, reason: 'mergeability_unknown' });
        continue;
      }

      if (!details.mergeable) {
        skippedList.push({ prNumber: pr.number, reason: 'merge_conflict' });
        continue;
      }

      // Get check status
      const checksResult = await gitHubPRClient.getCombinedCheckStatus(token, owner, repo, details.headSha);
      if (!checksResult.ok) {
        skippedList.push({ prNumber: pr.number, reason: 'checks_pending' });
        logger.warn({ watchId, prNumber: pr.number, error: checksResult.error }, 'Failed to get check status, skipping');
        continue;
      }

      const checkState = checksResult.value.state;

      if (checkState === 'failure') {
        skippedList.push({ prNumber: pr.number, reason: 'checks_failing' });
        continue;
      }

      if (checkState === 'pending') {
        skippedList.push({ prNumber: pr.number, reason: 'checks_pending' });
        continue;
      }

      // checkState === 'success' AND mergeable === true
      const mergeResult = await gitHubPRClient.mergePullRequest(token, owner, repo, pr.number, 'merge');
      if (!mergeResult.ok) {
        // Merge failed — skip with merge_conflict
        skippedList.push({ prNumber: pr.number, reason: 'merge_conflict' });
        logger.warn({ watchId, prNumber: pr.number, error: mergeResult.error }, 'Merge failed, skipping');
        continue;
      }

      // Check if already merged (405 response — sha is empty string)
      if (mergeResult.value.sha === '') {
        // Already merged — skip to next PR, do NOT add to mergedPrs
        logger.info({ watchId, prNumber: pr.number }, 'PR already merged (405), skipping');
        continue;
      }

      // Successfully merged
      mergedCount = 1;

      await mergeQueueWatchRepo.appendMergedPr(watchId, {
        prNumber: pr.number,
        title: details.title,
        author: details.authorLogin,
        mergedAt: Timestamp.now(),
      });

      await mergeQueueWatchRepo.update(watchId, {
        lastTickAt: new Date(),
        skippedPrs: skippedList,
        lastError: null,
        lastErrorAt: null,
      });

      return {
        watchId,
        owner,
        repo,
        baseBranch,
        action: 'merged',
        mergedPrNumber: pr.number,
        remainingPrs: allPrs.length - mergedCount,
        skipped: skippedList,
      };
    }

    // Step 3i: No PR was merged after iterating all
    const action: TickAction = skippedList.length > 0 ? 'skipped_all' : 'drained';

    if (action === 'drained') {
      await mergeQueueWatchRepo.update(watchId, {
        status: 'drained',
        drainedAt: new Date(),
        skippedPrs: [],
        lastTickAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      });
    } else {
      await mergeQueueWatchRepo.update(watchId, {
        lastTickAt: new Date(),
        skippedPrs: skippedList,
        lastError: null,
        lastErrorAt: null,
      });
    }

    return {
      watchId,
      owner,
      repo,
      baseBranch,
      action,
      remainingPrs: allPrs.length - mergedCount,
      skipped: skippedList,
    };
  }
}
