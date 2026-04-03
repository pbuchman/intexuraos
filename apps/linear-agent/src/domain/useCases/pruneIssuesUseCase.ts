/**
 * Prune redundant Linear issues to stay under subscription limits.
 *
 * Orchestrates: threshold check -> Gemini classification -> store candidates in Firestore for user review.
 * All actions logged via structured logging (Cloud Logging).
 */

import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  LinearConnectionRepository,
  LinearIssueRepository,
  IssuePruningClassifier,
  PruneCandidateRepository,
  LinearError,
  PruneConfig,
  PruneStats,
  StoredPruneCandidate,
  SyncedLinearIssue,
} from '../index.js';

export interface PruneIssuesDeps {
  connectionRepo: Pick<LinearConnectionRepository, 'getAllConnectedUserIds'>;
  issueRepo: Pick<LinearIssueRepository, 'listByUserId'>;
  pruneCandidateRepo: PruneCandidateRepository;
  classifier: IssuePruningClassifier;
  logger: Logger;
  config: PruneConfig;
}

export async function pruneIssues(
  deps: PruneIssuesDeps
): Promise<Result<PruneStats, LinearError>> {
  const { connectionRepo, issueRepo, pruneCandidateRepo, classifier, logger, config } = deps;
  const startTime = Date.now();

  logger.info({ config }, 'Starting issue pruning workflow');

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

  const allIssuesMap = new Map<string, { issue: SyncedLinearIssue; userIds: string[] }>();

  const issueResults = await Promise.all(
    userIds.map(async (userId) => ({ userId, result: await issueRepo.listByUserId(userId) }))
  );

  for (const { userId, result: issuesResult } of issueResults) {
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

  const clearResult = await pruneCandidateRepo.clearAll();
  if (!clearResult.ok) {
    return clearResult;
  }

  // Single timestamp for the entire batch — all candidates from one run share the same classification time
  const classifiedAt = new Date().toISOString();
  const storedCandidates: StoredPruneCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    classifiedAt,
  }));

  const storeResult = await pruneCandidateRepo.storeAll(storedCandidates);
  if (!storeResult.ok) {
    return storeResult;
  }

  const stats: PruneStats = {
    skipped: false,
    totalActive,
    stored: storedCandidates.length,
    remaining: totalActive,
    storedCandidates,
    durationMs: Date.now() - startTime,
  };

  logger.info(stats, 'Issue pruning workflow completed');

  return ok(stats);
}
