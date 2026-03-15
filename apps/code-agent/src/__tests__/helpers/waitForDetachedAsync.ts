/**
 * Poll until a condition is met, for fire-and-forget async operations
 * (detached evaluate()) to settle. Replaces fixed-delay waits that are
 * unreliable in CI where runner speed varies.
 *
 * Throws if the condition is not met within the timeout, providing a
 * clear error message for CI debugging.
 */
export async function waitForDetachedAsync(
  condition: () => boolean,
  { timeout = 2000, interval = 10 } = {},
): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  if (!condition()) {
    throw new Error(`waitForDetachedAsync timed out after ${String(timeout)}ms`);
  }
}

/**
 * Fixed-delay wait for negative assertions (e.g., "should NOT have been called").
 * There is no positive condition to poll for, so a short fixed delay is appropriate.
 */
export async function waitForSettlement(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
