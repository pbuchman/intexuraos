import pino, { type Logger as PinoLogger } from 'pino';
import { serializeError } from '@intexuraos/common-core';

/**
 * Simplified logger interface for dependency injection.
 * Used in polling.ts, main.ts, and tests to avoid pino's full Logger type.
 */
export interface Logger {
  level: string;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

const errorSerializers = {
  error: serializeError,
  err: serializeError,
};

/**
 * Singleton pino logger with full pino.Logger type.
 * Typed as pino.Logger for compatibility with infra-pubsub's BasePubSubPublisher.
 */
/* v8 ignore start -- module-init: logger initialized at module load with env var fallback @preserve */
export const logger: PinoLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  formatters: {
    level: (label: string): { level: string } => ({ level: label }),
  },
  serializers: errorSerializers,
});
/* v8 ignore stop @preserve */
