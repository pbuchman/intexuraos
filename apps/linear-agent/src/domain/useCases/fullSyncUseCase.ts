/**
 * Full sync of all Linear issues for a user.
 */
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type {
  LinearIssueRepository,
  LinearConnectionRepository,
  LinearApiClient,
  LinearError,
} from '../index.js';
import { mapApiIssueToSyncedIssue } from '../issueMapper.js';

export interface FullSyncDeps {
  issueRepo: LinearIssueRepository;
  connectionRepo: LinearConnectionRepository;
  linearClient: LinearApiClient;
  logger: Logger;
}

export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  total: number;
  durationMs: number;
  syncedAt: string;
}

/**
 * Perform a full sync of all Linear issues for a user.
 *
 * @param userId - User ID to sync issues for
 * @param deps - Dependencies
 */
export async function fullSync(
  userId: string,
  deps: FullSyncDeps
): Promise<Result<SyncStats, LinearError>> {
  const { issueRepo, connectionRepo, linearClient, logger } = deps;
  const startTime = Date.now();

  logger.info({ userId }, 'Starting full sync');

  // Get user's Linear connection
  const connectionResult = await connectionRepo.getFullConnection(userId);
  if (!connectionResult.ok) {
    return connectionResult;
  }

  const connection = connectionResult.value;
  if (connection === null) {
    return err({ code: 'NOT_CONNECTED', message: 'User is not connected to Linear' });
  }

  // Fetch all issues from Linear API
  const issuesResult = await linearClient.listIssues(connection.apiKey, connection.teamId);
  if (!issuesResult.ok) {
    logger.error({ error: issuesResult.error, userId, teamId: connection.teamId }, 'Failed to fetch issues from Linear');
    return issuesResult;
  }

  const linearIssues = issuesResult.value;
  logger.info({ count: linearIssues.length }, 'Fetched issues from Linear');

  // Get existing local issues to track deletions
  const existingResult = await issueRepo.listByUserId(userId);
  if (!existingResult.ok) {
    return existingResult;
  }

  const existingIssueIds = new Set(existingResult.value.map((i) => i.id));
  const linearIssueIds = new Set(linearIssues.map((i) => i.id));

  let created = 0;
  let updated = 0;
  let deleted = 0;

  // Upsert all issues from Linear
  for (const linearIssue of linearIssues) {
    const syncedIssue = mapApiIssueToSyncedIssue(linearIssue, userId, connection.teamId);
    const saveResult = await issueRepo.save(syncedIssue);
    if (!saveResult.ok) {
      logger.error({ error: saveResult.error, issueId: linearIssue.id }, 'Failed to save issue');
      continue;
    }

    if (existingIssueIds.has(linearIssue.id)) {
      updated++;
    } else {
      created++;
    }
  }

  // Delete issues that no longer exist in Linear (scoped to this user)
  for (const existingId of existingIssueIds) {
    if (!linearIssueIds.has(existingId)) {
      const deleteResult = await issueRepo.deleteById(existingId, userId);
      if (deleteResult.ok) {
        deleted++;
      } else {
        logger.error({ error: deleteResult.error, issueId: existingId }, 'Failed to delete stale issue');
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const stats: SyncStats = {
    created,
    updated,
    deleted,
    total: linearIssues.length,
    durationMs,
    syncedAt: new Date().toISOString(),
  };

  logger.info(stats, 'Full sync completed');
  return ok(stats);
}

/**
 * Full sync for all connected users (used by Cloud Scheduler).
 */
export async function fullSyncAllUsers(deps: FullSyncDeps & {
  getAllConnectedUserIds: () => Promise<Result<string[], LinearError>>;
}): Promise<Result<{ userCount: number; totalIssues: number }, LinearError>> {
  const { logger, getAllConnectedUserIds } = deps;

  const userIdsResult = await getAllConnectedUserIds();

  if (!userIdsResult.ok) {
    return userIdsResult;
  }

  const userIds = userIdsResult.value;
  logger.info({ userCount: userIds.length }, 'Starting full sync for all users');

  let totalIssues = 0;
  for (const userId of userIds) {
    const result = await fullSync(userId, deps);
    if (result.ok) {
      totalIssues += result.value.total;
    } else {
      logger.error({ userId, error: result.error }, 'Failed to sync user');
    }
  }

  return ok({ userCount: userIds.length, totalIssues });
}
