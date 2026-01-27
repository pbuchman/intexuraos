/**
 * Repository interface for CodeTask CRUD operations.
 * Provides three-layer deduplication to prevent duplicate tasks.
 */

import type { Result } from '@intexuraos/common-core';
import type { CodeTask, TaskStatus } from '../models/codeTask.js';

export interface CreateTaskInput {
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: 'opus' | 'auto' | 'glm';
  workerLocation: 'mac' | 'vm';
  repository: string;
  baseBranch: string;
  traceId: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  linearIssueTitle?: string;
  linearFallback?: boolean;
  webhookSecret?: string;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  result?: CodeTask['result'];
  error?: CodeTask['error'];
  statusSummary?: CodeTask['statusSummary'];
  callbackReceived?: boolean;
  dispatchedAt?: Date;
  completedAt?: Date;
  logChunksDropped?: number;
  // Heartbeat fields for zombie detection (INT-372)
  updatedAt?: Date;
  lastHeartbeat?: Date;
  // Cancel nonce fields (INT-379)
  // Use null to explicitly clear the field, undefined means "don't change"
  cancelNonce?: string | null;
  cancelNonceExpiresAt?: string | null;
}

export interface ListTasksInput {
  userId: string;
  status?: TaskStatus;
  limit?: number;
  cursor?: string; // taskId for pagination
}

export interface ListTasksOutput {
  tasks: CodeTask[];
  nextCursor?: string;
}

/**
 * Repository errors following design doc lines 1762-1848
 */
export type RepositoryError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'DUPLICATE_APPROVAL'; message: string; existingTaskId: string }
  | { code: 'DUPLICATE_ACTION'; message: string; existingTaskId: string }
  | { code: 'DUPLICATE_PROMPT'; message: string; existingTaskId: string }
  | { code: 'ACTIVE_TASK_EXISTS'; message: string; existingTaskId: string }
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface CodeTaskRepository {
  /**
   * Create a new task with three-layer deduplication.
   * Design reference: Lines 1526-1563
   *
   * Dedup layers (in order):
   * 0. approvalEventId (prevents approval replays) - lines 1532-1536
   * 1. actionId (prevents Pub/Sub retries) - lines 1538-1541
   * 2. dedupKey (prevents UI double-taps) - lines 1543-1554
   * 3. linearIssueId active check - lines 448-458
   */
  create(input: CreateTaskInput): Promise<Result<CodeTask, RepositoryError>>;

  findById(taskId: string): Promise<Result<CodeTask, RepositoryError>>;

  findByIdForUser(
    taskId: string,
    userId: string
  ): Promise<Result<CodeTask, RepositoryError>>;

  update(
    taskId: string,
    input: UpdateTaskInput
  ): Promise<Result<CodeTask, RepositoryError>>;

  list(input: ListTasksInput): Promise<Result<ListTasksOutput, RepositoryError>>;

  /**
   * Check if Linear issue has active task.
   * Design reference: Lines 448-458
   */
  hasActiveTaskForLinearIssue(
    linearIssueId: string
  ): Promise<Result<{ hasActive: boolean; taskId?: string }, RepositoryError>>;

  /**
   * Find stale running tasks (zombies).
   * Design reference: Lines 1675-1690
   */
  findZombieTasks(staleThreshold: Date): Promise<Result<CodeTask[], RepositoryError>>;

  /**
   * Count tasks created by user today (for rate limiting).
   * Returns the number of tasks created since midnight.
   */
  countByUserToday(userId: string): Promise<Result<number, RepositoryError>>;
}
