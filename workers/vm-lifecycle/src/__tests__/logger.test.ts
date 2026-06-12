import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface FakeWorkerBootstrapConfig {
  sentryDsn?: string;
  serviceName: string;
  environment: string;
}

const initWorker = vi.fn((_cfg: FakeWorkerBootstrapConfig) => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'silent',
  },
  flush: vi.fn(() => Promise.resolve()),
}));

vi.mock('@intexuraos/infra-sentry', () => ({
  initWorker,
}));

const originalEnv = process.env;

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
    initWorker.mockClear();
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

    await import('../logger.js');

    expect(initWorker).toHaveBeenCalledOnce();
    const config = initWorker.mock.calls[0]?.[0];
    if (config === undefined) throw new Error('initWorker not called');
    expect(config.sentryDsn).toBe('https://example@sentry.io/1');
  });

  it('omits sentryDsn when INTEXURAOS_SENTRY_DSN is unset', async () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    await import('../logger.js');

    expect(initWorker).toHaveBeenCalledOnce();
    const config = initWorker.mock.calls[0]?.[0];
    if (config === undefined) throw new Error('initWorker not called');
    expect(config.sentryDsn).toBeUndefined();
  });

  it('omits sentryDsn when INTEXURAOS_SENTRY_DSN is empty', async () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = '';

    await import('../logger.js');

    expect(initWorker).toHaveBeenCalledOnce();
    const config = initWorker.mock.calls[0]?.[0];
    if (config === undefined) throw new Error('initWorker not called');
    expect(config.sentryDsn).toBeUndefined();
  });

  it('forwards INTEXURAOS_ENVIRONMENT through to initWorker when set', async () => {
    process.env['INTEXURAOS_ENVIRONMENT'] = 'prod';

    await import('../logger.js');

    expect(initWorker).toHaveBeenCalledOnce();
    const config = initWorker.mock.calls[0]?.[0];
    if (config === undefined) throw new Error('initWorker not called');
    expect(config.environment).toBe('prod');
  });

  it('falls back to "development" when INTEXURAOS_ENVIRONMENT is unset', async () => {
    delete process.env['INTEXURAOS_ENVIRONMENT'];

    await import('../logger.js');

    expect(initWorker).toHaveBeenCalledOnce();
    const config = initWorker.mock.calls[0]?.[0];
    if (config === undefined) throw new Error('initWorker not called');
    expect(config.environment).toBe('development');
  });
});
