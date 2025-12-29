/**
 * Use case for listing user's notifications with pagination.
 */
import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  NotificationRepository,
  RepositoryError,
  PaginatedNotifications,
  PaginationOptions,
} from '../ports/index.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Input for listing notifications.
 */
export interface ListNotificationsInput {
  userId: string;
  limit?: number;
  cursor?: string;
  source?: string;
  app?: string;
}

/**
 * List notifications for a user with pagination.
 */
export async function listNotifications(
  input: ListNotificationsInput,
  repo: NotificationRepository
): Promise<Result<PaginatedNotifications, RepositoryError>> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const options: PaginationOptions = { limit };
  if (input.cursor !== undefined) {
    options.cursor = input.cursor;
  }

  // Add filter if source or app is provided
  if (input.source !== undefined || input.app !== undefined) {
    options.filter = {};
    if (input.source !== undefined) {
      options.filter.source = input.source;
    }
    if (input.app !== undefined) {
      options.filter.app = input.app;
    }
  }

  const result = await repo.findByUserIdPaginated(input.userId, options);

  if (!result.ok) {
    return err(result.error);
  }

  return ok(result.value);
}
