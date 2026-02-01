/**
 * Application logger factory with Sentry integration.
 *
 * Use this to create loggers in apps/ code instead of pino() directly.
 * Ensures all error/warn/fatal logs are sent to Sentry.
 *
 * @example
 * ```ts
 * import { createAppLogger } from '@intexuraos/infra-sentry';
 *
 * const logger = createAppLogger({ name: 'my-service' });
 * logger.info({ foo: 'bar' }, 'Something happened');
 * logger.error({ err }, 'Something went wrong'); // Sent to Sentry!
 * ```
 */

import pino, { type Logger } from 'pino';
import { getLogLevel, serializeError } from '@intexuraos/common-core';
import { createSentryStream, isSentryConfigured } from './transport.js';

/**
 * Pino serializers for automatic error serialization.
 * Ensures Error objects are properly serialized (message, stack, code, etc.)
 * regardless of how they're logged.
 */
const errorSerializers = {
  error: serializeError,
  err: serializeError,
};

export interface AppLoggerConfig {
  /**
   * Logger name (typically service or component name).
   */
  name: string;

  /**
   * Optional log level override. Defaults to getLogLevel() which respects
   * NODE_ENV and LOG_LEVEL env vars.
   */
  level?: 'silent' | 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Create a Sentry-enabled logger for use in apps/.
 *
 * Behavior:
 * - NODE_ENV=test: Returns silent logger (no output)
 * - No SENTRY_DSN: Returns plain pino (stdout only)
 * - SENTRY_DSN set: Returns Sentry-streaming logger (stdout + Sentry)
 *
 * @param config - Logger configuration
 * @returns Pino logger instance
 */
export function createAppLogger(config: AppLoggerConfig): Logger {
  const level = config.level ?? getLogLevel();

  if (process.env['NODE_ENV'] === 'test') {
    return pino({ name: config.name, level: 'silent', serializers: errorSerializers });
  }

  if (!isSentryConfigured()) {
    return pino({ name: config.name, level, serializers: errorSerializers });
  }

  return pino(
    { name: config.name, level, serializers: errorSerializers },
    createSentryStream(pino.multistream([pino.destination({ dest: 1, sync: false })]))
  );
}
