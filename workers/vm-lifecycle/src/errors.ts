const EXPECTED_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function getErrorCode(e: Error): string | undefined {
  const code = (e as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorCause(e: Error): unknown {
  return (e as Error & { cause?: unknown }).cause;
}

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
  const code = getErrorCode(error);
  if (code !== undefined && EXPECTED_NETWORK_CODES.has(code)) return true;
  // unwrap one layer of cause (e.g., TypeError 'fetch failed' wrapping ECONNREFUSED)
  const cause = getErrorCause(error);
  if (cause instanceof Error) {
    const causeCode = getErrorCode(cause);
    if (causeCode !== undefined && EXPECTED_NETWORK_CODES.has(causeCode)) return true;
    if (cause.name === 'AbortError' || cause.name === 'TimeoutError') return true;
  }
  return false;
}
