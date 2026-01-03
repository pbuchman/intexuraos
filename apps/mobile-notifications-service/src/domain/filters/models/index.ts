/**
 * Domain models for notification filters.
 */

/**
 * Available filter options populated from notifications.
 */
export interface NotificationFilterOptions {
  app: string[];
  device: string[];
  source: string[];
}

/**
 * User-saved filter configuration.
 * Filter fields are arrays for multi-select support.
 */
export interface SavedNotificationFilter {
  id: string;
  name: string;
  app?: string[];
  device?: string[];
  source?: string[];
  title?: string;
  createdAt: string;
}

/**
 * Input for creating a saved filter.
 */
export type CreateSavedFilterInput = Omit<SavedNotificationFilter, 'id' | 'createdAt'>;

/**
 * Complete filter data for a user.
 */
export interface NotificationFiltersData {
  userId: string;
  options: NotificationFilterOptions;
  savedFilters: SavedNotificationFilter[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Field names that can have filter options.
 */
export type FilterOptionField = 'app' | 'device' | 'source';
