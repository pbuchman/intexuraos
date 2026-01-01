/**
 * Variable interpolation for action configuration system.
 * Replaces {{action.field}} placeholders with actual values from action object.
 */

import type { Action } from '../types';

/**
 * Interpolates variables in a request body template.
 * Replaces {{action.field}} placeholders with values from the action object.
 *
 * Supports:
 * - Simple fields: {{action.title}}
 * - Nested fields: {{action.payload.prompt}}
 * - Works recursively on objects and arrays
 *
 * @param template - Request body template with {{variable}} placeholders
 * @param action - Action object to get values from
 * @returns Interpolated object with placeholders replaced
 */
export function interpolateVariables(
  template: Record<string, unknown>,
  action: Action
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(template)) {
    result[key] = interpolateValue(value, action);
  }

  return result;
}

/**
 * Interpolates a single value (recursively handles objects and arrays).
 *
 * @param value - Value to interpolate
 * @param action - Action object
 * @returns Interpolated value
 */
function interpolateValue(value: unknown, action: Action): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, action);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, action));
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = interpolateValue(val, action);
    }
    return result;
  }

  return value;
}

/**
 * Interpolates placeholders in a string.
 * Replaces all {{path.to.field}} with values from action object.
 *
 * Examples:
 * - "{{action.title}}" → action.title value
 * - "{{action.payload.prompt}}" → action.payload.prompt value
 * - "Prefix {{action.title}} suffix" → "Prefix <value> suffix"
 *
 * @param str - String with placeholders
 * @param action - Action object
 * @returns String with placeholders replaced
 */
function interpolateString(str: string, action: Action): string {
  // Match {{variable.path}} patterns
  const pattern = /\{\{([^}]+)\}\}/g;

  return str.replace(pattern, (_match, path: string) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(action, trimmedPath);

    if (value === undefined || value === null) {
      return '';
    }

    // Convert to string for interpolation
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // For objects/arrays/unknown, use JSON
    return JSON.stringify(value);
  });
}

/**
 * Gets a nested value from an object using dot notation.
 *
 * @param obj - Object to get value from
 * @param path - Dot-separated path (e.g., "action.payload.prompt" or "payload.prompt")
 * @returns Value at path, or undefined if not found
 */
function getNestedValue(obj: unknown, path: string): unknown {
  let parts = path.split('.');

  // Remove "action" prefix if present (handles both "action.field" and "field" syntax)
  if (parts[0] === 'action') {
    parts = parts.slice(1);
  }

  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
