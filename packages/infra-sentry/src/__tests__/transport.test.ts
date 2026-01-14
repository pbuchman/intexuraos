/**
 * Tests for Sentry transport and sendToSentry function.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { createSentryTransport, sendToSentry } from '../transport.js';

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

  it('returns undefined (placeholder for future transport implementation)', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const transport = createSentryTransport();

    // Currently returns undefined as a placeholder
    expect(transport).toBeUndefined();
  });
});

describe('sendToSentry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does nothing when SENTRY_DSN is not set', () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    sendToSentry('error', 'Test error', { userId: 'user-123' });

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends error to Sentry.captureException', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const context = { userId: 'user-123' };

    sendToSentry('error', 'Test error', context);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'error',
        extra: context,
      })
    );
  });

  it('creates Error with correct message', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    sendToSentry('error', 'Test error without context');

    const capturedError = vi.mocked(Sentry.captureException).mock.calls[0]?.[0];
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe('Test error without context');
  });

  it('sends warning to Sentry.captureMessage', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const context = { userId: 'user-123' };

    sendToSentry('warn', 'Test warning', context);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Test warning',
      expect.objectContaining({
        level: 'warning',
        extra: context,
      })
    );
  });

  it('handles undefined context gracefully', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    sendToSentry('error', 'Test error');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'error',
      })
    );
  });
});
