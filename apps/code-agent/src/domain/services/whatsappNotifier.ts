/**
 * WhatsApp notifier service interface.
 *
 * Sends WhatsApp notifications to users when their code tasks complete or fail.
 * Design reference: docs/designs/INT-156-code-action-type.md lines 97-100
 */

import type { Result } from '@intexuraos/common-core';
import type { CodeTask, TaskError } from '../models/codeTask.js';

/**
 * Possible errors during notification sending.
 */
export interface NotificationError {
  code: 'notification_failed';
  message?: string;
}

/**
 * WhatsApp notifier service interface.
 *
 * Notifies users via WhatsApp when code tasks complete or fail.
 * Failures are logged but don't block task completion (best-effort).
 */
export interface WhatsAppNotifier {
  /**
   * Send notification when task completes successfully.
   *
   * @param userId - User ID to send notification to
   * @param task - Completed task with result
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskComplete(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when task fails.
   *
   * @param userId - User ID to send notification to
   * @param task - Failed task
   * @param error - Error details
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskFailed(
    userId: string,
    task: CodeTask,
    error: TaskError
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when task starts with interactive cancel/view buttons.
   * Design reference: INT-379
   *
   * @param userId - User ID to send notification to
   * @param task - Started task with cancelNonce set
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskStarted(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when a terminal task is resumed with a user message.
   *
   * @param userId - User ID to send notification to
   * @param task - Resumed task
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskResumed(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when a resumed session completes successfully.
   * Distinct from notifyTaskComplete — uses 🔁 emoji and Gemini-extracted summary.
   *
   * @param userId - User ID to send notification to
   * @param task - Completed task with result (summary may be Gemini-extracted)
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyResumedTaskComplete(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when Phase 1 (design) completes, with button to proceed to Phase 2.
   * INT-628
   *
   * @param userId - User ID to send notification to
   * @param task - Completed design task
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyDesignComplete(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when task is queued due to worker capacity.
   * INT-619
   *
   * @param userId - User ID to send notification to
   * @param task - Queued task
   * @param position - Position in queue (1-based)
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskQueued(
    userId: string,
    task: CodeTask,
    position: number
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when queued task expires due to TTL.
   * INT-619
   *
   * @param userId - User ID to send notification to
   * @param task - Expired task
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyTaskQueueExpired(
    userId: string,
    task: CodeTask
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when dispatch retry attempts are exhausted.
   *
   * @param userId - User ID to send notification to
   * @param info - Context about the failed dispatch
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyDispatchRetryExhausted(
    userId: string,
    info: { repository: string; pullRequestNumber: number; lastError: string }
  ): Promise<Result<void, NotificationError>>;

  /**
   * Send notification when a CI check fails on an agent-created PR.
   * INT-853
   *
   * @param userId - User ID to send notification to
   * @param info - CI failure details including PR URL, check name, branch, and run URL
   * @returns Ok(undefined) on success, Err on failure
   */
  notifyCIFailure(
    userId: string,
    info: {
      repository: string;
      pullRequestNumber: number;
      prUrl: string;
      checkName: string;
      branch: string;
      runUrl?: string;
      taskId: string;
    }
  ): Promise<Result<void, NotificationError>>;
}
