/**
 * Prune redundant Linear issues to stay under subscription limits.
 *
 * Orchestrates: threshold check -> Gemini classification -> Linear API deletion -> Firestore cleanup.
 * All actions logged via structured logging (Cloud Logging).
 */

import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  LinearConnectionRepository,
  LinearIssueRepository,
  LinearApiClient,
  IssuePruningClassifier,
  LinearError,
  PruneConfig,
  PruneStats,
  SyncedLinearIssue,
} from '../index.js';

export interface PruneIssuesDeps {
  connectionRepo: Pick<LinearConnectionRepository, 'getAllConnectedUserIds' | 'getFullConnection'>;
  issueRepo: Pick<LinearIssueRepository, 'listByUserId' | 'deleteById'>;
  linearClient: Pick<LinearApiClient, 'deleteIssue'>;
  classifier: IssuePruningClassifier;
  logger: Logger;
  config: PruneConfig;
}

/**
 * Run the issue pruning workflow for all connected users.
 *
 * 1. Get all connected users and aggregate their synced issue count
 * 2. If total unique issues exceed activation threshold, classify candidates
 * 3. Delete top candidates via Linear API
 * 4. Clean up local Firestore copies
 */
export async function pruneIssues(
  deps: PruneIssuesDeps
): Promise<Result<PruneStats, LinearError>> {
  const { connectionRepo, issueRepo, classifier, logger, config } = deps;
  const startTime = Date.now();

  logger.info({ config }, 'Starting issue pruning workflow');

  // Step 1: Get all connected users
  const usersResult = await connectionRepo.getAllConnectedUserIds();
  if (!usersResult.ok) {
    return usersResult;
  }

  const userIds = usersResult.value;
  if (userIds.length === 0) {
    logger.info('No connected users found, skipping pruning');
    return ok({
      skipped: true,
      skipReason: 'No connected users',
      totalActive: 0,
      stored: 0,
      remaining: 0,
      storedCandidates: [],
      durationMs: Date.now() - startTime,
    });
  }

  // Step 2: Aggregate all issues across users (deduplicate by issue ID)
  const allIssuesMap = new Map<string, { issue: SyncedLinearIssue; userIds: string[] }>();

  for (const userId of userIds) {
    const issuesResult = await issueRepo.listByUserId(userId);
    if (!issuesResult.ok) {
      logger.error({ userId, error: issuesResult.error }, 'Failed to list issues for user, continuing');
      continue;
    }

    for (const issue of issuesResult.value) {
      const existing = allIssuesMap.get(issue.id);
      if (existing !== undefined) {
        existing.userIds.push(userId);
      } else {
        allIssuesMap.set(issue.id, { issue, userIds: [userId] });
      }
    }
  }

  const totalActive = allIssuesMap.size;
  logger.info({ totalActive, threshold: config.activationThreshold }, 'Issue count check');

  // Step 3: Check threshold
  if (totalActive <= config.activationThreshold) {
    logger.info(
      { totalActive, threshold: config.activationThreshold },
      'Issue count below threshold, skipping pruning'
    );
    return ok({
      skipped: true,
      skipReason: `Issue count (${String(totalActive)}) is below threshold (${String(config.activationThreshold)})`,
      totalActive,
      stored: 0,
      remaining: totalActive,
      storedCandidates: [],
      durationMs: Date.now() - startTime,
    });
  }

  // Step 4: Classify candidates using Gemini
  const allIssues = [...allIssuesMap.values()].map((entry) => entry.issue);
  const classifyResult = await classifier.classifyCandidates(
    allIssues,
    config.targetDeletionCount,
    logger
  );

  if (!classifyResult.ok) {
    return classifyResult;
  }

  const candidates = classifyResult.value;
  logger.info({ candidateCount: candidates.length }, 'Classification complete, storing candidates for review');

  // Step 5: Store candidates for user review
  const storedCandidates: PruneStats['storedCandidates'] = [];

  for (const candidate of candidates) {
    logger.info(
      { identifier: candidate.identifier, score: candidate.score, reason: candidate.reason, category: candidate.category },
      'Storing candidate for review'
    );

    storedCandidates.push({
      identifier: candidate.identifier,
      title: candidate.title,
      reason: candidate.reason,
      score: candidate.score,
      category: candidate.category,
    });
  }

  const stats: PruneStats = {
    skipped: false,
    totalActive,
    stored: storedCandidates.length,
    remaining: totalActive - storedCandidates.length,
    storedCandidates,
    durationMs: Date.now() - startTime,
  };

  logger.info(stats, 'Issue pruning workflow completed');

  return ok(stats);
}
