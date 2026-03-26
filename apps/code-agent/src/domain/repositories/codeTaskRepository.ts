/**
 * Repository interface for CodeTask CRUD operations.
 * Provides three-layer deduplication to prevent duplicate tasks.
 */

import type { Result } from '@intexuraos/common-core';
import type FirebaseFirestore from '@google-cloud/firestore';
import type { CodeTask, TaskStatus, WorkerType } from '../models/codeTask.js';

export interface CreateTaskInput {
  /** Pre-generated task ID. Auto-generated if not provided. */
  id?: string;
  userId: string;
  prompt: string;
  sanitizedPrompt: string;
  systemPromptHash: string;
  workerType: WorkerType;
  workerLocation: string;
  repository: string;
  baseBranch: string;
  traceId: string;
  actionId?: string;
  approvalEventId?: string;
  linearIssueId?: string;
  webhookSecret?: string;
  /**
   * For retried tasks: points to the original task ID that this task is retrying.
   * Used for tracking retry chains and debugging.
   */
  retriedFrom?: string;

  // PR Correlation (INT-465)
  prNumber?: number;
  prBranch?: string;

  // Follow-up tracking (INT-465)
  parentTaskId?: string;
  followUpReason?: 'pr_comment' | 'user_feedback' | 'retry' | 'execution_implement' | 'ci_failure';
  agentType?: 'planning' | 'execution' | 'pull_request' | 'review';
  /** Initial task status. Defaults to 'queued' if not specified. */
  initialStatus?: 'queued' | 'dispatched';

  // Dispatch metadata stored for queue-based dispatch (INT-949)
  planningPrBranch?: string;
  planningPrUrl?: string;
  trackingCommentId?: string;

  // Review task metadata
  reviewTypes?: string[];
  executionMemoryContext?: CodeTask['executionMemoryContext'];
  executionMemoryPostRun?: CodeTask['executionMemoryPostRun'];
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  result?: CodeTask['result'];
  error?: CodeTask['error'] | null;
  statusSummary?: CodeTask['statusSummary'];
  workerLocation?: string;
  callbackReceived?: boolean;
  queuedAt?: Date;               // When task entered queue (INT-619)
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
  pendingUserMessages?: string[];
  implementationTaskId?: string | null;
  // PR correlation (INT-465): populated on task completion from result.prUrl
  prNumber?: number;
  prBranch?: string;
  executionMemoryContext?: CodeTask['executionMemoryContext'];
  executionMemoryPostRun?: CodeTask['executionMemoryPostRun'];
}

export interface ListTasksInput {
  userId: string;
  status?: TaskStatus[];
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
   * 3. linearIssueId active check for non-review tasks - lines 448-458
   */
  create(input: CreateTaskInput, options?: { transaction?: FirebaseFirestore.Transaction }): Promise<Result<CodeTask, RepositoryError>>;

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
   * Check if Linear issue has an active blocking task.
   * Review tasks are ignored because they should not block
   * execution, retry, feedback, or generic issue-lifecycle checks.
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

  /**
   * Find tasks eligible for log archival (completed before cutoff, not yet archived).
   */
  findArchivableTasks(
    cutoffDate: Date,
    limit: number
  ): Promise<Result<{ taskId: string }[], RepositoryError>>;

  /**
   * Archive logs for a task: delete logs subcollection and mark task as archived.
   */
  archiveTaskLogs(
    taskId: string,
    batchSize: number
  ): Promise<Result<{ logCount: number; archivedAt: Date }, RepositoryError>>;

  /**
   * Find the task that created a specific PR.
   * Used for PR comment auto-response to link back to original task (INT-465).
   */
  findByPR(
    repository: string,
    prNumber: number
  ): Promise<Result<CodeTask | null, RepositoryError>>;

  /**
   * Find an active review task for a PR.
   * Used to deduplicate review-task creation for rapid synchronize events.
   * Returns null if no queued/dispatched/running review task exists.
   */
  findActiveReviewForPR(
    repository: string,
    prNumber: number
  ): Promise<Result<CodeTask | null, RepositoryError>>;

  /**
   * Find the newest non-review task for a PR.
   * Used to route generic PR comments to existing non-review tasks.
   * Returns null if no non-review tasks exist for the PR.
   * Treats tasks with missing agentType as non-review (backward compatibility).
   */
  findLatestNonReviewTaskByPR(
    repository: string,
    prNumber: number
  ): Promise<Result<CodeTask | null, RepositoryError>>;

  /**
   * Find newest tasks for a Linear issue.
   * Used to recover open PR continuity across retries and follow-ups.
   */
  findRecentTasksByLinearIssue(
    linearIssueId: string,
    limit: number
  ): Promise<Result<CodeTask[], RepositoryError>>;

  /**
   * Delete a task by ID, scoped to a user.
   * Returns NOT_FOUND if the task does not exist or belongs to a different user.
   */
  deleteTask(taskId: string, userId: string): Promise<Result<void, RepositoryError>>;

  /**
   * List queued tasks ordered by queuedAt ascending (FIFO), limited to `limit`.
   * Used by drainTaskQueue to find dispatchable candidates (INT-949).
   */
  listQueuedByAge(limit: number): Promise<Result<CodeTask[], RepositoryError>>;

  /**
   * List all currently queued tasks, ordered by queuedAt ascending (FIFO).
   * Used by the dispatch queue API endpoint (INT-949).
   */
  listQueued(): Promise<Result<CodeTask[], RepositoryError>>;

  /**
   * Count currently queued tasks (INT-619).
   * Used to check queue capacity before adding new tasks.
   */
  countQueued(): Promise<Result<number, RepositoryError>>;

  /**
   * Find a planned planning task for a Linear issue that has no implementation task yet (INT-725).
   * Used to back-link execution tasks to their planning predecessor.
   * Returns null if no matching task exists.
   *
   * Assumption: at most one planned planning task exists per Linear issue
   * without an implementationTaskId set. Uses limit(1) for efficiency.
   */
  findPlannedTaskByLinearIssue(
    linearIssueId: string
  ): Promise<Result<CodeTask | null, RepositoryError>>;

  /**
   * List execution tasks waiting for scheduler-backed execution-memory post-run processing.
   */
  listPendingExecutionMemoryPostRun(limit: number): Promise<Result<CodeTask[], RepositoryError>>;
}
