/**
 * Firestore repository for merge queue watches.
 */

import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import type { MergeQueueWatch } from '../../domain/models/mergeQueueWatch.js';
import type {
  MergeQueueWatchRepository,
  MergeQueueWatchRepositoryError,
  CreateWatchInput,
  UpdateWatchInput,
  AppendMergedPrInput,
} from '../../domain/repositories/mergeQueueWatchRepository.js';
import { getFirestore, FieldValue } from '@intexuraos/infra-firestore';

const COLLECTION_NAME = 'merge_queue_watches';

export function createFirestoreMergeQueueWatchRepository(deps: {
  logger: Logger;
}): MergeQueueWatchRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async create(
      input: CreateWatchInput
    ): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>> {
      try {
        // Check for existing active watch
        const existingSnapshot = await collection
          .where('userId', '==', input.userId)
          .where('owner', '==', input.owner)
          .where('repo', '==', input.repo)
          .where('baseBranch', '==', input.baseBranch)
          .where('status', '==', 'active')
          .limit(1)
          .get();

        if (!existingSnapshot.empty) {
          return err({
            code: 'CONFLICT',
            message: `Active watch already exists for ${input.owner}/${input.repo}#${input.baseBranch}`,
          });
        }

        const id = `watch_${randomUUID()}`;
        const docRef = collection.doc(id);
        const now = new Date();

        const data = {
          userId: input.userId,
          gitHubUsername: input.gitHubUsername,
          owner: input.owner,
          repo: input.repo,
          baseBranch: input.baseBranch,
          status: 'active' as const,
          mergedPrs: [],
          skippedPrs: [],
          lastError: null,
          lastErrorAt: null,
          createdAt: now,
          lastTickAt: null,
          drainedAt: null,
          cancelledAt: null,
        };

        await docRef.set(data);

        return ok({
          id,
          ...data,
        } as unknown as MergeQueueWatch);
      } catch (error) {
        logger.error({ error }, 'Failed to create merge queue watch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findById(
      id: string
    ): Promise<Result<MergeQueueWatch, MergeQueueWatchRepositoryError>> {
      try {
        const docRef = collection.doc(id);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
          return err({
            code: 'NOT_FOUND',
            message: `Watch ${id} not found`,
          });
        }

        const data = snapshot.data() as Omit<MergeQueueWatch, 'id'>;
        return ok({
          id: snapshot.id,
          ...data,
        });
      } catch (error) {
        logger.error({ error, id }, 'Failed to find merge queue watch by ID');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findActiveByUserAndBranch(
      userId: string,
      owner: string,
      repo: string,
      baseBranch: string
    ): Promise<Result<MergeQueueWatch | null, MergeQueueWatchRepositoryError>> {
      try {
        const snapshot = await collection
          .where('userId', '==', userId)
          .where('owner', '==', owner)
          .where('repo', '==', repo)
          .where('baseBranch', '==', baseBranch)
          .where('status', '==', 'active')
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

        const data = doc.data() as Omit<MergeQueueWatch, 'id'>;
        return ok({
          id: doc.id,
          ...data,
        });
      } catch (error) {
        logger.error({ error, userId, owner, repo, baseBranch }, 'Failed to find active watch by user and branch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findAllActive(): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>> {
      try {
        const snapshot = await collection
          .where('status', '==', 'active')
          .get();

        const watches: MergeQueueWatch[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<MergeQueueWatch, 'id'>;
          return {
            id: doc.id,
            ...data,
          };
        });

        return ok(watches);
      } catch (error) {
        logger.error({ error }, 'Failed to find all active watches');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async findByUserAndRepo(
      userId: string,
      owner: string,
      repo: string
    ): Promise<Result<MergeQueueWatch[], MergeQueueWatchRepositoryError>> {
      try {
        const snapshot = await collection
          .where('userId', '==', userId)
          .where('owner', '==', owner)
          .where('repo', '==', repo)
          .get();

        const watches: MergeQueueWatch[] = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<MergeQueueWatch, 'id'>;
          return {
            id: doc.id,
            ...data,
          };
        });

        return ok(watches);
      } catch (error) {
        logger.error({ error, userId, owner, repo }, 'Failed to find watches by user and repo');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async update(
      id: string,
      input: UpdateWatchInput
    ): Promise<Result<void, MergeQueueWatchRepositoryError>> {
      try {
        const docRef = collection.doc(id);
        const updateData: Record<string, unknown> = {};

        if (input.lastTickAt !== undefined) {
          updateData['lastTickAt'] = input.lastTickAt;
        }
        if (input.skippedPrs !== undefined) {
          updateData['skippedPrs'] = input.skippedPrs;
        }
        if (input.lastError !== undefined) {
          updateData['lastError'] = input.lastError;
        }
        if (input.lastErrorAt !== undefined) {
          updateData['lastErrorAt'] = input.lastErrorAt;
        }
        if (input.status !== undefined) {
          updateData['status'] = input.status;
        }
        if (input.drainedAt !== undefined) {
          updateData['drainedAt'] = input.drainedAt;
        }
        if (input.cancelledAt !== undefined) {
          updateData['cancelledAt'] = input.cancelledAt;
        }

        await docRef.update(updateData);
        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, 'Failed to update merge queue watch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async appendMergedPr(
      id: string,
      mergedPr: AppendMergedPrInput
    ): Promise<Result<void, MergeQueueWatchRepositoryError>> {
      try {
        const docRef = collection.doc(id);
        await docRef.update({
          mergedPrs: FieldValue.arrayUnion({ ...mergedPr, mergedAt: new Date() }),
        });
        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, 'Failed to append merged PR to watch');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
