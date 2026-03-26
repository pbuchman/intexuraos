import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  TurnMetricsRepository,
  RepositoryError,
} from '../../domain/repositories/turnMetricsRepository.js';
import type { TurnMetrics } from '../../domain/models/turnMetrics.js';
import type { Firestore } from '@intexuraos/infra-firestore';

export interface FirestoreTurnMetricsRepositoryDeps {
  firestore: Firestore;
  logger: Logger;
}

export class FirestoreTurnMetricsRepository implements TurnMetricsRepository {
  private readonly firestore: Firestore;
  private readonly logger: Logger;

  constructor(deps: FirestoreTurnMetricsRepositoryDeps) {
    this.firestore = deps.firestore;
    this.logger = deps.logger;
  }

  async store(
    taskId: string,
    attempt: number,
    metrics: TurnMetrics
  ): Promise<Result<void, RepositoryError>> {
    const docId = String(attempt).padStart(4, '0');
    const docRef = this.firestore
      .collection('code_tasks')
      .doc(taskId)
      .collection('turn_metrics')
      .doc(docId);

    try {
      await docRef.set(metrics);
      this.logger.debug({ taskId, attempt }, 'Stored turn metrics');
      return ok(undefined);
    } catch (error) {
      this.logger.error(
        { taskId, attempt, error: getErrorMessage(error) },
        'Failed to store turn metrics'
      );
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }

  async listByTask(taskId: string): Promise<Result<TurnMetrics[], RepositoryError>> {
    try {
      const snapshot = await this.firestore
        .collection('code_tasks')
        .doc(taskId)
        .collection('turn_metrics')
        .orderBy('attempt', 'asc')
        .get();

      return ok(snapshot.docs.map((doc) => doc.data() as TurnMetrics));
    } catch (error) {
      this.logger.error({ taskId, error: getErrorMessage(error) }, 'Failed to list turn metrics');
      return err({ code: 'FIRESTORE_ERROR', message: getErrorMessage(error) });
    }
  }
}

export function createFirestoreTurnMetricsRepository(
  deps: FirestoreTurnMetricsRepositoryDeps
): TurnMetricsRepository {
  return new FirestoreTurnMetricsRepository(deps);
}
