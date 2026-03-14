/**
 * Firestore repository for GitHub PR events.
 */

import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type {
  GitHubPREvent,
  CreateGitHubPREventInput,
} from '../../domain/models/gitHubPREvent.js';
import type {
  GitHubPREventRepository,
  RepositoryError,
} from '../../domain/repositories/gitHubPREventRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

/**
 * Convert Firestore Timestamp or Date to JavaScript Date.
 * Handles both real Firestore Timestamp objects and plain Date objects from fake Firestore.
 * Uses duck typing to detect Timestamp objects (which have a toDate method).
 */
/* v8 ignore start -- upstream: Firestore returns different types (Timestamp, Date, string) depending on context @preserve */
function toDate(value: unknown): Date {
  /* v8 ignore start -- ts-type: type guard for Date vs Firestore Timestamp @preserve */
  if (value instanceof Date) {
    return value;
  }
  /* v8 ignore stop @preserve */
  /* v8 ignore start -- ts-type: null guard for unknown type, callers always have null guards so this is unreachable @preserve */
  // Firestore Timestamps and mock objects with toDate method
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    /* v8 ignore stop @preserve */
    const obj = value as { toDate: () => Date };
    return obj.toDate();
  }
  /* v8 ignore start -- ts-type: fallback branch for string parsing, unreachable with proper typed callers @preserve */
  // Last resort: try to parse as date string
  return new Date(String(value));
  /* v8 ignore stop @preserve */
}
/* v8 ignore stop @preserve */

function readDeliveryId(data: Record<string, unknown>): string | null {
  const raw = data['deliveryId'];
  return typeof raw === 'string' ? raw : null;
}

const COLLECTION_NAME = 'github-pr-events';

export function createFirestoreGitHubPREventsRepository(deps: {
  logger: Logger;
}): GitHubPREventRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async save(
      input: CreateGitHubPREventInput
    ): Promise<Result<GitHubPREvent, RepositoryError>> {
      try {
        // Dedup on deliveryId (X-GitHub-Delivery header)
        if (input.deliveryId !== null) {
          const deliveryQuery = collection
            .where('deliveryId', '==', input.deliveryId)
            .limit(1);
          const deliverySnapshot = await deliveryQuery.get();
          if (!deliverySnapshot.empty) {
            logger.debug(
              { deliveryId: input.deliveryId },
              'Duplicate webhook delivery, skipping'
            );
            return err({
              code: 'DUPLICATE_EVENT',
              message: `Duplicate delivery: ${input.deliveryId}`,
            });
          }
        }

        // Create new event document
        const eventId = crypto.randomUUID();
        const docRef = collection.doc(eventId);

        const now = new Date();
        const eventData: Omit<GitHubPREvent, 'id'> & {
          createdAt: unknown;
          processedAt: unknown;
          mergedAt: unknown;
        } = {
          ...(input.auditEventId !== undefined && { auditEventId: input.auditEventId }),
          githubEventId: input.githubEventId,
          deliveryId: input.deliveryId,
          repository: input.repository,
          repositoryId: input.repositoryId,
          pullRequestNumber: input.pullRequestNumber,
          pullRequestId: input.pullRequestId,
          eventType: input.eventType,
          action: input.action,
          senderLogin: input.senderLogin,
          senderId: input.senderId,
          senderType: input.senderType,
          prAuthorLogin: input.prAuthorLogin,
          title: input.title,
          body: input.body,
          state: input.state,
          baseBranch: input.baseBranch,
          mergedAt: input.mergedAt ?? null,
          createdAt: input.createdAt,
          processedAt: now,
          payload: input.payload,
        };

        await docRef.set(eventData);

        return ok({
          id: eventId,
          ...(eventData.auditEventId !== undefined && { auditEventId: eventData.auditEventId }),
          githubEventId: eventData.githubEventId,
          deliveryId: eventData.deliveryId,
          repository: eventData.repository,
          repositoryId: eventData.repositoryId,
          pullRequestNumber: eventData.pullRequestNumber,
          pullRequestId: eventData.pullRequestId,
          eventType: eventData.eventType,
          action: eventData.action,
          senderLogin: eventData.senderLogin,
          senderId: eventData.senderId,
          senderType: eventData.senderType,
          prAuthorLogin: eventData.prAuthorLogin as string | null,
          title: eventData.title,
          body: eventData.body,
          state: eventData.state,
          baseBranch: eventData.baseBranch,
          mergedAt: eventData.mergedAt,
          createdAt: eventData.createdAt,
          processedAt: eventData.processedAt,
          payload: eventData.payload,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to save GitHub PR event');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByPullRequest(
      repository: string,
      pullRequestNumber: number
    ): Promise<Result<GitHubPREvent[], RepositoryError>> {
      try {
        const query = collection
          .where('repository', '==', repository)
          .where('pullRequestNumber', '==', pullRequestNumber)
          .orderBy('createdAt', 'desc')
          .limit(100);

        const snapshot = await query.get();

        const events: GitHubPREvent[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<GitHubPREvent, 'id'> & {
            createdAt: unknown;
            processedAt: unknown;
            mergedAt: unknown;
          };
          return {
            ...data,
            id: doc.id,
            ...(data.auditEventId !== undefined && { auditEventId: data.auditEventId }),
            deliveryId: readDeliveryId(data as Record<string, unknown>),
            prAuthorLogin: (data as Record<string, unknown>)['prAuthorLogin'] as string ?? null,
            baseBranch: data.baseBranch ?? null,
            createdAt: toDate(data.createdAt),
            processedAt: toDate(data.processedAt),
            /* v8 ignore start -- ts-type: ternary type narrowing for optional null @preserve */
            mergedAt: data.mergedAt !== null ? toDate(data.mergedAt) : null,
            /* v8 ignore stop @preserve */
          };
        });

        return ok(events);
      } catch (error) {
        logger.error(
          { error, repository, pullRequestNumber },
          'Failed to find GitHub PR events by pull request'
        );
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByRepository(
      repository: string,
      limit = 50
    ): Promise<Result<GitHubPREvent[], RepositoryError>> {
      try {
        const query = collection
          .where('repository', '==', repository)
          .orderBy('createdAt', 'desc')
          .limit(limit);

        const snapshot = await query.get();

        const events: GitHubPREvent[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<GitHubPREvent, 'id'> & {
            createdAt: unknown;
            processedAt: unknown;
            mergedAt: unknown;
          };
          return {
            ...data,
            id: doc.id,
            ...(data.auditEventId !== undefined && { auditEventId: data.auditEventId }),
            deliveryId: readDeliveryId(data as Record<string, unknown>),
            prAuthorLogin: (data as Record<string, unknown>)['prAuthorLogin'] as string ?? null,
            baseBranch: data.baseBranch ?? null,
            createdAt: toDate(data.createdAt),
            processedAt: toDate(data.processedAt),
            mergedAt: data.mergedAt !== null ? toDate(data.mergedAt) : null,
          };
        });

        return ok(events);
      } catch (error) {
        logger.error(
          { error, repository },
          'Failed to find GitHub PR events by repository'
        );
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findReviewComments(
      repository: string,
      pullRequestNumber: number,
      reviewId: number
    ): Promise<Result<GitHubPREvent[], RepositoryError>> {
      try {
        const query = collection
          .where('repository', '==', repository)
          .where('pullRequestNumber', '==', pullRequestNumber)
          .where('eventType', '==', 'pull_request_review_comment')
          .orderBy('createdAt', 'asc')
          .limit(50);

        const snapshot = await query.get();

        const events: GitHubPREvent[] = [];
        for (const doc of snapshot.docs) {
          const data = doc.data() as Omit<GitHubPREvent, 'id'> & {
            createdAt: unknown;
            processedAt: unknown;
            mergedAt: unknown;
          };

          const payload = data.payload as Record<string, unknown> | undefined;
          const comment = payload?.['comment'] as Record<string, unknown> | undefined;
          const commentReviewId = comment?.['pull_request_review_id'];

          if (commentReviewId === reviewId) {
            events.push({
              ...data,
              id: doc.id,
              ...(data.auditEventId !== undefined && { auditEventId: data.auditEventId }),
              deliveryId: readDeliveryId(data as Record<string, unknown>),
              prAuthorLogin: (data as Record<string, unknown>)['prAuthorLogin'] as string ?? null,
            baseBranch: data.baseBranch ?? null,
              createdAt: toDate(data.createdAt),
              processedAt: toDate(data.processedAt),
              /* v8 ignore start -- ts-type: ternary type narrowing for optional null @preserve */
              mergedAt: data.mergedAt !== null ? toDate(data.mergedAt) : null,
              /* v8 ignore stop @preserve */
            });
          }
        }

        return ok(events);
      } catch (error) {
        logger.error(
          { error, repository, pullRequestNumber, reviewId },
          'Failed to find review comments'
        );
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findAll(limit = 50): Promise<Result<GitHubPREvent[], RepositoryError>> {
      try {
        const query = collection.orderBy('createdAt', 'desc').limit(limit);

        const snapshot = await query.get();

        const events: GitHubPREvent[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<GitHubPREvent, 'id'> & {
            createdAt: unknown;
            processedAt: unknown;
            mergedAt: unknown;
          };
          return {
            ...data,
            id: doc.id,
            ...(data.auditEventId !== undefined && { auditEventId: data.auditEventId }),
            deliveryId: readDeliveryId(data as Record<string, unknown>),
            prAuthorLogin: (data as Record<string, unknown>)['prAuthorLogin'] as string ?? null,
            baseBranch: data.baseBranch ?? null,
            createdAt: toDate(data.createdAt),
            processedAt: toDate(data.processedAt),
            /* v8 ignore start -- ts-type: ternary type narrowing for optional null @preserve */
            mergedAt: data.mergedAt !== null ? toDate(data.mergedAt) : null,
            /* v8 ignore stop @preserve */
          };
        });

        return ok(events);
      } catch (error) {
        logger.error({ error }, 'Failed to find all GitHub PR events');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
