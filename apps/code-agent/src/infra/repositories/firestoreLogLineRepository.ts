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
    } catch (error) {
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to store log lines');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listRecent(taskId: string, limit: number): Promise<Result<FormattedLogLine[], RepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection('code_tasks')
        .doc(taskId)
        .collection('log_lines')
        .orderBy('sequence', 'desc')
        .limit(limit)
        .get();

      const lines = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          sequence: Number(data['sequence'] ?? 0),
          text: String(data['text'] ?? ''),
          timestamp: data['timestamp'] as FormattedLogLine['timestamp'],
        };
      }).reverse();

      return ok(lines);
    } catch (error) {
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to list recent log lines');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreLogLineRepository(
  deps: FirestoreLogLineRepositoryDeps
): LogLineRepository {
  return new FirestoreLogLineRepository(deps);
}
