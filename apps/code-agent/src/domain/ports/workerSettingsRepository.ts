/**
 * Repository port for per-user worker settings.
 *
 * Handles CRUD operations for worker configurations with encryption at rest.
 */

import type { Result, CodeTaskWorkerType } from '@intexuraos/common-core';
import type {
  UserWorkerSettings,
  WorkerConfig,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  WorkerHealthStatus,
} from '../models/workerSettings.js';

/** Fields in UserWorkerSettings that hold a default worker type per agent category */
export type DefaultWorkerTypeField =
  | 'defaultReviewWorkerType'
  | 'defaultRemediationWorkerType'
  | 'defaultExecutionWorkerType'
  | 'defaultPlanningWorkerType'
  | 'defaultPullRequestWorkerType';

export interface WorkerSettingsError {
  code: 'not_found' | 'already_exists' | 'max_workers_exceeded' | 'internal_error';
  message: string;
}

export interface TestResult {
  status: 'success' | 'failure';
  message: string;
}

export interface WorkerSettingsRepository {
  /**
   * Get all worker settings for a user.
   * Returns null if user has no settings document.
   */
  getSettings(userId: string): Promise<Result<UserWorkerSettings | null, WorkerSettingsError>>;

  /**
   * Get a specific worker by name.
   * Returns null if worker not found.
   */
  getWorkerByName(
    userId: string,
    workerName: string
  ): Promise<Result<WorkerConfig | null, WorkerSettingsError>>;

  /**
   * Add a new worker for a user.
   * Fails if:
   * - Worker with same name already exists
   * - User already has MAX_WORKERS_PER_USER workers
   */
  addWorker(
    userId: string,
    config: WorkerConfigInput
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Update an existing worker by name.
   * Fails if worker not found.
   */
  updateWorker(
    userId: string,
    workerName: string,
    config: WorkerConfigUpdateInput
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Delete a worker by name.
   * Fails if worker not found.
   */
  deleteWorker(
    userId: string,
    workerName: string
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Reorder workers.
   * workerNames must contain exactly all existing worker names.
   */
  reorderWorkers(
    userId: string,
    workerNames: string[]
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Update test result for a worker.
   */
  updateTestResult(
    userId: string,
    workerName: string,
    result: TestResult
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Get cached health status for all workers.
   * Returns null if user has no settings or no cached statuses.
   */
  getHealthStatuses(
    userId: string
  ): Promise<Result<Record<string, WorkerHealthStatus> | null, WorkerSettingsError>>;

  /**
   * Update health status for a specific worker.
   */
  updateHealthStatus(
    userId: string,
    workerName: string,
    status: WorkerHealthStatus
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Update the default review worker type for a user.
   * Creates the settings document if it doesn't exist.
   */
  updateDefaultReviewWorkerType(
    userId: string,
    workerType: CodeTaskWorkerType
  ): Promise<Result<void, WorkerSettingsError>>;

  /**
   * Update any default worker type field for a user.
   * Creates the settings document if it doesn't exist.
   */
  updateDefaultWorkerType(
    userId: string,
    field: DefaultWorkerTypeField,
    workerType: CodeTaskWorkerType
  ): Promise<Result<void, WorkerSettingsError>>;
}
