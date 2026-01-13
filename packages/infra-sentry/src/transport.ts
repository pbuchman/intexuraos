/**
 * Pino transport configuration for Sentry error tracking.
 *
 * Creates a custom Pino stream that sends error/warn/fatal logs to Sentry
 * while all logs still go to stdout (for Cloud Logging).
 *
 * Designed to work with esbuild bundling where worker threads with
 * external files are problematic.
 *
 * @example
 * ```ts
 * import { createSentryStream, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 * import pino from 'pino';
 *
 * const app = Fastify({
 *   logger: {
 *     level: 'info',
 *     stream: createSentryStream(
 *       pino.multistream([
 *         pino.destination({ dest: 1, sync: false }), // stdout
 *       ])
 *     ),
 *   },
 * });
 * setupSentryErrorHandler(app);
 * ```
 */

import * as Sentry from '@sentry/node';
import type { LogDescriptor } from 'pino';

/**
 * Environment variable name for Sentry DSN.
 */
const SENTRY_DSN_ENV = 'INTEXURAOS_SENTRY_DSN';

/**
 * Pino level numbers to names.
 */
const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/**
 * Levels that should be sent to Sentry (warn, error, fatal).
 */
const SENTRY_LEVELS = new Set([40, 50, 60]);

/**
 * Check if Sentry DSN is configured.
 */
export function isSentryConfigured(): boolean {
  const dsn = process.env[SENTRY_DSN_ENV];
  return dsn !== undefined && dsn !== '';
}

/**
 * Create a custom Pino stream that sends error/warn/fatal logs to Sentry.
 *
 * This works with esbuild bundling and doesn't require external worker files.
 * All logs still go to stdout (via the multistream), while error/warn/fatal
 * are additionally sent to Sentry.
 *
 * @param multistream - Pino multistream (must include stdout destination)
 * @returns The same multistream with Sentry stream added
 */
export function createSentryStream(
  multistream: ReturnType<typeof import('pino').multistream>
): ReturnType<typeof import('pino').multistream> {
  if (!isSentryConfigured()) {
    return multistream;
  }

  // Cast to access internal streams array
  const ms = multistream as unknown as {
    streams: Array<{ level: number; stream: NodeJS.WritableStream }>;
  };

  // Add our Sentry stream at warn level (40)
  ms.streams.push({
    level: 40,
    stream: {
      write: (data: string) => {
        try {
          const logEntry = JSON.parse(data) as LogDescriptor;
          sendLogToSentry(logEntry);
        } catch {
          // Ignore parse errors
        }
      },
    } as unknown as NodeJS.WritableStream,
  });

  return multistream;
}

/**
 * Send a log entry to Sentry.
 */
function sendLogToSentry(logEntry: LogDescriptor): void {
  if (!SENTRY_LEVELS.has(logEntry.level)) {
    return;
  }

  const { level, msg, ...rest } = logEntry;

  Sentry.withScope((scope) => {
    // Add structured context as extra data
    if (Object.keys(rest).length > 0) {
      scope.setExtras(rest);
    }

    if (level >= 50) {
      // error or fatal - capture as exception
      const error = new Error(typeof msg === 'string' ? msg : String(msg));
      // Add stack trace if available in the log
      if (typeof rest.err === 'object' && rest.err !== null && 'stack' in rest.err) {
        error.stack = String(rest.err.stack);
      }
      if (typeof rest.err === 'object' && rest.err !== null && 'message' in rest.err) {
        error.message = String(rest.err.message);
      }
      scope.setLevel(level >= 60 ? 'fatal' : 'error');
      Sentry.captureException(error);
    } else {
      // warn - capture as message
      scope.setLevel('warning');
      Sentry.captureMessage(typeof msg === 'string' ? msg : String(msg));
    }
  });
}

/**
 * Legacy transport function for backward compatibility.
 *
 * @deprecated Use createSentryStream with multistream instead.
 * This function now returns undefined for all cases.
 *
 * Migration guide:
 * OLD:
 *   logger: { transport: createSentryTransport() }
 * NEW:
 *   import pino from 'pino';
 *   logger: {
 *     stream: createSentryStream(
 *       pino.multistream([
 *         pino.destination({ dest: 1, sync: false }),
 *       ])
 *     ),
 *   }
 */
export function createSentryTransport(): undefined {
  // Worker transport approach doesn't work with esbuild bundling.
  // Use createSentryStream instead.
  return undefined;
}

/**
 * Manually send a log event to Sentry.
 *
 * Use this function when you want to explicitly send an error or warning
 * to Sentry outside of the automatic logging integration.
 */
export function sendToSentry(
  level: 'error' | 'warn',
  message: string,
  context?: Record<string, unknown>
): void {
  const dsn = process.env[SENTRY_DSN_ENV];
  if (dsn === undefined || dsn === '') {
    return;
  }

  if (level === 'error') {
    const captureContext: Parameters<typeof Sentry.captureException>[1] = {};
    if (context !== undefined) {
      captureContext.extra = context;
    }
    captureContext.level = 'error';
    Sentry.captureException(new Error(message), captureContext);
  } else {
    const captureContext: Parameters<typeof Sentry.captureMessage>[1] = {};
    if (context !== undefined) {
      captureContext.extra = context;
    }
    captureContext.level = 'warning';
    Sentry.captureMessage(message, captureContext);
  }
}
