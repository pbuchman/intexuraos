/**
 * Pino transport for sending errors and warnings to Sentry.
 *
 * This transport intercepts Pino log calls at 'warn' and 'error' levels
 * and sends them to Sentry while preserving normal log output.
 *
 * @example
 * ```ts
 * import { createSentryTransport } from '@intexuraos/infra-sentry';
 *
 * const app = Fastify({
 *   logger: {
 *     level: 'info',
 *     transport: createSentryTransport(),
 *   },
 * });
 * ```
 */

import * as Sentry from '@sentry/node';

/**
 * Environment variable name for Sentry DSN.
 */
const SENTRY_DSN_ENV = 'INTEXURAOS_SENTRY_DSN';

/**
 * Shape of a Pino log event.
 */
interface LogEvent {
  msg?: string;
  err?: unknown;
  [key: string]: unknown;
}

/**
 * Create a Pino transport that sends errors and warnings to Sentry.
 *
 * Returns `undefined` if SENTRY_DSN is not set, allowing services to
 * work normally without Sentry configuration.
 *
 * The transport operates at 'warn' level, capturing both 'warn' and 'error' logs.
 */
export function createSentryTransport():
  | { level: string; send: (level: string, logEvent: LogEvent) => void }
  | undefined {
  const dsn = process.env[SENTRY_DSN_ENV];
  if (!dsn) {
    return undefined;
  }

  return {
    level: 'warn',
    send: (level: string, logEvent: LogEvent) => {
      if (level === 'error') {
        // Capture as exception with full context
        const error = logEvent.err instanceof Error
          ? logEvent.err
          : new Error(logEvent.msg ?? 'Unknown error');

        Sentry.captureException(error, {
          level: 'error',
          extra: logEvent,
        });
      } else if (level === 'warn') {
        // Capture as warning message with context
        Sentry.captureMessage(logEvent.msg ?? 'Warning', {
          level: 'warning',
          extra: logEvent,
        });
      }
    },
  };
}
