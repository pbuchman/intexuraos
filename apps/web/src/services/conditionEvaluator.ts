/**
 * Safe condition evaluator for action configuration system.
 * DOES NOT use eval() - parses and evaluates conditions manually.
 */

import type { Action } from '../types';

type ComparisonOperator = '==' | '!=' | '<' | '>' | '<=' | '>=';

interface ParsedCondition {
  field: string;
  operator: ComparisonOperator;
  value: string;
}

/**
 * Evaluates if all conditions match the action (AND logic).
 * Returns true only if ALL conditions are satisfied.
 *
 * @param action - Action object to evaluate against
 * @param conditions - Array of condition strings
 * @returns true if all conditions match, false otherwise
 */
export function evaluateConditions(action: Action, conditions: string[]): boolean {
  // All conditions must be true (AND logic)
  return conditions.every((condition) => evaluateCondition(action, condition));
}

/**
 * Evaluates a single condition against an action.
 *
 * Supported operators: ==, !=, <, >, <=, >=
 * Supported fields: status, confidence, type, and any top-level action property
 *
 * Examples:
 * - "status == 'pending'"
 * - "confidence > 0.8"
 * - "type != 'unclassified'"
 *
 * @param action - Action object
 * @param condition - Condition string to evaluate
 * @returns true if condition matches
 */
function evaluateCondition(action: Action, condition: string): boolean {
  try {
    const parsed = parseCondition(condition);
    const leftValue = getFieldValue(action, parsed.field);
    const rightValue = parseRightValue(parsed.value);

    return compare(leftValue, parsed.operator, rightValue);
  } catch (error) {
    console.warn(`Failed to evaluate condition "${condition}":`, error);
    return false;
  }
}

/**
 * Parses a condition string into field, operator, and value.
 *
 * @param condition - Condition string like "status == 'pending'"
 * @returns Parsed condition components
 */
function parseCondition(condition: string): ParsedCondition {
  const trimmed = condition.trim();

  // Match operators (order matters - check >= before >)
  const operators: ComparisonOperator[] = ['==', '!=', '<=', '>=', '<', '>'];

  for (const operator of operators) {
    const parts = trimmed.split(operator);
    if (parts.length === 2) {
      return {
        field: parts[0]?.trim() ?? '',
        operator,
        value: parts[1]?.trim() ?? '',
      };
    }
  }

  throw new Error(`Invalid condition syntax: "${condition}"`);
}

/**
 * Gets a field value from the action object.
 * Supports dot notation for nested fields (e.g., "payload.prompt").
 *
 * @param action - Action object
 * @param field - Field path (e.g., "status" or "payload.prompt")
 * @returns Field value
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

/**
 * Parses the right-hand side value of a condition.
 * Handles strings (with quotes), numbers, and booleans.
 *
 * @param value - Raw value string
 * @returns Parsed value
 */
function parseRightValue(value: string): string | number | boolean {
  // String literals with single or double quotes
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }

  // Boolean literals
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Numeric literals
  const numValue = Number(value);
  if (!isNaN(numValue)) {
    return numValue;
  }

  // Fallback to string
  return value;
}

/**
 * Compares two values using the specified operator.
 *
 * @param left - Left value
 * @param operator - Comparison operator
 * @param right - Right value
 * @returns Comparison result
 */
function compare(left: unknown, operator: ComparisonOperator, right: unknown): boolean {
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    default:
      return false;
  }
}
