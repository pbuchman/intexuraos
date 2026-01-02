/**
 * Port for ActionFilters persistence.
 * Implemented by infra layer (Firestore).
 */
import type {
  ActionFilterOptionField,
  ActionFiltersData,
  CreateSavedActionFilterInput,
  SavedActionFilter,
} from '../models/actionFilters.js';

/**
 * Repository for managing action filter options and saved filters.
 */
export interface ActionFiltersRepository {
  /**
   * Get filter data for a user.
   * Returns null if user has no filter data yet.
   */
  getByUserId(userId: string): Promise<ActionFiltersData | null>;

  /**
   * Add a value to the options array for a specific field.
   * Uses atomic array union to avoid duplicates.
   * Creates document if it doesn't exist.
   */
  addOption(userId: string, field: ActionFilterOptionField, value: string): Promise<void>;

  /**
   * Add multiple options at once.
   * Useful when processing an action with status and type.
   */
  addOptions(
    userId: string,
    options: Partial<Record<ActionFilterOptionField, string>>
  ): Promise<void>;

  /**
   * Create a new saved filter for a user.
   */
  addSavedFilter(userId: string, filter: CreateSavedActionFilterInput): Promise<SavedActionFilter>;

  /**
   * Delete a saved filter by ID.
   */
  deleteSavedFilter(userId: string, filterId: string): Promise<void>;
}
