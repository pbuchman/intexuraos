import pino from 'pino';
import type { Logger } from 'pino';

/* v8 ignore start -- module-init: logger created at module init before tests run @preserve */
export function createLogger(name: string): Logger {
  return pino({
    name: `predev-lifecycle:${name}`,
    level: process.env['LOG_LEVEL'] ?? 'info',
  });
}
/* v8 ignore stop @preserve */

export const logger = createLogger('index');
