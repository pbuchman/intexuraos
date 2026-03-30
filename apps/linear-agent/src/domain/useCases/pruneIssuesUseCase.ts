/**
 * Prune redundant Linear issues to stay under subscription limits.
 *
 * Orchestrates: threshold check -> Gemini classification -> Linear API deletion -> Firestore cleanup.
 * All actions logged via structured logging (Cloud Logging).
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
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
  const { connectionRepo, issueRepo, linearClient, classifier, logger, config } = deps;
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
      deleted: 0,
      remaining: 0,
      deletedCandidates: [],
      failedDeletions: [],
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
      deleted: 0,
      remaining: totalActive,
      deletedCandidates: [],
      failedDeletions: [],
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
  logger.info({ candidateCount: candidates.length }, 'Classification complete, starting deletions');

  // Step 5: Get API key for deletion (use first connected user's key)
  // NOTE: In a single-org Linear setup, any member's API key can delete any issue
  // in the workspace. This is safe because IntexuraOS operates as a single-organization
  // system. If multi-org support is added in the future, this must be revisited to
  // use per-user keys matched to issue ownership.
  const connectionResult = await connectionRepo.getFullConnection(userIds[0]!);
  if (!connectionResult.ok) {
    return connectionResult;
  }
  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'No connected user found for API operations' });
  }

  // Step 6: Delete candidates
  const deletedCandidates: PruneStats['deletedCandidates'] = [];
  const failedDeletions: PruneStats['failedDeletions'] = [];

  for (const candidate of candidates) {
    logger.info(
      { identifier: candidate.identifier, score: candidate.score, reason: candidate.reason, category: candidate.category },
      'Deleting issue'
    );

    const deleteResult = await linearClient.deleteIssue(connection.apiKey, candidate.id);

    if (!deleteResult.ok) {
      logger.error(
        { identifier: candidate.identifier, error: deleteResult.error },
        'Failed to delete issue from Linear'
      );
      failedDeletions.push({ identifier: candidate.identifier, error: deleteResult.error.message });
      continue;
    }

    // Clean up all local Firestore copies (multi-tenant: each user may have a copy)
    const entry = allIssuesMap.get(candidate.id);
    if (entry !== undefined) {
      for (const userId of entry.userIds) {
        const localDeleteResult = await issueRepo.deleteById(candidate.id, userId);
        if (!localDeleteResult.ok) {
          logger.warn(
            { identifier: candidate.identifier, userId, error: localDeleteResult.error },
            'Failed to delete local Firestore copy (non-fatal)'
          );
        }
      }
    }

    deletedCandidates.push({
      identifier: candidate.identifier,
      title: candidate.title,
      reason: candidate.reason,
    });

    logger.info({ identifier: candidate.identifier }, 'Issue deleted successfully');
  }

  const stats: PruneStats = {
    skipped: false,
    totalActive,
    deleted: deletedCandidates.length,
    remaining: totalActive - deletedCandidates.length,
    deletedCandidates,
    failedDeletions,
    durationMs: Date.now() - startTime,
  };

  logger.info(stats, 'Issue pruning workflow completed');

  return ok(stats);
}
