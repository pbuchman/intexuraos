/**
 * Notification filters domain layer.
 *
 * Provides:
 * - models/  Domain entities (NotificationFiltersData, SavedNotificationFilter)
 * - ports/   Interfaces for external dependencies (NotificationFiltersRepository)
 */

// Models
export type {
  NotificationFilterOptions,
  SavedNotificationFilter,
  CreateSavedFilterInput,
  NotificationFiltersData,
  FilterOptionField,
} from './models/index.js';

// Ports
export type { NotificationFiltersRepository, FiltersRepositoryError } from './ports/index.js';
