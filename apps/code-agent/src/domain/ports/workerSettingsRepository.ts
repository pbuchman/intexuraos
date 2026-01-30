/**
 * Repository port for per-user worker settings.
 *
 * Handles CRUD operations for worker configurations with encryption at rest.
 */

import type { Result } from '@intexuraos/common-core';
import type {
  UserWorkerSettings,
  WorkerConfig,
  WorkerConfigInput,
  WorkerType,
} from '../models/workerSettings.js';

/**
 * Error codes for worker settings repository operations.
 */
export type WorkerSettingsErrorCode =
  | 'NOT_FOUND'
  | 'ENCRYPTION_ERROR'
  | 'DECRYPTION_ERROR'
  | 'FIRESTORE_ERROR'
  | 'VALIDATION_ERROR';

/**
 * Error from worker settings repository.
 */
export interface WorkerSettingsError {
  code: WorkerSettingsErrorCode;
  message: string;
}

/**
 * Repository interface for user worker settings.
 *
 * Key isolation property: Document ID = userId.
 * All operations are scoped to a single user.
 */
export interface WorkerSettingsRepository {
  /**
   * Get worker settings for a user.
   * Returns null if user has no settings configured.
   */
  getSettings(userId: string): Promise<Result<UserWorkerSettings | null, WorkerSettingsError>>;

  /**
   * Get a specific worker config for a user.
   * Returns the decrypted credentials.
   */
  getWorkerConfig(
    userId: string,
    workerType: WorkerType
  ): Promise<Result<WorkerConfig | null, WorkerSettingsError>>;

  /**
   * Create or update a worker config for a user.
   * Encrypts credentials before storage.
   */
  updateWorkerConfig(
    userId: string,
    workerType: WorkerType,
    config: WorkerConfigInput
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Delete a worker config for a user.
   * Only removes the specified worker type, not the entire document.
   */
  deleteWorkerConfig(
    userId: string,
    workerType: WorkerType
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Update test results for a worker.
   */
  updateTestResult(
    userId: string,
    workerType: WorkerType,
    result: {
      testStatus: 'success' | 'failure';
      testMessage?: string;
      lastTestedAt: string;
    }
  ): Promise<Result<void, WorkerSettingsError>>;
}
