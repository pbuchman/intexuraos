/**
 * Domain models for action filters.
 */
import type { ActionStatus, ActionType } from './action.js';

/**
 * Available filter options populated from actions.
 */
export interface ActionFilterOptions {
  status: ActionStatus[];
  type: ActionType[];
}

/**
 * User-saved filter configuration.
 */
export interface SavedActionFilter {
  id: string;
  name: string;
  status?: ActionStatus;
  type?: ActionType;
  createdAt: string;
}

/**
 * Input for creating a saved filter.
 */
export type CreateSavedActionFilterInput = Omit<SavedActionFilter, 'id' | 'createdAt'>;

/**
 * Complete filter data for a user.
 */
export interface ActionFiltersData {
  userId: string;
  options: ActionFilterOptions;
  savedFilters: SavedActionFilter[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Field names that can have filter options.
 */
export type ActionFilterOptionField = 'status' | 'type';
