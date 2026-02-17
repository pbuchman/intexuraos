/**
 * Repository interface for log chunk operations.
 *
 * Stores log chunks in Firestore subcollection for task streaming.
 * Design reference: Lines 2027-2033
 */

import type { Result } from '@intexuraos/common-core';
import type { LogChunk } from '../models/logChunk.js';

export type RepositoryError =
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface LogChunkRepository {
  /**
   * Store a batch of log chunks for a task.
   *
   * @param taskId - The task ID
   * @param chunks - Array of log chunks to store
   * @returns Ok(undefined) on success, Err on failure
   */
  storeBatch(taskId: string, chunks: LogChunk[]): Promise<Result<void, RepositoryError>>;
}
