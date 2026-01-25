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
}
