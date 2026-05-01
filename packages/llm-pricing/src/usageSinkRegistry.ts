/**
 * Process-level registry of {@link FlushableUsageSink} instances so apps can
 * drain pending usage events on graceful shutdown without keeping their own
 * sink references.
 *
 * Why this exists
 * ---------------
 * The HTTP usage sinks ({@link HttpInternalAuthUsageSink},
 * {@link HttpWebhookUsageSink}) coalesce events on a 500ms unref'd timer.
 * `log()` resolves immediately after buffering. If the process exits between
 * a buffered `log()` and the next timer tick (Cloud Run scale-down,
 * SIGTERM/SIGINT, crash), recent usage events are dropped.
 *
 * Sinks register themselves on construction. Apps call
 * {@link flushAllUsageSinks} from their SIGTERM/SIGINT handler (after
 * `app.close()`) to make the final delivery before exit.
 *
 * Tests can call {@link clearUsageSinkRegistry} between cases to avoid
 * cross-test bleed.
 */

import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';

/**
 * Minimum surface a usage sink must expose to be drainable on shutdown.
 *
 * `flushSync()` is expected to:
 *  - Cancel any pending flush timer.
 *  - Wait for any flush already in flight.
 *  - POST whatever remains in the buffer once.
 *  - Resolve cleanly when the buffer is empty.
 *  - Reject (rather than swallow) on delivery failure so callers can decide
 *    whether to log or change exit code.
 */
export interface FlushableUsageSink {
  flushSync(): Promise<void>;
}

const sinks = new Set<FlushableUsageSink>();

/**
 * Adds a sink to the process-level registry. Idempotent (Set semantics).
 */
export function registerUsageSink(sink: FlushableUsageSink): void {
  sinks.add(sink);
}

/**
 * Removes a sink from the registry. Idempotent.
 */
export function unregisterUsageSink(sink: FlushableUsageSink): void {
  sinks.delete(sink);
}

/**
 * Empties the registry. Intended for test infrastructure — production code
 * should never call this.
 */
export function clearUsageSinkRegistry(): void {
  sinks.clear();
}

/**
 * Number of sinks currently registered. Exposed for assertions in tests.
 */
export function usageSinkRegistrySize(): number {
  return sinks.size;
}

export interface FlushAllUsageSinksOptions {
  /**
   * Per-sink hard deadline. After this many ms the per-sink drain is
   * abandoned and a warning is logged. Default 5000ms — Cloud Run gives
   * ~10s of grace on SIGTERM, so 5s leaves headroom for `app.close()` and
   * the actual exit.
   */
  timeoutMs?: number;
  /**
   * Optional logger for per-sink failures. When omitted, failures are
   * written to stderr so a missed-event warning is still visible in
   * Cloud Run logs.
   */
  logger?: Logger;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

/**
 * Drains every registered sink in parallel, with a per-sink timeout so a
 * single hung sink can't block shutdown. Failures are logged but never
 * thrown — the caller's exit code should reflect the outcome of
 * `app.close()` (the request lifecycle), not best-effort telemetry
 * delivery.
 */
export async function flushAllUsageSinks(opts: FlushAllUsageSinksOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  const logger = opts.logger;

  // Snapshot the registry so a sink that drops out mid-drain (e.g. test
  // teardown calling `clearUsageSinkRegistry`) doesn't perturb iteration.
  const snapshot = Array.from(sinks);
  if (snapshot.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    snapshot.map((sink) => drainOneWithTimeout(sink, timeoutMs))
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      const reason = getErrorMessage(result.reason, String(result.reason));
      if (logger !== undefined) {
        logger.warn(
          { error: reason },
          'flushAllUsageSinks: sink failed to drain on shutdown — usage events may be lost'
        );
      } else {
        process.stderr.write(`flushAllUsageSinks: sink failed to drain on shutdown: ${reason}\n`);
      }
    }
  }
}

async function drainOneWithTimeout(sink: FlushableUsageSink, timeoutMs: number): Promise<void> {
  // The Promise constructor synchronously invokes its executor, so `timer`
  // is definitely assigned before this function returns. The `as never`
  // initializer narrows the type so the linter doesn't flag the post-race
  // `clearTimeout(timer)` as unnecessary; the actual value is overwritten
  // before any use.
  let timer: NodeJS.Timeout = undefined as never;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`flushSync exceeded ${String(timeoutMs)}ms shutdown deadline`));
    }, timeoutMs);
    // Don't keep the event loop alive past the deadline if flushSync resolves
    // first.
    timer.unref();
  });

  try {
    await Promise.race([sink.flushSync(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
