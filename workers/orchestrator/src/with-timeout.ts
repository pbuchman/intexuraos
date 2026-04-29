/**
 * Race a promise against a timeout. Rejects with the given message if the
 * timeout fires first. The timer is always cleaned up (success or failure)
 * to prevent leaks.
 *
 * INT-1551 §E.7: an optional `abortSignal` may be passed to short-circuit the
 * race when the orchestrator's top-level shutdown signal fires. The promise
 * itself does NOT receive the signal — abort here only causes `withTimeout`
 * to reject early so SIGTERM-driven graceful shutdown does not have to wait
 * for the full `ms` budget. Callers are responsible for any cleanup of the
 * still-running underlying work (e.g. the zombie-container handler in
 * `task-runner.ts`).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  abortSignal?: AbortSignal
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  const abortPromise = new Promise<never>((_, reject) => {
    if (abortSignal === undefined) return;
    if (abortSignal.aborted) {
      reject(new Error(`${message} (aborted by shutdown signal)`));
      return;
    }
    abortHandler = (): void => {
      reject(new Error(`${message} (aborted by shutdown signal)`));
    };
    abortSignal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeoutHandle);
    if (abortSignal !== undefined && abortHandler !== undefined) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
}
