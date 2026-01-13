/**
 * Pino transport configuration for Sentry error tracking.
 *
 * This provides a stub transport that returns undefined when DSN is not set.
 * The actual Sentry integration happens via the error handler in fastify.ts.
 *
 * @example
 * ```ts
 * import { createSentryTransport, setupSentryErrorHandler } from '@intexuraos/infra-sentry';
 *
 * const app = Fastify({
 *   logger: {
 *     level: 'info',
 *   },
 * });
 * setupSentryErrorHandler(app);
 * ```
 */

import * as Sentry from '@sentry/node';

/**
 * Environment variable name for Sentry DSN.
 */
const SENTRY_DSN_ENV = 'INTEXURAOS_SENTRY_DSN';

/**
 * Create a Pino transport configuration for Sentry.
 *
 * Returns undefined to indicate no custom transport is needed.
 * The actual Sentry integration happens via setupSentryErrorHandler().
 *
 * @returns undefined (always, for now)
 */
export function createSentryTransport(): undefined {
  // This function is a placeholder for future Pino transport integration
  // For now, Sentry integration happens via the error handler
  return undefined;
}

/**
 * Manually send a log event to Sentry.
 *
 * Use this function when you want to explicitly send an error or warning
 * to Sentry outside of the automatic error handler.
 *
 * @param level - Log level ('error' or 'warn')
 * @param message - Error or warning message
 * @param context - Additional context to include with the event
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
