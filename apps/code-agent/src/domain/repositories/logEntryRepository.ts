import type { Result } from '@intexuraos/common-core';
import type { LogEntry } from '../models/logEntry.js';

export type RepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface LogEntryRepository {
  storeBatch(taskId: string, entries: LogEntry[]): Promise<Result<void, RepositoryError>>;
}
