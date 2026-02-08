/**
 * Sync a single comment from a webhook event.
 */
import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { LinearComment, LinearCommentRepository, LinearError } from '../index.js';
import type { LinearCommentWebhookEvent } from '../webhookTypes.js';

export interface SyncCommentDeps {
  commentRepo: LinearCommentRepository;
  logger: Logger;
}

export interface SyncCommentResult {
  action: 'created' | 'updated' | 'deleted' | 'skipped';
  commentId: string;
}

/**
 * Sync a single comment based on webhook event.
 *
 * @param event - Linear comment webhook event
 * @param userId - User ID who owns the Linear connection (for future use)
 * @param deps - Dependencies
 */
export async function syncCommentFromWebhook(
  event: LinearCommentWebhookEvent,
  _userId: string, // Reserved for future multi-tenant use
  deps: SyncCommentDeps
): Promise<Result<SyncCommentResult, LinearError>> {
  const { commentRepo, logger } = deps;
  const { action, data } = event;

  logger.info({ action, commentId: data.id, issueId: data.issueId }, 'Processing comment webhook event');

  switch (action) {
    case 'remove': {
      const deleteResult = await commentRepo.deleteById(data.id);
      if (!deleteResult.ok) {
        logger.error({ error: deleteResult.error }, 'Failed to delete comment');
        return deleteResult;
      }
      logger.info({ commentId: data.id }, 'Comment deleted');
      return ok({ action: 'deleted', commentId: data.id });
    }

    case 'create':
    case 'update': {
      const syncedComment = mapWebhookToComment(data);
      const saveResult = await commentRepo.save(syncedComment);
      if (!saveResult.ok) {
        logger.error({ error: saveResult.error }, 'Failed to save comment');
        return saveResult;
      }
      logger.info({ commentId: data.id, action }, 'Comment synced');
      return ok({ action: action === 'create' ? 'created' : 'updated', commentId: data.id });
    }

    default: {
      logger.warn({ action }, 'Unknown comment webhook action, skipping');
      return ok({ action: 'skipped', commentId: data.id });
    }
  }
}

/**
 * Map Linear webhook comment data to synced comment model.
 */
function mapWebhookToComment(data: LinearCommentWebhookEvent['data']): LinearComment {
  return {
    id: data.id,
    issueId: data.issueId,
    issueIdentifier: data.issueIdentifier,
    userId: data.user.id,
    userName: data.user.name,
    body: data.body,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    syncedAt: new Date().toISOString(),
  };
}
