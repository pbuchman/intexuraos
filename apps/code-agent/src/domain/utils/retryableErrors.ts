/**
 * Error classification for dispatch retry decisions.
 *
 * Determines whether a dispatch failure is transient (worth retrying)
 * or permanent (should fail immediately).
 */

/** Dispatch error codes that indicate transient infrastructure failures worth retrying. */
const RETRYABLE_ERROR_CODES = new Set([
  'worker_unavailable',
  'worker_busy',
  'at_capacity',
  'network_error',
]);

/**
 * Check if a dispatch error code represents a transient failure worth retrying.
 *
 * Retryable: worker_unavailable, worker_busy, at_capacity, network_error.
 * Not retryable: dispatch_failed, invalid_response.
 */
export function isRetryableErrorCode(code: string): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}
