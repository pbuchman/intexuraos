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
  variant: 'primary' | 'secondary' | 'danger' | 'success';
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
 * Predicate operators for condition evaluation.
 */
export type PredicateOperator =
  | 'eq' // equality (===)
  | 'neq' // not equal (!==)
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'in' // value in array
  | 'nin' // value not in array
  | 'exists'; // field exists (not null/undefined)

/**
 * Basic predicate: { field, op, value }
 */
export interface Predicate {
  /** Dot-notation path to field (e.g., "status", "payload.prompt") */
  field: string;
  /** Comparison operator */
  op: PredicateOperator;
  /** Value to compare against (optional for 'exists' operator) */
  value?: unknown;
}

/**
 * AND logic - all conditions must be true.
 */
export interface AllCondition {
  /** Array of conditions (AND logic) */
  all: ConditionTree[];
}

/**
 * OR logic - at least one condition must be true.
 */
export interface AnyCondition {
  /** Array of conditions (OR logic) */
  any: ConditionTree[];
}

/**
 * NOT logic - negates the condition.
 */
export interface NotCondition {
  /** Condition to negate */
  not: ConditionTree;
}

/**
 * Condition tree = predicate OR logical operator.
 */
export type ConditionTree = Predicate | AllCondition | AnyCondition | NotCondition;

/**
 * Action mapping with conditions for a specific type.
 */
export interface ActionConfigTypeMapping {
  /** Action ID reference */
  action: string;
  /** When condition (optional - if missing, always true) */
  when?: ConditionTree;
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
  /** Type-specific action mappings (partial to allow incremental population) */
  types: Partial<Record<CommandType, ActionConfigType>>;
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
  variant: 'primary' | 'secondary' | 'danger' | 'success';
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
