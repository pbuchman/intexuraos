import { randomUUID } from 'node:crypto';

/**
 * Standard request ID header name.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Extract request ID from headers or generate a fallback UUID.
 */
export function getRequestId(headers: Record<string, string | string[] | undefined>): string {
  const value = headers[REQUEST_ID_HEADER];

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }

  return randomUUID();
}
