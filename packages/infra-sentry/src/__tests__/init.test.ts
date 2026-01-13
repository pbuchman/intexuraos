/**
 * Tests for Sentry initialization.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry, type SentryConfig } from '../init.js';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback) => callback({ setTag: vi.fn(), setContext: vi.fn() })),
}));

describe('initSentry', () => {
  const originalConsoleWarn = console.warn;
  const consoleWarnSpy = vi.fn();

  beforeEach(() => {
    console.warn = consoleWarnSpy;
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it('initializes Sentry with valid config', () => {
    const config: SentryConfig = {
      dsn: 'https://test@sentry.io/123',
      environment: 'production',
      serviceName: 'test-service',
      tracesSampleRate: 0.1,
    };

    initSentry(config);

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: config.dsn,
      environment: config.environment,
      serverName: config.serviceName,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });
  });

  it('uses default tracesSampleRate of 0 when not provided', () => {
    const config: SentryConfig = {
      dsn: 'https://test@sentry.io/123',
      serviceName: 'test-service',
    };

    initSentry(config);

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        tracesSampleRate: 0,
        serverName: 'test-service',
      })
    );
  });

  it('logs warning and returns early when no DSN provided', () => {
    const config: SentryConfig = {
      dsn: undefined,
      serviceName: 'test-service',
    };

    initSentry(config);

    expect(consoleWarnSpy).toHaveBeenCalledWith('[Sentry] No DSN provided, skipping initialization');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('logs warning and returns early when DSN is empty string', () => {
    const config: SentryConfig = {
      dsn: '',
      serviceName: 'test-service',
    };

    initSentry(config);

    expect(consoleWarnSpy).toHaveBeenCalledWith('[Sentry] No DSN provided, skipping initialization');
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});
