import type { Result } from '@intexuraos/common-core';
import type { FormattedLogLine } from '../models/logLine.js';

export type RepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface LogLineRepository {
  storeBatch(taskId: string, lines: FormattedLogLine[]): Promise<Result<void, RepositoryError>>;
  listRecent(taskId: string, limit: number): Promise<Result<FormattedLogLine[], RepositoryError>>;
}
