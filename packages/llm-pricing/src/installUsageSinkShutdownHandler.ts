/**
 * Shared graceful-shutdown helper that drains buffered usage events before
 * the process exits.
 *
 * Why this exists
 * ---------------
 * Every Fastify app in the monorepo had a near-identical SIGTERM/SIGINT
 * handler:
 *
 * ```ts
 * const close = (): void => {
 *   app.close().then(() => process.exit(0), () => process.exit(1));
 * };
 * process.on('SIGTERM', close);
 * process.on('SIGINT', close);
 * ```
 *
 * That pattern exits as soon as `app.close()` resolves — but the HTTP usage
 * sinks coalesce events on a 500ms unref'd timer, so any event buffered in
 * the last half-second is dropped on shutdown. This helper installs the
 * same SIGTERM/SIGINT pair but interposes `flushAllUsageSinks()` between
 * `app.close()` and `process.exit()` so the final batch is delivered.
 *
 * The helper takes a `CloseableApp` interface rather than `FastifyInstance`
 * to keep `@intexuraos/llm-pricing` free of a Fastify dep — Fastify already
 * conforms structurally.
 */

import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import { flushAllUsageSinks, type FlushAllUsageSinksOptions } from './usageSinkRegistry.js';

/** Structural type matching `FastifyInstance.close()` and equivalents. */
export interface CloseableApp {
  close(): Promise<void>;
}

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface InstallUsageSinkShutdownHandlerOptions {
  /** The Fastify (or compatible) instance to close on signal. */
  app: CloseableApp;
  /** Defaults to `['SIGTERM', 'SIGINT']`. */
  signals?: readonly ShutdownSignal[];
  /** Per-sink flush deadline forwarded to {@link flushAllUsageSinks}. */
  flushTimeoutMs?: FlushAllUsageSinksOptions['timeoutMs'];
  /**
   * Logger used for diagnostic messages from this helper AND forwarded to
   * `flushAllUsageSinks` so per-sink failures land on the same logger.
   */
  logger?: Logger;
  /**
   * Override the exit primitive. Tests inject a stub here so they can assert
   * the exit code without terminating the test runner.
   */
  exit?: (code: number) => void;
}

/**
 * Wires SIGTERM/SIGINT to a close-and-drain sequence:
 *
 *  1. `app.close()` — stop accepting new requests, wait for in-flight ones
 *     (those may still log usage events on the way out).
 *  2. `flushAllUsageSinks()` — make a final POST per registered sink, with
 *     a per-sink timeout so a hung sink can't block the exit.
 *  3. `process.exit(code)` — `0` if `app.close()` succeeded, `1` if it
 *     failed. A drain failure does not flip the exit code: telemetry
 *     reliability shouldn't gate the request-lifecycle exit signal.
 *
 * Returns a disposer that removes the listeners, so tests can register and
 * unregister without piling up handlers across cases.
 */
export function installUsageSinkShutdownHandler(
  opts: InstallUsageSinkShutdownHandlerOptions
): () => void {
  const signals: readonly ShutdownSignal[] = opts.signals ?? ['SIGTERM', 'SIGINT'];
  const exit = opts.exit ?? defaultExit;

  const handler = (): void => {
    void runShutdown(opts).then(exit);
  };

  for (const signal of signals) {
    process.on(signal, handler);
  }

  return (): void => {
    for (const signal of signals) {
      process.off(signal, handler);
    }
  };
}

/**
 * Default exit primitive — separated so tests can call it directly while
 * stubbing `process.exit`. Without this seam, the inline arrow function
 * inside `installUsageSinkShutdownHandler` would never be invoked in tests
 * (firing the real signal would terminate the runner) and v8 would flag
 * the arrow body as uncovered.
 */
export function defaultExit(code: number): void {
  process.exit(code);
}

async function runShutdown(opts: InstallUsageSinkShutdownHandlerOptions): Promise<number> {
  let exitCode = 0;
  try {
    await opts.app.close();
  } catch (error) {
    exitCode = 1;
    if (opts.logger !== undefined) {
      opts.logger.warn(
        { error: getErrorMessage(error) },
        'app.close() failed during shutdown — proceeding to drain usage sinks'
      );
    }
  }

  // `flushAllUsageSinks` is contractually safe: it wraps each per-sink drain
  // in Promise.allSettled and logs failures internally, so it never throws.
  // We rely on that contract to keep this path simple — adding a try/catch
  // here would add a defensive branch with no testable failure mode.
  await flushAllUsageSinks({
    ...(opts.flushTimeoutMs !== undefined ? { timeoutMs: opts.flushTimeoutMs } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  });

  return exitCode;
}
