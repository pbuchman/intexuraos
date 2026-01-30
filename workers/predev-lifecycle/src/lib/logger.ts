import pino, { Logger } from 'pino';

export function createLogger(name: string): Logger {
  return pino({
    name: `predev-lifecycle:${name}`,
    level: process.env['LOG_LEVEL'] ?? 'info',
  });
}

export const logger = createLogger('index');
