/**
 * Use case for deleting a notification with ownership verification.
 */
import { ok, err, type Result } from '@intexuraos/common';
import type { NotificationRepository, RepositoryError } from '../ports/index.js';

/**
 * Input for deleting a notification.
 */
export interface DeleteNotificationInput {
  notificationId: string;
  userId: string;
}

/**
 * Error from deleting a notification.
 */
export interface DeleteNotificationError {
  code: 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
  message: string;
}

/**
 * Delete a notification with ownership verification.
 */
export async function deleteNotification(
  input: DeleteNotificationInput,
  repo: NotificationRepository
): Promise<Result<void, DeleteNotificationError | RepositoryError>> {
  // Fetch the notification to verify ownership
  const findResult = await repo.findById(input.notificationId);
  if (!findResult.ok) {
    return err(findResult.error);
  }

  // Check if notification exists
  if (findResult.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Notification not found' });
  }

  // Verify ownership
  if (findResult.value.userId !== input.userId) {
    return err({ code: 'FORBIDDEN', message: 'You do not own this notification' });
  }

  // Delete the notification
  const deleteResult = await repo.delete(input.notificationId);
  if (!deleteResult.ok) {
    return err(deleteResult.error);
  }

  return ok(undefined);
}
