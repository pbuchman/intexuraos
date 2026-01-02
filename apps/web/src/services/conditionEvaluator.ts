/**
 * Condition evaluator for action configuration system.
 * Supports logical tree evaluation (AND/OR/NOT) with type-safe predicates.
 * DOES NOT use eval() - all evaluation is explicit and safe.
 */

import type { Action } from '../types';
import type {
  ConditionTree,
  Predicate,
  AllCondition,
  AnyCondition,
  NotCondition,
} from '../types/actionConfig';

/**
 * Evaluates a condition tree against an action.
 *
 * @param action - Action object to evaluate against
 * @param when - Condition tree (if undefined, returns true)
 * @returns true if condition is satisfied, false otherwise
 */
export function evaluateCondition(action: Action, when?: ConditionTree): boolean {
  if (when === undefined) {
    return true; // No condition = always true
  }

  // Check if predicate (has 'field' property)
  if ('field' in when) {
    return evaluatePredicate(action, when);
  }

  // Check logical operators
  if ('all' in when) {
    return evaluateAll(action, when);
  }

  if ('any' in when) {
    return evaluateAny(action, when);
  }

  if ('not' in when) {
    return evaluateNot(action, when);
  }

  // Unknown structure - return false as fallback
  return false;
}

/**
 * Evaluates AND logic - all conditions must be true.
 * Short-circuits on first false.
 *
 * @param action - Action object
 * @param condition - AllCondition tree
 * @returns true if all conditions are true
 */
function evaluateAll(action: Action, condition: AllCondition): boolean {
  return condition.all.every((child) => evaluateCondition(action, child));
}

/**
 * Evaluates OR logic - at least one condition must be true.
 * Short-circuits on first true.
 *
 * @param action - Action object
 * @param condition - AnyCondition tree
 * @returns true if any condition is true
 */
function evaluateAny(action: Action, condition: AnyCondition): boolean {
  return condition.any.some((child) => evaluateCondition(action, child));
}

/**
 * Evaluates NOT logic - negates the condition.
 *
 * @param action - Action object
 * @param condition - NotCondition tree
 * @returns true if condition is false
 */
function evaluateNot(action: Action, condition: NotCondition): boolean {
  return !evaluateCondition(action, condition.not);
}

/**
 * Evaluates a single predicate against an action.
 *
 * @param action - Action object
 * @param predicate - Predicate to evaluate
 * @returns true if predicate is satisfied
 */
function evaluatePredicate(action: Action, predicate: Predicate): boolean {
  const fieldValue = getFieldValue(action, predicate.field);

  switch (predicate.op) {
    case 'eq':
      return fieldValue === predicate.value;

    case 'neq':
      return fieldValue !== predicate.value;

    case 'gt':
      return (
        typeof fieldValue === 'number' &&
        typeof predicate.value === 'number' &&
        fieldValue > predicate.value
      );

    case 'gte':
      return (
        typeof fieldValue === 'number' &&
        typeof predicate.value === 'number' &&
        fieldValue >= predicate.value
      );

    case 'lt':
      return (
        typeof fieldValue === 'number' &&
        typeof predicate.value === 'number' &&
        fieldValue < predicate.value
      );

    case 'lte':
      return (
        typeof fieldValue === 'number' &&
        typeof predicate.value === 'number' &&
        fieldValue <= predicate.value
      );

    case 'in':
      return Array.isArray(predicate.value) && predicate.value.includes(fieldValue);

    case 'nin':
      return Array.isArray(predicate.value) && !predicate.value.includes(fieldValue);

    case 'exists': {
      const exists = fieldValue !== null && fieldValue !== undefined;
      // If value is undefined, just check existence
      // If value is boolean, check if existence matches
      return predicate.value === undefined ? exists : exists === predicate.value;
    }

    default:
      return false;
  }
}

/**
 * Gets a field value from the action object.
 * Supports dot notation for nested fields (e.g., "payload.prompt").
 *
 * @param action - Action object
 * @param field - Field path (e.g., "status" or "payload.prompt")
 * @returns Field value (undefined if not found)
 */
function getFieldValue(action: Action, field: string): unknown {
  const parts = field.split('.');
  let value: unknown = action;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}
