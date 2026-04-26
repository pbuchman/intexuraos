import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInboxSyncOptions<T> {
  /**
   * Poll function. Receives an AbortSignal that will be aborted on unmount
   * or when the next poll starts. Implementations should forward it to
   * `fetch` (or similar) so cancellation propagates to the network layer.
   */
  poll: (signal: AbortSignal) => Promise<T>;
  /**
   * Interval in milliseconds between successful polls. If omitted or
   * non-positive, no automatic re-polling is scheduled.
   */
  intervalMs?: number;
}

export interface UseInboxSyncResult<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refresh: () => void;
}

/**
 * Long-polling sync hook: invokes `poll` on mount, schedules subsequent
 * polls at `intervalMs`, cancels in-flight requests on unmount, and exposes
 * a `refresh()` for manual re-polling.
 *
 * Cancellation strategy: a single AbortController is shared per mount cycle.
 * On unmount or refresh(), the active controller is aborted; in-flight
 * `poll(signal)` calls observe this via the signal. Settles after abort are
 * ignored.
 */
export function useInboxSync<T>(opts: UseInboxSyncOptions<T>): UseInboxSyncResult<T> {
  const { poll, intervalMs } = opts;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const pollRef = useRef(poll);
  pollRef.current = poll;

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearScheduled = useCallback((): void => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const runPoll = useCallback(async (): Promise<void> => {
    // Cancel any prior in-flight request.
    if (abortRef.current !== null) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    clearScheduled();

    try {
      const result = await pollRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- signal.aborted may flip during the awaited poll above
    if (intervalMs !== undefined && intervalMs > 0 && !controller.signal.aborted) {
      timeoutRef.current = window.setTimeout(() => {
        void runPoll();
      }, intervalMs);
    }
  }, [intervalMs, clearScheduled]);

  const refresh = useCallback((): void => {
    void runPoll();
  }, [runPoll]);

  useEffect(() => {
    void runPoll();
    return (): void => {
      clearScheduled();
      if (abortRef.current !== null) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [runPoll, clearScheduled]);

  return { data, loading, error, refresh };
}
