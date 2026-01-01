/**
 * TypeScript types for action configuration system.
 */

import type { Action, CommandType } from './index';

/**
 * HTTP endpoint configuration for an action.
 */
export interface ActionConfigEndpoint {
  /** API endpoint path with optional {actionId} placeholder */
  path: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Optional request body with {{variable}} interpolation */
  body?: Record<string, unknown>;
}

/**
 * UI configuration for an action button.
 */
export interface ActionConfigUI {
  /** Button label text */
  label: string;
  /** Button styling variant */
  variant: 'primary' | 'secondary' | 'danger';
  /** Lucide icon name */
  icon: string;
}

/**
 * Complete action definition.
 */
export interface ActionConfigAction {
  /** HTTP endpoint configuration */
  endpoint: ActionConfigEndpoint;
  /** UI configuration */
  ui: ActionConfigUI;
}

/**
 * Action mapping with conditions for a specific type.
 */
export interface ActionConfigTypeMapping {
  /** Action ID reference */
  action: string;
  /** Condition expressions (ALL must be true - AND logic) */
  conditions: string[];
}

/**
 * Configuration for a specific action type.
 */
export interface ActionConfigType {
  /** Array of actions with conditions */
  actions: ActionConfigTypeMapping[];
}

/**
 * Complete action configuration loaded from YAML.
 */
export interface ActionConfig {
  /** Global action definitions */
  actions: Record<string, ActionConfigAction>;
  /** Type-specific action mappings */
  types: Record<CommandType, ActionConfigType>;
}

/**
 * Resolved action button ready for rendering.
 */
export interface ResolvedActionButton {
  /** Action ID */
  id: string;
  /** Button label */
  label: string;
  /** Button variant */
  variant: 'primary' | 'secondary' | 'danger';
  /** Icon name */
  icon: string;
  /** Endpoint configuration */
  endpoint: ActionConfigEndpoint;
  /** Original action for context */
  action: Action;
}

/**
 * Result from useActionConfig hook.
 */
export interface UseActionConfigResult {
  /** Resolved action buttons for the action */
  buttons: ResolvedActionButton[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if config failed to load */
  error: string | null;
}
