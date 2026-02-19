/**
 * Firestore implementation of LinearOAuthRepository.
 *
 * Stores Linear OAuth credentials per workspace.
 * Document ID = workspaceId for direct access.
 */

import type { Firestore } from '@intexuraos/infra-firestore';
import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearOAuthRepository,
  LinearOAuthCredentials,
  LinearOAuthError,
} from '../../domain/ports/linearOAuthRepository.js';

const COLLECTION_NAME = 'linear_oauth';

export interface LinearOAuthRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

/**
 * Create a Firestore-backed Linear OAuth repository.
 */
export function createLinearOAuthRepository(
  deps: LinearOAuthRepositoryDeps
): LinearOAuthRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION_NAME);

  return {
    async save(credentials: LinearOAuthCredentials): Promise<Result<void, LinearOAuthError>> {
      try {
        const docRef = collection.doc(credentials.workspaceId);
        await docRef.set({
          accessToken: credentials.accessToken,
          appUserId: credentials.appUserId,
          workspaceId: credentials.workspaceId,
          installedAt: credentials.installedAt,
          installedBy: credentials.installedBy,
        });

        logger.info(
          { workspaceId: credentials.workspaceId, appUserId: credentials.appUserId },
          'Linear OAuth credentials stored'
        );

        return ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, workspaceId: credentials.workspaceId }, 'Failed to save Linear OAuth credentials');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async get(workspaceId: string): Promise<Result<LinearOAuthCredentials | null, LinearOAuthError>> {
      try {
        const doc = await collection.doc(workspaceId).get();

        if (!doc.exists) {
          return ok(null);
        }

        const data = doc.data() as LinearOAuthCredentials;
        return ok(data);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, workspaceId }, 'Failed to get Linear OAuth credentials');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },

    async findByAppUserId(appUserId: string): Promise<Result<LinearOAuthCredentials | null, LinearOAuthError>> {
      try {
        const snapshot = await collection
          .where('appUserId', '==', appUserId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return ok(null);
        }

        /* v8 ignore start -- ts-type: snapshot.docs[0] always exists after empty check @preserve */
        const doc = snapshot.docs[0];
        if (doc === undefined) {
          return ok(null);
        }
        /* v8 ignore stop @preserve */
        const data = doc.data() as LinearOAuthCredentials;
        return ok(data);
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ error, appUserId }, 'Failed to find Linear OAuth credentials by appUserId');
        return err({
          code: 'internal_error',
          message: `Firestore error: ${message}`,
        });
      }
    },
  };
}
