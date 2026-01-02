/**
 * Port for Notification persistence.
 * Implemented by infra layer (Firestore).
 */
import type { Result } from '@intexuraos/common-core';
import type { CreateNotificationInput, Notification } from '../models/index.js';

/**
 * Repository error type.
 */
export interface RepositoryError {
  code: 'INTERNAL_ERROR';
  message: string;
}

/**
 * Filter options for listing notifications.
 * Multiple filters can be combined (AND logic).
 */
export interface FilterOptions {
  source?: string;
  app?: string;
  title?: string;
}

/**
 * Pagination options for listing notifications.
 */
export interface PaginationOptions {
  limit: number;
  cursor?: string;
  filter?: FilterOptions;
}

/**
 * Paginated result for notifications.
 */
export interface PaginatedNotifications {
  notifications: Notification[];
  nextCursor?: string;
}

/**
 * Repository for storing and retrieving mobile notifications.
 */
export interface NotificationRepository {
  /**
   * Save a new notification.
   */
  save(input: CreateNotificationInput): Promise<Result<Notification, RepositoryError>>;

  /**
   * Find a notification by ID.
   */
  findById(id: string): Promise<Result<Notification | null, RepositoryError>>;

  /**
   * Find notifications for a user with cursor-based pagination.
   */
  findByUserIdPaginated(
    userId: string,
    options: PaginationOptions
  ): Promise<Result<PaginatedNotifications, RepositoryError>>;

  /**
   * Check if a notification with the given notificationId exists for a user.
   * Used for idempotency.
   */
  existsByNotificationIdAndUserId(
    notificationId: string,
    userId: string
  ): Promise<Result<boolean, RepositoryError>>;

  /**
   * Delete a notification by ID.
   */
  delete(id: string): Promise<Result<void, RepositoryError>>;
}
