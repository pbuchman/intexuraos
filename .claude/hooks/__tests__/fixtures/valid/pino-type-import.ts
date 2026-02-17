// Test fixture: Type-only pino import (should pass)
import type { Logger } from 'pino';

export function doSomething(logger: Logger): void {
  logger.info('This is fine');
}
