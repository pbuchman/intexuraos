/**
 * Tests for initWorker bootstrap.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initWorker } from '../initWorker.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn(
    (cb: (s: { setTag: () => void; setExtras: () => void; setLevel: () => void }) => unknown) =>
      cb({ setTag: () => undefined, setExtras: () => undefined, setLevel: () => undefined })
  ),
}));

const originalEnv = process.env;

describe('initWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['INTEXURAOS_COMMIT_SHA'];
    delete process.env['K_REVISION'];
    delete process.env['INTEXURAOS_SENTRY_DSN'];
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns { logger, flush } with a Pino-like logger', () => {
    const result = initWorker({
      serviceName: 'svc',
      environment: 'development',
    });

    expect(result.logger).toBeDefined();
    expect(typeof result.logger.info).toBe('function');
    expect(typeof result.logger.error).toBe('function');
    expect(typeof result.flush).toBe('function');
  });

  it('does not call Sentry.init when sentryDsn is undefined', () => {
    initWorker({
      serviceName: 'svc',
      environment: 'development',
    });

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not call Sentry.init when sentryDsn is empty string', () => {
    initWorker({
      serviceName: 'svc',
      environment: 'development',
      sentryDsn: '',
    });

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init with a safe Cloud Run release from K_REVISION when DSN provided', () => {
    process.env['K_REVISION'] = 'intexuraos-transcription-dev-00014-foj';

    initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
    });

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://x@sentry.io/1',
        environment: 'production',
        serverName: 'svc',
        release: 'intexuraos-transcription-dev-00014-foj',
      })
    );
  });

  it('uses the Hetzner commit SHA and prod tracing default', () => {
    process.env['INTEXURAOS_COMMIT_SHA'] = '1234567890abcdef1234567890abcdef12345678';
    process.env['K_REVISION'] = 'svc-00007-rev';

    initWorker({
      serviceName: 'svc',
      environment: 'prod',
      sentryDsn: 'https://x@sentry.io/1',
    });

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        release: '1234567890abcdef1234567890abcdef12345678',
        tracesSampleRate: 0.1,
      })
    );
  });

  it('forwards explicit release over K_REVISION', () => {
    process.env['K_REVISION'] = 'env-rev';

    initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
      release: 'explicit-rev',
    });

    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ release: 'explicit-rev' }));
  });

  it('forwards explicit tracesSampleRate to initSentry', () => {
    initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
      tracesSampleRate: 0.42,
    });

    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0.42 }));
  });

  it('flush() resolves even when Sentry.flush rejects', async () => {
    vi.mocked(Sentry.flush).mockRejectedValueOnce(new Error('boom'));

    const { flush } = initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
    });

    await expect(flush()).resolves.toBeUndefined();
  });

  it('flush() resolves when Sentry.flush succeeds and DSN is set', async () => {
    const { flush } = initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
    });

    await expect(flush()).resolves.toBeUndefined();
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('flush() resolves when no DSN configured (no Sentry.flush attempted)', async () => {
    const { flush } = initWorker({
      serviceName: 'svc',
      environment: 'development',
    });

    await expect(flush()).resolves.toBeUndefined();
  });

  it('flush() works when logger has no flush method', async () => {
    const { logger, flush } = initWorker({
      serviceName: 'svc',
      environment: 'development',
    });

    // Remove the pino flush method to exercise the "no flush" branch
    (logger as unknown as { flush?: unknown }).flush = undefined;

    await expect(flush()).resolves.toBeUndefined();
  });

  it('flush() swallows errors thrown synchronously by logger.flush', async () => {
    const { logger, flush } = initWorker({
      serviceName: 'svc',
      environment: 'development',
    });

    // Force the pino logger.flush to throw
    (logger as unknown as { flush: () => void }).flush = (): void => {
      throw new Error('logger flush boom');
    };

    await expect(flush()).resolves.toBeUndefined();
  });

  it('extraLogStreamTags triggers Sentry.setTag per entry when DSN present', () => {
    initWorker({
      serviceName: 'svc',
      environment: 'production',
      sentryDsn: 'https://x@sentry.io/1',
      extraLogStreamTags: { region: 'us-central1', tier: 'gold' },
    });

    expect(Sentry.setTag).toHaveBeenCalledWith('region', 'us-central1');
    expect(Sentry.setTag).toHaveBeenCalledWith('tier', 'gold');
  });

  it('extraLogStreamTags is a no-op when DSN is not provided', () => {
    initWorker({
      serviceName: 'svc',
      environment: 'development',
      extraLogStreamTags: { region: 'us-central1' },
    });

    expect(Sentry.setTag).not.toHaveBeenCalledWith('region', 'us-central1');
  });
});
