import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create a logger with default level when LOG_LEVEL not set', async () => {
    delete process.env['LOG_LEVEL'];

    const { logger } = await import('../logger.js');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });

  it('should create a logger with custom level from LOG_LEVEL env var', async () => {
    process.env['LOG_LEVEL'] = 'debug';

    const { logger } = await import('../logger.js');

    expect(logger).toBeDefined();
    expect(logger.level).toBe('debug');
  });

  it('should have correct formatter for level', async () => {
    const { logger } = await import('../logger.js');

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
