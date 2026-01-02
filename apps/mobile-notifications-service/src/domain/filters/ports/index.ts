/**
 * Port for NotificationFilters persistence.
 * Implemented by infra layer (Firestore).
 */
import type { Result } from '@intexuraos/common-core';
import type {
  CreateSavedFilterInput,
  FilterOptionField,
  NotificationFiltersData,
  SavedNotificationFilter,
} from '../models/index.js';

/**
 * Repository error type.
 */
export interface FiltersRepositoryError {
  code: 'INTERNAL_ERROR' | 'NOT_FOUND';
  message: string;
}

/**
 * Repository for managing notification filter options and saved filters.
 */
export interface NotificationFiltersRepository {
  /**
   * Get filter data for a user.
   * Returns null if user has no filter data yet.
   */
  getByUserId(
    userId: string
  ): Promise<Result<NotificationFiltersData | null, FiltersRepositoryError>>;

  /**
   * Add a value to the options array for a specific field.
   * Uses atomic array union to avoid duplicates.
   * Creates document if it doesn't exist.
   */
  addOption(
    userId: string,
    field: FilterOptionField,
    value: string
  ): Promise<Result<void, FiltersRepositoryError>>;

  /**
   * Add multiple options at once.
   * Useful when processing a notification with app, device, and source.
   */
  addOptions(
    userId: string,
    options: Partial<Record<FilterOptionField, string>>
  ): Promise<Result<void, FiltersRepositoryError>>;

  /**
   * Create a new saved filter for a user.
   */
  addSavedFilter(
    userId: string,
    filter: CreateSavedFilterInput
  ): Promise<Result<SavedNotificationFilter, FiltersRepositoryError>>;

  /**
   * Delete a saved filter by ID.
   */
  deleteSavedFilter(
    userId: string,
    filterId: string
  ): Promise<Result<void, FiltersRepositoryError>>;
}
