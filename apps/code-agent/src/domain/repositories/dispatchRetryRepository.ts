/**
 * Repository port for dispatch retry entries.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  DispatchRetry,
  CreateDispatchRetryInput,
} from '../models/dispatchRetry.js';

export interface DispatchRetryRepositoryError {
  code: 'FIRESTORE_ERROR';
  message: string;
}

export interface DispatchRetryRepository {
  /**
   * Create a new dispatch retry entry. Auto-generates ID (dr_<uuid>) and createdAt.
   */
  create(
    input: CreateDispatchRetryInput,
  ): Promise<Result<DispatchRetry, DispatchRetryRepositoryError>>;

  /**
   * Find the oldest retry entry by createdAt ascending.
   * Returns null if queue is empty.
   */
  findOldest(): Promise<
    Result<DispatchRetry | null, DispatchRetryRepositoryError>
  >;

  /**
   * Claim a retry entry for processing across scheduler replicas.
   * Returns false when the entry is missing or already claimed recently.
   */
  claimForProcessing(
    id: string,
    staleBefore: Date,
  ): Promise<Result<boolean, DispatchRetryRepositoryError>>;

  /**
   * Delete a retry entry by ID.
   */
  delete(
    id: string,
  ): Promise<Result<void, DispatchRetryRepositoryError>>;

  /**
   * Update retry metadata (attempts, lastAttemptAt, lastError).
   */
  update(
    id: string,
    fields: {
      attempts: number;
      lastAttemptAt: Date;
      lastError: string;
      processingStartedAt?: Date | null;
    },
  ): Promise<Result<void, DispatchRetryRepositoryError>>;
}
