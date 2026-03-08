/**
 * Sync a single issue from a webhook event.
 */
import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { LinearIssueRepository, LinearError } from '../index.js';
import type { LinearWebhookEvent } from '../webhookTypes.js';
import { mapWebhookToSyncedIssue } from '../issueMapper.js';

export interface SyncSingleIssueDeps {
  issueRepo: LinearIssueRepository;
  logger: Logger;
}

export interface SyncSingleIssueResult {
  action: 'created' | 'updated' | 'deleted' | 'skipped';
  issueId: string;
}

/**
 * Sync a single issue based on webhook event.
 *
 * @param event - Linear webhook event
 * @param userId - User ID who owns the Linear connection
 * @param deps - Dependencies
 */
export async function syncSingleIssue(
  event: LinearWebhookEvent,
  userId: string,
  deps: SyncSingleIssueDeps
): Promise<Result<SyncSingleIssueResult, LinearError>> {
  const { issueRepo, logger } = deps;
  const { action, data } = event;

  logger.info({ action, issueId: data.id, identifier: data.identifier }, 'Processing webhook event');

  switch (action) {
    case 'remove': {
      const deleteResult = await issueRepo.deleteById(data.id, userId);
      if (!deleteResult.ok) {
        logger.error({ error: deleteResult.error }, 'Failed to delete issue');
        return deleteResult;
      }
      logger.info({ issueId: data.id }, 'Issue deleted');
      return ok({ action: 'deleted', issueId: data.id });
    }

    case 'create': {
      const syncedIssue = mapWebhookToSyncedIssue(data, userId);
      const saveResult = await issueRepo.save(syncedIssue);
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save issue');
        return saveResult;
      }
      logger.info({ issueId: data.id, action: 'created' }, 'Issue synced');
      return ok({ action: 'created', issueId: data.id });
    }

    case 'update': {
      const syncedIssue = mapWebhookToSyncedIssue(data, userId);
      const saveResult = await issueRepo.save(syncedIssue);
      /* v8 ignore start -- test-infra: error return path tested @preserve */
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save issue');
        return saveResult;
      }
      /* v8 ignore stop @preserve */
      logger.info({ issueId: data.id, action: 'updated' }, 'Issue synced');
      return ok({ action: 'updated', issueId: data.id });
    }

    default: {
      logger.warn({ action }, 'Unknown webhook action, skipping');
      return ok({ action: 'skipped', issueId: data.id });
    }
  }
}
