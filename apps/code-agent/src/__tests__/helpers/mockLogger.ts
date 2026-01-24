import { vi } from 'vitest';
import pino from 'pino';

export function createMockLogger(): pino.Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'info',
    isLevelEnabled: () => true,
  } as unknown as pino.Logger;
}
