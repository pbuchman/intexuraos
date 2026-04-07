import type { Result } from '@intexuraos/common-core';
import type { TurnMetrics } from '../models/turnMetrics.js';

export interface RepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface TurnMetricsRepository {
  store(
    taskId: string,
    attempt: number,
    metrics: TurnMetrics
  ): Promise<Result<void, RepositoryError>>;
  listByTask(taskId: string): Promise<Result<TurnMetrics[], RepositoryError>>;
}
