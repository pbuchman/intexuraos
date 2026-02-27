import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';

export interface LeaseAcquireInput {
  savedEventId: string;
  owner: string;
  traceId: string;
  ttlMs: number;
}

export interface LeaseAcquireSuccess {
  acquired: true;
}

export interface LeaseAcquireRejected {
  acquired: false;
  existingOwner: string;
  existingTraceId: string;
}

export type LeaseAcquireResult = LeaseAcquireSuccess | LeaseAcquireRejected;

export interface LeaseReleaseResult {
  released: boolean;
}

export interface LeaseRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

interface LeaseDocument {
  owner: string;
  traceId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface GithubWebhookAgentLeaseRepository {
  acquire(input: LeaseAcquireInput): Promise<Result<LeaseAcquireResult, LeaseRepositoryError>>;
  release(savedEventId: string, owner: string): Promise<Result<LeaseReleaseResult, LeaseRepositoryError>>;
}

const COLLECTION_NAME = 'github-webhook-agent-leases';

export function createGithubWebhookAgentLeaseRepository(deps: {
  logger: Logger;
}): GithubWebhookAgentLeaseRepository {
  const { logger } = deps;
  const firestore = getFirestore();
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async acquire(input): Promise<Result<LeaseAcquireResult, LeaseRepositoryError>> {
      try {
        const result = await firestore.runTransaction(async (txn) => {
          const docRef = collection.doc(input.savedEventId);
          const snapshot = await txn.get(docRef);

          if (snapshot.exists) {
            const existing = snapshot.data() as LeaseDocument;
            const expiresAt = new Date(existing.expiresAt);
            if (expiresAt > new Date()) {
              return {
                acquired: false as const,
                existingOwner: existing.owner,
                existingTraceId: existing.traceId,
              };
            }
            logger.debug(
              { savedEventId: input.savedEventId, expiredOwner: existing.owner },
              'Expired lease found, overwriting'
            );
          }

          const now = new Date();
          const leaseDoc: LeaseDocument = {
            owner: input.owner,
            traceId: input.traceId,
            acquiredAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
          };
          txn.set(docRef, leaseDoc);

          return { acquired: true as const };
        });

        return ok(result);
      } catch (error) {
        logger.error({ error, savedEventId: input.savedEventId }, 'Failed to acquire lease');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },

    async release(savedEventId, owner): Promise<Result<LeaseReleaseResult, LeaseRepositoryError>> {
      try {
        const result = await firestore.runTransaction(async (txn) => {
          const docRef = collection.doc(savedEventId);
          const snapshot = await txn.get(docRef);

          if (!snapshot.exists) {
            return { released: false };
          }

          const existing = snapshot.data() as LeaseDocument;
          if (existing.owner !== owner) {
            logger.debug(
              { savedEventId, requestedOwner: owner, actualOwner: existing.owner },
              'Lease release rejected: owner mismatch'
            );
            return { released: false };
          }

          txn.delete(docRef);
          return { released: true };
        });

        return ok(result);
      } catch (error) {
        logger.error({ error, savedEventId }, 'Failed to release lease');
        return err({
          code: 'FIRESTORE_ERROR',
          message: getErrorMessage(error, 'Unknown error'),
        });
      }
    },
  };
}
