import pino from 'pino';
import type { Logger } from 'pino';
import { serializeError } from './serializeError.js';

const errorSerializers = { error: serializeError, err: serializeError };

/* v8 ignore start -- module-init: logger created at module init before tests run @preserve */
export function createLogger(name: string): Logger {
  return pino({
    name: `predev-lifecycle:${name}`,
    level: process.env['LOG_LEVEL'] ?? 'info',
    serializers: errorSerializers,
  });
}
/* v8 ignore stop @preserve */

export const logger = createLogger('index');
