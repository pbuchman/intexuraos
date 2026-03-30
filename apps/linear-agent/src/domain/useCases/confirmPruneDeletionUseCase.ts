/**
 * Confirm and execute the deletion of prune candidates.
 *
 * Called when the user clicks "Delete All" in the web app after reviewing candidates.
 * Loads candidates from Firestore, deletes them via Linear API, cleans up local copies,
 * and clears the candidates collection.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  LinearConnectionRepository,
  LinearIssueRepository,
  LinearApiClient,
  PruneCandidateRepository,
  LinearError,
  PruneDeleteStats,
} from '../index.js';

export interface ConfirmPruneDeletionDeps {
  connectionRepo: Pick<LinearConnectionRepository, 'getAllConnectedUserIds' | 'getFullConnection'>;
  issueRepo: Pick<LinearIssueRepository, 'listByUserId' | 'deleteById'>;
  linearClient: Pick<LinearApiClient, 'deleteIssue'>;
  pruneCandidateRepo: PruneCandidateRepository;
  logger: Logger;
}

/**
 * Execute deletion of all stored prune candidates.
 *
 * 1. Load all candidates from Firestore
 * 2. Get an API key from the first connected user
 * 3. Build a map of issue ID → userIds for multi-tenant cleanup
 * 4. Delete each candidate from Linear, clean up local Firestore copies
 * 5. Clear the prune candidates collection
 */
export async function confirmPruneDeletion(
  deps: ConfirmPruneDeletionDeps
): Promise<Result<PruneDeleteStats, LinearError>> {
  const { connectionRepo, issueRepo, linearClient, pruneCandidateRepo, logger } = deps;
  const startTime = Date.now();

  // Step 1: Load all candidates
  const candidatesResult = await pruneCandidateRepo.listAll();
  if (!candidatesResult.ok) {
    return candidatesResult;
  }

  const candidates = candidatesResult.value;
  if (candidates.length === 0) {
    return ok({ deleted: 0, failedDeletions: [], durationMs: Date.now() - startTime });
  }

  // Step 2: Get all connected user IDs
  const usersResult = await connectionRepo.getAllConnectedUserIds();
  if (!usersResult.ok) {
    return usersResult;
  }

  const userIds = usersResult.value;
  if (userIds.length === 0) {
    return err({ code: 'NOT_CONNECTED', message: 'No connected users found for API operations' });
  }

  // Step 3: Get API key from first connected user
  const firstUserId = userIds[0];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces undefined check on userIds[0] despite length check above @preserve */
  if (firstUserId === undefined) {
    return err({ code: 'NOT_CONNECTED', message: 'No connected users found for API operations' });
  }
  /* v8 ignore stop @preserve */
  const connectionResult = await connectionRepo.getFullConnection(firstUserId);
  if (!connectionResult.ok) {
    return connectionResult;
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'No connected user found for API operations' });
  }

  const apiKey = connection.apiKey;

  // Step 4: Build issue-to-users map for multi-tenant cleanup
  const issueToUsers = new Map<string, string[]>();

  for (const userId of userIds) {
    const issuesResult = await issueRepo.listByUserId(userId);
    if (!issuesResult.ok) {
      logger.warn({ userId, error: issuesResult.error }, 'Failed to list issues for user, skipping for local cleanup');
      continue;
    }

    for (const issue of issuesResult.value) {
      const existing = issueToUsers.get(issue.id);
      if (existing !== undefined) {
        existing.push(userId);
      } else {
        issueToUsers.set(issue.id, [userId]);
      }
    }
  }

  // Step 5: Delete each candidate
  const deletedCandidates: string[] = [];
  const failedDeletions: { identifier: string; error: string }[] = [];

  for (const candidate of candidates) {
    logger.info(
      { identifier: candidate.identifier, score: candidate.score, reason: candidate.reason, category: candidate.category },
      'Deleting issue'
    );

    const deleteResult = await linearClient.deleteIssue(apiKey, candidate.id);
    if (!deleteResult.ok) {
      logger.error({ identifier: candidate.identifier, error: deleteResult.error }, 'Failed to delete issue from Linear');
      failedDeletions.push({ identifier: candidate.identifier, error: deleteResult.error.message });
      continue;
    }

    logger.info({ identifier: candidate.identifier }, 'Issue deleted successfully');

    // Clean up local Firestore copies
    const owningUserIds = issueToUsers.get(candidate.id) ?? [];
    for (const userId of owningUserIds) {
      const localDeleteResult = await issueRepo.deleteById(candidate.id, userId);
      if (!localDeleteResult.ok) {
        logger.warn(
          { identifier: candidate.identifier, userId, error: localDeleteResult.error },
          'Failed to delete local Firestore copy (non-fatal)'
        );
      }
    }

    deletedCandidates.push(candidate.id);
  }

  // Step 6: Clear the prune candidates collection
  const clearResult = await pruneCandidateRepo.clearAll();
  if (!clearResult.ok) {
    logger.warn({ error: clearResult.error }, 'Failed to clear prune candidates collection (non-fatal — issues already deleted from Linear)');
  }

  return ok({
    deleted: deletedCandidates.length,
    failedDeletions,
    durationMs: Date.now() - startTime,
  });
}
