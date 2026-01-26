/**
 * Firestore implementation of log chunk repository.
 *
 * Stores log chunks in `code_tasks/{taskId}/logs` subcollection.
 * Design reference: Lines 2027-2033
 */

import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { LogChunkRepository, RepositoryError } from '../../domain/repositories/logChunkRepository.js';
import type { LogChunk } from '../../domain/models/logChunk.js';
import type { Firestore } from '@intexuraos/infra-firestore';

export interface FirestoreLogChunkRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreLogChunkRepository implements LogChunkRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreLogChunkRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async storeBatch(taskId: string, chunks: LogChunk[]): Promise<Result<void, RepositoryError>> {
    if (chunks.length === 0) {
      return ok(undefined);
    }

    const batch = this.firestore.batch();

    for (const chunk of chunks) {
      const docRef = this.firestore
        .collection('code_tasks')
        .doc(taskId)
        .collection('logs')
        .doc();

      batch.set(docRef, {
        sequence: chunk.sequence,
        content: chunk.content,
        timestamp: chunk.timestamp,
        size: chunk.size,
      });
    }

    try {
      await batch.commit();
      this.logger.debug({ taskId, count: chunks.length }, 'Stored log chunks');
      return ok(undefined);
    } catch (error) {
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to store log chunks');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

/**
 * Factory function to create Firestore log chunk repository.
 */
export function createFirestoreLogChunkRepository(
  deps: FirestoreLogChunkRepositoryDeps
): LogChunkRepository {
  return new FirestoreLogChunkRepository(deps);
}
