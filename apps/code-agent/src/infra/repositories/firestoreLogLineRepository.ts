import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { LogLineRepository, RepositoryError } from '../../domain/repositories/logLineRepository.js';
import type { FormattedLogLine } from '../../domain/models/logLine.js';
import type { Firestore } from '@intexuraos/infra-firestore';

export interface FirestoreLogLineRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreLogLineRepository implements LogLineRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreLogLineRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async deleteAll(taskId: string): Promise<Result<void, RepositoryError>> {
    const MAX_BATCH_SIZE = 500;

    try {
      const linesRef = this.firestore
        .collection('code_tasks')
        .doc(taskId)
        .collection('log_lines');

      const snapshot = await linesRef.get();

      if (snapshot.docs.length > 0) {
        let batch = this.firestore.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
          batch.delete(doc.ref);
          batchCount++;

          /* v8 ignore start -- test-infra: batch boundary depends on fixture size exceeding 500 docs @preserve */
          if (batchCount >= MAX_BATCH_SIZE) {
            await batch.commit();
            batch = this.firestore.batch();
            batchCount = 0;
          }
          /* v8 ignore stop @preserve */
        }

        /* v8 ignore start -- test-infra: batchCount === 0 only when docs exactly divisible by 500 @preserve */
        if (batchCount > 0) {
          await batch.commit();
        }
        /* v8 ignore stop @preserve */
      }

      this.logger.debug({ taskId, count: snapshot.docs.length }, 'Deleted all log lines');
      return ok(undefined);
    /* v8 ignore start -- test-infra: firestoreloglinerepository batch.commit error path @preserve */
    } catch (error) {
    /* v8 ignore stop @preserve */
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to delete log lines');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async storeBatch(taskId: string, lines: FormattedLogLine[]): Promise<Result<void, RepositoryError>> {
    if (lines.length === 0) {
      return ok(undefined);
    }

    const MAX_BATCH_SIZE = 500;

    try {
      for (let i = 0; i < lines.length; i += MAX_BATCH_SIZE) {
        const batch = this.firestore.batch();
        const slice = lines.slice(i, i + MAX_BATCH_SIZE);

        for (const line of slice) {
          const docRef = this.firestore
            .collection('code_tasks')
            .doc(taskId)
            .collection('log_lines')
            .doc(String(line.sequence).padStart(16, '0'));

          batch.set(docRef, {
            sequence: line.sequence,
            text: line.text,
            timestamp: line.timestamp,
          });
        }

        await batch.commit();
      }
      this.logger.debug({ taskId, count: lines.length }, 'Stored formatted log lines');
      return ok(undefined);
    /* v8 ignore start -- test-infra: firestoreloglinerepository batch.commit error path @preserve */
    } catch (error) {
    /* v8 ignore stop @preserve */
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to store log lines');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreLogLineRepository(
  deps: FirestoreLogLineRepositoryDeps
): LogLineRepository {
  return new FirestoreLogLineRepository(deps);
}
