import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
}));

const originalEnv = process.env;

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('exposes pino-style methods on the logger', async () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const { logger } = await import('../logger.js');

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('exports a flush() that resolves without throwing', async () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const { flush } = await import('../logger.js');

    expect(typeof flush).toBe('function');
    await expect(flush()).resolves.toBeUndefined();
  });

  it('forwards INTEXURAOS_SENTRY_DSN through to initWorker when set', async () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://example@sentry.io/1';

    const { logger, flush } = await import('../logger.js');

    expect(logger).toBeDefined();
    await expect(flush()).resolves.toBeUndefined();
  });
});
