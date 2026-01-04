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
