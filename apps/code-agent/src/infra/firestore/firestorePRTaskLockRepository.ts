/* eslint-disable no-restricted-imports */
import type { Firestore } from '@google-cloud/firestore';
import { Timestamp } from '@google-cloud/firestore';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { PRTaskLock } from '../../domain/models/prTaskLock.js';
import type {
  PRTaskLockError,
  PRTaskLockRepository,
} from '../../domain/repositories/prTaskLockRepository.js';

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const createFirestorePRTaskLockRepository = (deps: {
  firestore: Firestore;
  logger: Logger;
}): PRTaskLockRepository => {
  const { firestore, logger } = deps;
  const collection = firestore.collection('pr_task_locks');

  return {
    acquireLock: async (
      lockKey: string,
      taskId: string,
      userId: string
    ): Promise<Result<PRTaskLock, PRTaskLockError>> => {
      try {
        const now = Timestamp.now();

        const result = await firestore.runTransaction(async (transaction) => {
          const docRef = collection.doc(lockKey);
          const snapshot = await transaction.get(docRef);

          if (snapshot.exists) {
            const data = snapshot.data();
            /* v8 ignore start -- ts-type: defensive check for undefined data @preserve */
            if (data === undefined) {
              return err({
                code: 'FIRESTORE_ERROR' as const,
                message: 'Document data is undefined despite exists check',
              });
            }
            /* v8 ignore stop @preserve */

            const expiresAt = data['expiresAt'] as Timestamp | undefined;
            if (expiresAt !== undefined && expiresAt.toMillis() > now.toMillis()) {
              const activeTaskId = data['activeTaskId'] as string;
              return err({
                code: 'LOCK_HELD' as const,
                message: 'Lock is currently held by another task',
                lockedByTaskId: activeTaskId,
              });
            }
          }

          const expiresAt = Timestamp.fromMillis(Date.now() + LOCK_TTL_MS);
          const lockData: PRTaskLock = {
            id: lockKey,
            activeTaskId: taskId,
            lockedAt: now,
            lockedBy: userId,
            expiresAt,
          };

          transaction.set(docRef, lockData);
          return ok(lockData);
        });

        return result;
      } catch (error) {
        logger.error({ error, lockKey }, 'Failed to acquire lock');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    releaseLock: async (lockKey: string): Promise<Result<void, PRTaskLockError>> => {
      try {
        await collection.doc(lockKey).delete();
        return ok(undefined);
      } catch (error) {
        logger.error({ error, lockKey }, 'Failed to release lock');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    findLock: async (lockKey: string): Promise<Result<PRTaskLock | null, PRTaskLockError>> => {
      try {
        const docRef = collection.doc(lockKey);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
          return ok(null);
        }

        const data = snapshot.data();
        /* v8 ignore start -- ts-type: defensive check for undefined data @preserve */
        if (data === undefined) {
          return err({
            code: 'FIRESTORE_ERROR',
            message: 'Document data is undefined despite exists check',
          });
        }
        /* v8 ignore stop @preserve */

        const lock: PRTaskLock = {
          id: data['id'] as string,
          activeTaskId: data['activeTaskId'] as string,
          lockedAt: data['lockedAt'] as Timestamp,
          lockedBy: data['lockedBy'] as string,
          expiresAt: data['expiresAt'] as Timestamp,
        };
        return ok(lock);
      } catch (error) {
        logger.error({ error, lockKey }, 'Failed to find lock');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
};
