/**
 * Action executor for performing configured actions via API.
 */

import type { Action } from '../types';
import type { ActionConfigEndpoint } from '../types/actionConfig';
import { interpolateVariables } from './variableInterpolator';

/**
 * Request function type (from useApiClient).
 */
export type RequestFunction = <T>(
  baseUrl: string,
  path: string,
  options?: RequestOptions
) => Promise<T>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Executes an action using the configured endpoint.
 *
 * Steps:
 * 1. Replaces {actionId} placeholder in path with actual action ID
 * 2. Interpolates {{action.field}} variables in request body
 * 3. Executes API request
 *
 * @param endpoint - Endpoint configuration
 * @param action - Action to execute
 * @param request - Request function from useApiClient
 * @param baseUrl - Base URL for the API (e.g., import.meta.env.INTEXURAOS_COMMANDS_ROUTER_SERVICE_URL)
 * @returns Promise resolving to API response
 */
export async function executeAction(
  endpoint: ActionConfigEndpoint,
  action: Action,
  request: RequestFunction,
  baseUrl: string
): Promise<unknown> {
  // Replace {actionId} placeholder with actual ID
  const path = endpoint.path.replace('{actionId}', action.id);

  // Interpolate variables in body if present
  let body: unknown = undefined;
  if (endpoint.body !== undefined) {
    body = interpolateVariables(endpoint.body, action);
  }

  // Validate that all required variables were interpolated
  if (body !== undefined && hasUndefinedValues(body)) {
    throw new Error('Action execution failed: some required variables are undefined');
  }

  // Execute request
  return await request(baseUrl, path, {
    method: endpoint.method,
    body,
  });
}

/**
 * Checks if an object contains any undefined values (recursively).
 * Used to validate that all variables were successfully interpolated.
 *
 * @param obj - Object to check
 * @returns true if any value is undefined
 */
function hasUndefinedValues(obj: unknown): boolean {
  if (obj === undefined) {
    return true;
  }

  if (obj === null || typeof obj !== 'object') {
    return false;
  }

  if (Array.isArray(obj)) {
    return obj.some(hasUndefinedValues);
  }

  return Object.values(obj as Record<string, unknown>).some(hasUndefinedValues);
}
