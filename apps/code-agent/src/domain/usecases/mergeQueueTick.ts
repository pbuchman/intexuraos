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
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { SkippedPr, SkipReason } from '../models/mergeQueueWatch.js';
import type { MergeQueueWatchRepositoryError } from '../repositories/mergeQueueWatchRepository.js';

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
  gitHubPRClient: Pick<GitHubPRClient, 'getPullRequestDetails' | 'getCombinedCheckStatus' | 'mergePullRequest'>;
  gitHubPRSummaryRepo: Pick<GitHubPRSummaryRepository, 'findOpenByBaseBranch'>;
  userServiceClient: UserServiceClient;
  allowedBots: ReadonlySet<string>;
  logger: Logger;
}

export type MergeQueueTickUseCase = () => Promise<Result<TickResult[], MergeQueueWatchRepositoryError>>;

export function createMergeQueueTick(deps: MergeQueueTickDeps): MergeQueueTickUseCase {
  const { mergeQueueWatchRepo, gitHubPRClient, gitHubPRSummaryRepo, userServiceClient, allowedBots, logger } = deps;

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

  /** Record an error on the watch document and return an error TickResult. */
  async function recordErrorAndReturn(
    watchId: string,
    owner: string,
    repo: string,
    baseBranch: string,
    errorMessage: string
  ): Promise<TickResult> {
    const now = new Date();
    logger.error({ watchId }, errorMessage);
    await mergeQueueWatchRepo.update(watchId, {
      lastTickAt: now,
      lastError: errorMessage,
      lastErrorAt: now,
    });
    return { watchId, owner, repo, baseBranch, action: 'error', remainingPrs: 0, skipped: [] };
  }

  /** Update the watch with a successful tick (clears lastError). */
  async function recordSuccessfulTick(
    watchId: string,
    skippedPrs: SkippedPr[],
    extra?: { status?: 'drained'; drainedAt?: Date }
  ): Promise<void> {
    const now = new Date();
    await mergeQueueWatchRepo.update(watchId, {
      lastTickAt: now,
      skippedPrs,
      lastError: null,
      lastErrorAt: null,
      ...extra,
    });
  }

  async function processWatch(
    watch: { id: string; userId: string; gitHubUsername: string; owner: string; repo: string; baseBranch: string; excludedPrNumbers: number[] }
  ): Promise<TickResult> {
    const { id: watchId, userId, gitHubUsername, owner, repo, baseBranch } = watch;

    // Step 3a: Resolve GitHub token
    const tokenResult = await userServiceClient.getOAuthToken(userId, 'github');
    if (!tokenResult.ok) {
      return await recordErrorAndReturn(
        watchId, owner, repo, baseBranch,
        `Token resolution failed: ${tokenResult.error.message}`
      );
    }

    const token = tokenResult.value.accessToken;

    // Step 3c: List open PRs from Firestore cache
    const repository = `${owner}/${repo}`;
    const listResult = await gitHubPRSummaryRepo.findOpenByBaseBranch(repository, baseBranch);
    if (!listResult.ok) {
      return await recordErrorAndReturn(
        watchId, owner, repo, baseBranch,
        `Failed to list PRs: ${listResult.error.message}`
      );
    }

    const allPrs = listResult.value.map((summary) => ({
      number: summary.pullRequestNumber,
      title: summary.title ?? '',
      authorLogin: summary.authorLogin ?? '',
      baseBranch: summary.baseBranch ?? baseBranch,
      headBranch: summary.headBranch ?? '',
    }));

    // Step 3e: Filter to eligible authors
    const eligiblePrs = allPrs.filter(
      (pr) => pr.authorLogin === gitHubUsername || allowedBots.has(pr.authorLogin)
    );

    // Step 3f: Sort by PR number ASC (oldest first)
    eligiblePrs.sort((a, b) => a.number - b.number);

    // Step 3g: If zero eligible PRs, drain
    if (eligiblePrs.length === 0) {
      const now = new Date();
      await recordSuccessfulTick(watchId, [], { status: 'drained', drainedAt: now });
      return { watchId, owner, repo, baseBranch, action: 'drained', remainingPrs: 0, skipped: [] };
    }

    // Filter out excluded PRs (after drain check to avoid premature drain)
    const excludedSet = new Set(watch.excludedPrNumbers);
    const prsToProcess = eligiblePrs.filter((pr) => !excludedSet.has(pr.number));

    // If all eligible PRs are excluded, return skipped_all (not drain — PRs exist, just excluded)
    if (prsToProcess.length === 0) {
      await recordSuccessfulTick(watchId, []);
      return {
        watchId, owner, repo, baseBranch,
        action: 'skipped_all',
        remainingPrs: allPrs.length,
        skipped: [],
      };
    }

    // Step 3h: Iterate eligible PRs
    const skippedList: SkippedPr[] = [];

    for (const pr of prsToProcess) {
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
      await mergeQueueWatchRepo.appendMergedPr(watchId, {
        prNumber: pr.number,
        title: details.title,
        author: details.authorLogin,
      });

      await recordSuccessfulTick(watchId, skippedList);

      return {
        watchId, owner, repo, baseBranch,
        action: 'merged',
        mergedPrNumber: pr.number,
        remainingPrs: allPrs.length - 1,
        skipped: skippedList,
      };
    }

    // Step 3i: No PR was merged after iterating all
    const action: TickAction = skippedList.length > 0 ? 'skipped_all' : 'drained';

    if (action === 'drained') {
      const now = new Date();
      await recordSuccessfulTick(watchId, [], { status: 'drained', drainedAt: now });
    } else {
      await recordSuccessfulTick(watchId, skippedList);
    }

    return {
      watchId, owner, repo, baseBranch,
      action,
      remainingPrs: allPrs.length,
      skipped: skippedList,
    };
  }
}
