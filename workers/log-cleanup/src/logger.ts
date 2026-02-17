import pino from 'pino';
import { serializeError } from '@intexuraos/common-core';

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

export const logger: Logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  formatters: {
    level: (label: string): { level: string } => ({ level: label }),
  },
  serializers: errorSerializers,
});
