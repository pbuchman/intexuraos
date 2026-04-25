const EXPECTED_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Heuristic: is this an expected transient network error during VM startup
 * or shutdown?
 *
 * Expected: connection refused/reset/timed out, fetch aborted, fetch timed out.
 * Unwraps one layer of `error.cause` because Node's `fetch` wraps the
 * underlying `ECONNREFUSED` in a generic `TypeError: fetch failed`.
 */
export function isExpectedStartupNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === 'string' && EXPECTED_NETWORK_CODES.has(code)) return true;
  // unwrap one layer of cause (e.g., TypeError 'fetch failed' wrapping ECONNREFUSED)
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as Error & { code?: unknown }).code;
    if (typeof causeCode === 'string' && EXPECTED_NETWORK_CODES.has(causeCode)) return true;
    if (cause.name === 'AbortError' || cause.name === 'TimeoutError') return true;
  }
  return false;
}
