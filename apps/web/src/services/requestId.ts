/**
 * Generates a fresh UUID v4 for request correlation.
 *
 * Used by apiClient to populate the `X-Request-Id` header on every outgoing
 * request so that backend logs can be correlated with frontend activity.
 */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
