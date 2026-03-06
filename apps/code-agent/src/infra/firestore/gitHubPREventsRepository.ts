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
        // Check for duplicate event ID (deduplication)
        const duplicateQuery = collection
          .where('githubEventId', '==', input.githubEventId)
          .limit(1);

        const duplicateSnapshot = await duplicateQuery.get();

        if (!duplicateSnapshot.empty) {
          logger.debug(
            { githubEventId: input.githubEventId },
            'Duplicate GitHub event, skipping'
          );
          // Return the existing event
          const existingDoc = duplicateSnapshot.docs[0];
          /* v8 ignore start -- ts-type: type narrowing for TypeScript array access, branch is theoretically unreachable @preserve */
          if (existingDoc === undefined) {
            // Should never happen since we checked empty, but TypeScript requires this check
            return err({
              code: 'FIRESTORE_ERROR',
              message: 'Unexpected empty snapshot',
            });
          }
          /* v8 ignore stop @preserve */
          const existingData = existingDoc.data() as GitHubPREvent;
          return ok({
            ...existingData,
            id: existingDoc.id,
          });
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
          githubEventId: input.githubEventId,
          repository: input.repository,
          repositoryId: input.repositoryId,
          pullRequestNumber: input.pullRequestNumber,
          pullRequestId: input.pullRequestId,
          eventType: input.eventType,
          action: input.action,
          senderLogin: input.senderLogin,
          senderId: input.senderId,
          senderType: input.senderType,
          title: input.title,
          body: input.body,
          state: input.state,
          mergedAt: input.mergedAt ?? null,
          createdAt: input.createdAt,
          processedAt: now,
          payload: input.payload,
        };

        await docRef.set(eventData);

        return ok({
          id: eventId,
          githubEventId: eventData.githubEventId,
          repository: eventData.repository,
          repositoryId: eventData.repositoryId,
          pullRequestNumber: eventData.pullRequestNumber,
          pullRequestId: eventData.pullRequestId,
          eventType: eventData.eventType,
          action: eventData.action,
          senderLogin: eventData.senderLogin,
          senderId: eventData.senderId,
          senderType: eventData.senderType,
          title: eventData.title,
          body: eventData.body,
          state: eventData.state,
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
