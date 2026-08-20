/**
 * Firestore repository for GitHub PR events.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type {
  GitHubPREvent,
  CreateGitHubPREventInput,
} from '../../domain/models/gitHubPREvent.js';
import type {
  AcquireGitHubPRTriageInput,
  AcquireGitHubPRTriageResult,
  CompleteGitHubPRTriageInput,
  FailGitHubPRTriageInput,
  GitHubPREventRepository,
  RepositoryError,
} from '../../domain/repositories/gitHubPREventRepository.js';
import { computeExpireAt, getFirestore, RETENTION_24H_MS } from '@intexuraos/infra-firestore';

/** Minimal structural shape used by mapDocToEvent — avoids importing @google-cloud/firestore types directly. */
interface FirestoreDocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

/**
 * Convert Firestore Timestamp or Date to JavaScript Date.
 * Handles both real Firestore Timestamp objects and plain Date objects from fake Firestore.
 * Uses duck typing to detect Timestamp objects (which have a toDate method).
 */
function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  // Firestore Timestamps and mock objects with toDate method
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const obj = value as { toDate: () => Date };
    return obj.toDate();
  }
  // Last resort: try to parse as date string
  return new Date(String(value));
}

function readDeliveryId(data: Record<string, unknown>): string | null {
  const raw = data['deliveryId'];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Read isDraft from Firestore document data with backwards-compatible null default.
 * Old documents missing the field return null (fail-open for DraftPRRule).
 */
export function readIsDraft(data: Record<string, unknown>): boolean | null {
  const raw = data['isDraft'];
  if (raw === true) return true;
  if (raw === false) return false;
  return null;
}

const COLLECTION_NAME = 'github-pr-events';

export function createGitHubDeliveryEventId(deliveryId: string): string {
  const digest = createHash('sha256').update(deliveryId).digest('hex');
  return `github-delivery-${digest}`;
}

function triageLeaseIsActive(data: Record<string, unknown>, acquiredAt: Date): boolean {
  if (data['triageState'] !== 'processing') return false;
  return toDate(data['triageLeaseExpiresAt']).getTime() > acquiredAt.getTime();
}

const TRIAGE_LEASE_NOT_OWNED: RepositoryError = {
  code: 'TRIAGE_LEASE_NOT_OWNED',
  message: 'GitHub PR triage lease is no longer owned by this delivery',
};

function mapDocToEvent(
  doc: FirestoreDocSnapshot
): GitHubPREvent {
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
    prAuthorLogin: ((data as Record<string, unknown>)['prAuthorLogin'] as string | undefined) ?? null,
    baseBranch: data.baseBranch ?? null,
    isDraft: readIsDraft(data as Record<string, unknown>),
    createdAt: toDate(data.createdAt),
    processedAt: toDate(data.processedAt),
    mergedAt: data.mergedAt !== null ? toDate(data.mergedAt) : null,
  };
}

export function createFirestoreGitHubPREventsRepository(deps: {
  logger: Logger;
}): GitHubPREventRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  async function updateTriage(
    input: CompleteGitHubPRTriageInput | FailGitHubPRTriageInput,
  ): Promise<Result<void, RepositoryError>> {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const docRef = collection.doc(input.eventId);
        const snapshot = await transaction.get(docRef);
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (
          data?.['triageState'] !== 'processing'
          || data['triageLeaseToken'] !== input.leaseToken
        ) {
          return err(TRIAGE_LEASE_NOT_OWNED);
        }

        const clearedLease = {
          triageLeaseToken: null,
          triageLeaseOwner: null,
          triageLeaseExpiresAt: null,
        };
        if ('completedAt' in input) {
          transaction.update(docRef, {
            ...clearedLease,
            triageState: 'completed',
            triageCompletedAt: input.completedAt,
            triageFailedAt: null,
            triageFailureReason: null,
          });
        } else {
          transaction.update(docRef, {
            ...clearedLease,
            triageState: 'pending',
            triageFailedAt: input.failedAt,
            triageFailureReason: input.reason,
          });
        }
        return ok(undefined);
      });
    } catch (error) {
      logger.error({ error, eventId: input.eventId }, 'Failed to update GitHub PR triage lease');
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Unknown error'),
      });
    }
  }

  return {
    async save(
      input: CreateGitHubPREventInput
    ): Promise<Result<GitHubPREvent, RepositoryError>> {
      try {
        const eventId = input.deliveryId === null
          ? randomUUID()
          : createGitHubDeliveryEventId(input.deliveryId);
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
          isDraft: input.isDraft,
          baseBranch: input.baseBranch,
          mergedAt: input.mergedAt ?? null,
          createdAt: input.createdAt,
          processedAt: now,
          payload: input.payload,
        };
        const event: GitHubPREvent = {
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
          prAuthorLogin: eventData.prAuthorLogin,
          title: eventData.title,
          body: eventData.body,
          state: eventData.state,
          isDraft: eventData.isDraft,
          baseBranch: eventData.baseBranch,
          mergedAt: eventData.mergedAt,
          createdAt: eventData.createdAt,
          processedAt: eventData.processedAt,
          payload: eventData.payload,
        };
        const writeData = { ...eventData, expireAt: computeExpireAt(RETENTION_24H_MS) };

        if (input.deliveryId === null) {
          await docRef.set(writeData);
          return ok(event);
        }

        const deliveryId = input.deliveryId;
        const deliveryQuery = collection.where('deliveryId', '==', deliveryId).limit(1);
        return await firestore.runTransaction(async (transaction) => {
          // Read the deterministic receipt directly so concurrent first deliveries
          // contend on one document even when the legacy delivery query is empty.
          const deterministicSnapshot = await transaction.get(docRef);
          const deliverySnapshot = await transaction.get(deliveryQuery);
          const existingDoc = deterministicSnapshot.exists
            ? deterministicSnapshot
            : deliverySnapshot.docs[0];
          if (existingDoc !== undefined) {
            logger.debug(
              { deliveryId, eventId: existingDoc.id },
              'Duplicate webhook delivery, skipping'
            );
            return err({
              code: 'DUPLICATE_EVENT' as const,
              message: `Duplicate delivery: ${deliveryId}`,
              eventId: existingDoc.id,
            });
          }

          transaction.set(docRef, writeData);
          return ok(event);
        });
      } catch (error) {
        logger.error({ error }, 'Failed to save GitHub PR event');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async acquireTriage(
      input: AcquireGitHubPRTriageInput,
    ): Promise<Result<AcquireGitHubPRTriageResult, RepositoryError>> {
      try {
        return await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(input.eventId);
          const snapshot = await transaction.get(docRef);
          if (!snapshot.exists) return ok({ kind: 'not_found' as const });

          const data = snapshot.data() as Record<string, unknown>;
          if (data['triageState'] === 'completed') {
            return ok({ kind: 'completed' as const });
          }
          if (triageLeaseIsActive(data, input.acquiredAt)) {
            return ok({ kind: 'busy' as const });
          }

          const leaseToken = randomUUID();
          transaction.update(docRef, {
            triageState: 'processing',
            triageLeaseToken: leaseToken,
            triageLeaseOwner: input.leaseOwner,
            triageLeaseExpiresAt: new Date(input.acquiredAt.getTime() + input.leaseDurationMs),
            triageFailureReason: null,
          });
          return ok({
            kind: 'acquired' as const,
            event: mapDocToEvent(snapshot),
            leaseToken,
          });
        });
      } catch (error) {
        logger.error({ error, eventId: input.eventId }, 'Failed to acquire GitHub PR triage lease');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async completeTriage(
      input: CompleteGitHubPRTriageInput,
    ): Promise<Result<void, RepositoryError>> {
      return await updateTriage(input);
    },

    async failTriage(
      input: FailGitHubPRTriageInput,
    ): Promise<Result<void, RepositoryError>> {
      return await updateTriage(input);
    },

    async findById(
      eventId: string
    ): Promise<Result<GitHubPREvent | null, RepositoryError>> {
      try {
        const snap = await collection.doc(eventId).get();
        if (!snap.exists) return ok(null);
        return ok(mapDocToEvent(snap));
      } catch (error) {
        logger.error({ error, eventId }, 'Failed to find GitHub PR event by id');
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

        const events: GitHubPREvent[] = snapshot.docs.map(mapDocToEvent);

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

        const events: GitHubPREvent[] = snapshot.docs.map(mapDocToEvent);

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
          const data = doc.data() as Record<string, unknown>;
          const payload = data['payload'] as Record<string, unknown> | undefined;
          const comment = payload?.['comment'] as Record<string, unknown> | undefined;
          const commentReviewId = comment?.['pull_request_review_id'];

          if (commentReviewId === reviewId) {
            events.push(mapDocToEvent(doc));
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

        const events: GitHubPREvent[] = snapshot.docs.map(mapDocToEvent);

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
