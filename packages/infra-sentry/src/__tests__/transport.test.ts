/**
 * Tests for Sentry Pino transport.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { createSentryTransport } from '../transport.js';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('createSentryTransport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined when SENTRY_DSN is not set', () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const transport = createSentryTransport();

    expect(transport).toBeUndefined();
  });

  it('returns undefined when SENTRY_DSN is empty string', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = '';

    const transport = createSentryTransport();

    expect(transport).toBeUndefined();
  });

  it('returns transport when SENTRY_DSN is set', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const transport = createSentryTransport();

    expect(transport).toBeDefined();
    expect(transport).toHaveProperty('level', 'warn');
    expect(transport).toHaveProperty('send');
  });

  it('sends error logs to Sentry.captureException', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const transport = createSentryTransport();
    const logEvent = {
      msg: 'Test error',
      err: new Error('Test error'),
      userId: 'user-123',
    };

    transport?.send('error', logEvent);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      logEvent.err,
      expect.objectContaining({
        level: 'error',
        extra: logEvent,
      })
    );
  });

  it('creates Error from msg when err is not an Error', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const transport = createSentryTransport();
    const logEvent = {
      msg: 'Test error without err object',
      userId: 'user-123',
    };

    transport?.send('error', logEvent);

    expect(Sentry.captureException).toHaveBeenCalled();
    const capturedError = vi.mocked(Sentry.captureException).mock.calls[0]?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('Test error without err object');
  });

  it('sends warn logs to Sentry.captureMessage', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const transport = createSentryTransport();
    const logEvent = {
      msg: 'Test warning',
      userId: 'user-123',
    };

    transport?.send('warn', logEvent);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Test warning',
      expect.objectContaining({
        level: 'warning',
        extra: logEvent,
      })
    );
  });

  it('uses default message for warn when msg is not provided', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const transport = createSentryTransport();
    const logEvent = {
      userId: 'user-123',
    };

    transport?.send('warn', logEvent);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Warning',
      expect.objectContaining({
        level: 'warning',
      })
    );
  });

  it('ignores logs below warn level', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const transport = createSentryTransport();

    expect(transport?.level).toBe('warn');
  });
});
