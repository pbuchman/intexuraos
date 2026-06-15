import type { Logger } from '@intexuraos/common-core';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  TurnMetricsRepository,
  RepositoryError,
} from '../../domain/repositories/turnMetricsRepository.js';
import type { TurnMetrics } from '../../domain/models/turnMetrics.js';
import {
  computeExpireAt,
  RETENTION_7D_MS,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  withSchemaVersion,
} from '@intexuraos/infra-firestore';

const LIST_BATCH_SIZE = 500;

async function collectOrderedQuery<T extends DocumentData>(
  query: Query<T>,
  batchSize = LIST_BATCH_SIZE,
): Promise<QueryDocumentSnapshot<T>[]> {
  const docs: QueryDocumentSnapshot<T>[] = [];
  let lastDoc: QueryDocumentSnapshot<T> | undefined;

  for (;;) {
    let pageQuery = query.limit(batchSize);
    if (lastDoc !== undefined) {
      pageQuery = pageQuery.startAfter(lastDoc);
    }

    const snapshot = await pageQuery.get();
    if (snapshot.empty) {
      return docs;
    }

    docs.push(...snapshot.docs);
    if (snapshot.size < batchSize) {
      return docs;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    /* v8 ignore start -- upstream: Firestore QuerySnapshot.empty=false guarantees at least one doc; undefined guard is defensive for adapter corruption @preserve */
    if (lastDoc === undefined) {
      return docs;
    }
    /* v8 ignore stop @preserve */
  }
}

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
      await docRef.set(withSchemaVersion({ ...metrics, expireAt: computeExpireAt(RETENTION_7D_MS) }, 1));
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
      const docs = await collectOrderedQuery(this.firestore
        .collection('code_tasks')
        .doc(taskId)
        .collection('turn_metrics')
        .orderBy('attempt', 'asc'));

      return ok(docs.map((doc) => doc.data() as TurnMetrics));
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
