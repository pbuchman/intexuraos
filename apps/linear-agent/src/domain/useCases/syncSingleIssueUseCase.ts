/**
 * Sync a single issue from a webhook event.
 */
import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { LinearConnectionRepository, LinearIssueRepository, LinearApiClient, LinearError } from '../index.js';
import type { LinearWebhookEvent } from '../webhookTypes.js';
import { mapApiIssueToSyncedIssue, mapWebhookToSyncedIssue } from '../issueMapper.js';

export interface SyncSingleIssueDeps {
  issueRepo: LinearIssueRepository;
  connectionRepo: LinearConnectionRepository;
  linearApiClient: LinearApiClient;
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
  const { issueRepo, connectionRepo, linearApiClient, logger } = deps;
  const { action, data } = event;

  logger.info({ action, issueId: data.id, identifier: data.identifier }, 'Processing webhook event');

  const buildSyncedIssue = async (): Promise<{
    syncedIssue: ReturnType<typeof mapWebhookToSyncedIssue>;
    syncSource: 'api_hydrated' | 'webhook_fallback';
    childCount: number | null;
  }> => {
    const connectionResult = await connectionRepo.getFullConnection(userId);
    if (!connectionResult.ok) {
      logger.warn(
        { userId, issueId: data.id, identifier: data.identifier, error: connectionResult.error },
        'Webhook sync hydration skipped: failed to load Linear connection',
      );
      const fallback = mapWebhookToSyncedIssue(data, userId);
      return { syncedIssue: fallback, syncSource: 'webhook_fallback', childCount: null };
    }

    const connection = connectionResult.value;
    if (connection === null) {
      logger.warn(
        { userId, issueId: data.id, identifier: data.identifier },
        'Webhook sync hydration skipped: user has no Linear connection',
      );
      const fallback = mapWebhookToSyncedIssue(data, userId);
      return { syncedIssue: fallback, syncSource: 'webhook_fallback', childCount: null };
    }

    const liveIssueResult = await linearApiClient.getIssue(connection.apiKey, data.id);
    if (!liveIssueResult.ok) {
      logger.warn(
        { userId, issueId: data.id, identifier: data.identifier, error: liveIssueResult.error },
        'Webhook sync hydration failed, falling back to webhook payload',
      );
      const fallback = mapWebhookToSyncedIssue(data, userId);
      return { syncedIssue: fallback, syncSource: 'webhook_fallback', childCount: null };
    }

    if (liveIssueResult.value === null) {
      logger.warn(
        { userId, issueId: data.id, identifier: data.identifier },
        'Webhook sync hydration returned no issue, falling back to webhook payload',
      );
      const fallback = mapWebhookToSyncedIssue(data, userId);
      return { syncedIssue: fallback, syncSource: 'webhook_fallback', childCount: null };
    }

    const hydrated = mapApiIssueToSyncedIssue(liveIssueResult.value, userId, connection.teamId);
    return {
      syncedIssue: hydrated,
      syncSource: 'api_hydrated',
      childCount: liveIssueResult.value.childCount,
    };
  };

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
      const { syncedIssue, syncSource, childCount } = await buildSyncedIssue();
      const saveResult = await issueRepo.save(syncedIssue);
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save issue');
        return saveResult;
      }
      logger.info(
        {
          issueId: data.id,
          identifier: data.identifier,
          action: 'created',
          parentId: syncedIssue.parentId,
          childCount,
          syncSource,
        },
        'Issue synced',
      );
      return ok({ action: 'created', issueId: data.id });
    }

    case 'update': {
      const { syncedIssue, syncSource, childCount } = await buildSyncedIssue();
      const saveResult = await issueRepo.save(syncedIssue);
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save issue');
        return saveResult;
      }
      logger.info(
        {
          issueId: data.id,
          identifier: data.identifier,
          action: 'updated',
          parentId: syncedIssue.parentId,
          childCount,
          syncSource,
        },
        'Issue synced',
      );
      return ok({ action: 'updated', issueId: data.id });
    }

    default: {
      logger.warn({ action }, 'Unknown webhook action, skipping');
      return ok({ action: 'skipped', issueId: data.id });
    }
  }
}
