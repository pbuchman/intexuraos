/**
 * Logger interface for infrastructure adapters.
 * Matches the pino logger signature for compatibility.
 */

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export const LOGGER_METHODS = ['info', 'warn', 'error', 'debug'] as const;

/**
 * Gets the appropriate log level based on the environment.
 *
 * In tests (NODE_ENV='test'), returns 'silent' to suppress output.
 * Otherwise, respects LOG_LEVEL env var or defaults to 'info'.
 *
 * @returns The log level to use for pino loggers
 *
 * @example
 * ```ts
 * import { getLogLevel } from '@intexuraos/common-core';
 * import pino from 'pino';
 *
 * const logger = pino({ name: 'my-service', level: getLogLevel() });
 * ```
 */
export function getLogLevel(): 'silent' | 'debug' | 'info' | 'warn' | 'error' {
  if (process.env['NODE_ENV'] === 'test') {
    return 'silent';
  }
  const logLevel = process.env['LOG_LEVEL'] as
    | 'silent'
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | undefined;
  return logLevel ?? 'info';
}
