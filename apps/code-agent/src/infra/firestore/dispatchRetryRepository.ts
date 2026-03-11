/**
 * Firestore repository for dispatch retry entries.
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type {
  DispatchRetry,
  CreateDispatchRetryInput,
} from '../../domain/models/dispatchRetry.js';
import type {
  DispatchRetryRepository,
  DispatchRetryRepositoryError,
} from '../../domain/repositories/dispatchRetryRepository.js';
import { getFirestore } from '@intexuraos/infra-firestore';

const COLLECTION_NAME = 'dispatch_retries';

export function createFirestoreDispatchRetryRepository(deps: {
  logger: Logger;
}): DispatchRetryRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async create(
      input: CreateDispatchRetryInput
    ): Promise<Result<DispatchRetry, DispatchRetryRepositoryError>> {
      try {
        const id = `dr_${randomUUID()}`;
        const docRef = collection.doc(id);
        const now = new Date();

        const data = {
          type: input.type,
          eventId: input.eventId,
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          senderLogin: input.senderLogin,
          ...(input.taskId !== undefined && { taskId: input.taskId }),
          ...(input.comment !== undefined && { comment: input.comment }),
          ...(input.prTitle !== undefined && { prTitle: input.prTitle }),
          ...(input.baseBranch !== undefined && { baseBranch: input.baseBranch }),
          ...(input.userId !== undefined && { userId: input.userId }),
          ...(input.message !== undefined && { message: input.message }),
          attempts: input.attempts,
          maxAttempts: input.maxAttempts,
          lastError: input.lastError,
          createdAt: now,
          ttlMinutes: input.ttlMinutes,
        };

        await docRef.set(data);

        return ok({
          id,
          ...data,
        } as unknown as DispatchRetry);
      } catch (error) {
        logger.error({ error }, 'Failed to create dispatch retry entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findOldest(): Promise<Result<DispatchRetry | null, DispatchRetryRepositoryError>> {
      try {
        const snapshot = await collection
          .orderBy('createdAt', 'asc')
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        const doc = snapshot.docs[0];
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; snapshot.empty check above guarantees docs[0] exists @preserve */
        if (doc === undefined) {
          return ok(null);
        }
        /* v8 ignore stop @preserve */

        const data = doc.data();
        const entry: DispatchRetry = {
          id: doc.id,
          type: data['type'] as DispatchRetry['type'],
          eventId: data['eventId'] as string,
          repository: data['repository'] as string,
          pullRequestNumber: data['pullRequestNumber'] as number,
          senderLogin: data['senderLogin'] as string,
          attempts: data['attempts'] as number,
          maxAttempts: data['maxAttempts'] as number,
          lastError: data['lastError'] as string,
          createdAt: data['createdAt'] as DispatchRetry['createdAt'],
          ttlMinutes: data['ttlMinutes'] as number,
        };
        if (data['taskId'] !== undefined) entry.taskId = data['taskId'] as string;
        if (data['comment'] !== undefined) entry.comment = data['comment'] as string;
        if (data['prTitle'] !== undefined) entry.prTitle = data['prTitle'] as string;
        if (data['baseBranch'] !== undefined) entry.baseBranch = data['baseBranch'] as string;
        if (data['userId'] !== undefined) entry.userId = data['userId'] as string;
        if (data['message'] !== undefined) entry.message = data['message'] as string;
        if (data['lastAttemptAt'] !== undefined) entry.lastAttemptAt = data['lastAttemptAt'] as DispatchRetry['createdAt'];
        return ok(entry);
      } catch (error) {
        logger.error({ error }, 'Failed to find oldest dispatch retry entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async delete(id: string): Promise<Result<void, DispatchRetryRepositoryError>> {
      try {
        await collection.doc(id).delete();
        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, 'Failed to delete dispatch retry entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async update(
      id: string,
      fields: { attempts: number; lastAttemptAt: Date; lastError: string }
    ): Promise<Result<void, DispatchRetryRepositoryError>> {
      try {
        await collection.doc(id).update({
          attempts: fields.attempts,
          lastAttemptAt: fields.lastAttemptAt,
          lastError: fields.lastError,
        });
        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, 'Failed to update dispatch retry entry');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
