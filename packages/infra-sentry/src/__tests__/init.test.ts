/**
 * Tests for Sentry initialization.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry, type SentryConfig } from '../init.js';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback) => callback({ setTag: vi.fn(), setContext: vi.fn() })),
}));

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type BeforeSendHook = NonNullable<NonNullable<SentryInitOptions>['beforeSend']>;

function getInitOptions(): NonNullable<SentryInitOptions> {
  const calls = vi.mocked(Sentry.init).mock.calls;
  const last = calls[calls.length - 1];
  if (last === undefined) {
    throw new Error('Sentry.init was not called');
  }
  const opts = last[0];
  if (opts === undefined) {
    throw new Error('Sentry.init called with undefined options');
  }
  return opts;
}

function getBeforeSend(): BeforeSendHook {
  const opts = getInitOptions();
  const hook = opts.beforeSend;
  if (hook === undefined || hook === null) {
    throw new Error('beforeSend was not configured');
  }
  return hook;
}

describe('initSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['INTEXURAOS_RUNTIME'];
    delete process.env['K_REVISION'];
  });

  it('initializes Sentry with valid config', () => {
    const config: SentryConfig = {
      dsn: 'https://test@sentry.io/123',
      environment: 'production',
      serviceName: 'test-service',
      tracesSampleRate: 0.1,
    };

    initSentry(config);

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: config.dsn,
        environment: config.environment,
        serverName: config.serviceName,
        sendDefaultPii: false,
        tracesSampleRate: 0.1,
      })
    );
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

  it('returns early when no DSN provided', () => {
    const config: SentryConfig = {
      serviceName: 'test-service',
    };

    initSentry(config);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('returns early when DSN is empty string', () => {
    const config: SentryConfig = {
      dsn: '',
      serviceName: 'test-service',
    };

    initSentry(config);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('sets runtime tag when INTEXURAOS_RUNTIME is set', () => {
    process.env['INTEXURAOS_RUNTIME'] = 'prod';

    initSentry({
      dsn: 'https://test@sentry.io/123',
      serviceName: 'test-service',
    });

    expect(Sentry.setTag).toHaveBeenCalledWith('runtime', 'prod');
  });

  it('does not set runtime tag when INTEXURAOS_RUNTIME is not set', () => {
    delete process.env['INTEXURAOS_RUNTIME'];

    initSentry({
      dsn: 'https://test@sentry.io/123',
      serviceName: 'test-service',
    });

    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  it('does not set runtime tag when INTEXURAOS_RUNTIME is empty string', () => {
    process.env['INTEXURAOS_RUNTIME'] = '';

    initSentry({
      dsn: 'https://test@sentry.io/123',
      serviceName: 'test-service',
    });

    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  describe('release', () => {
    it('forwards explicit release to Sentry.init', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
        release: 'svc-00007-abc',
      });

      expect(getInitOptions().release).toBe('svc-00007-abc');
    });

    it('falls back to K_REVISION env var when release omitted', () => {
      process.env['K_REVISION'] = 'svc-00042-def';

      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
      });

      expect(getInitOptions().release).toBe('svc-00042-def');
    });

    it('omits release when neither explicit value nor K_REVISION is set', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
      });

      expect(getInitOptions().release).toBeUndefined();
    });

    it('omits release when K_REVISION is empty string', () => {
      process.env['K_REVISION'] = '';

      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
      });

      expect(getInitOptions().release).toBeUndefined();
    });
  });

  describe('tracesSampleRate env defaults', () => {
    it('defaults to 0.1 when environment is production', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
        environment: 'production',
      });

      expect(getInitOptions().tracesSampleRate).toBe(0.1);
    });

    it('defaults to 0 when environment is development', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
        environment: 'development',
      });

      expect(getInitOptions().tracesSampleRate).toBe(0);
    });

    it('defaults to 0 when environment is omitted', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
      });

      expect(getInitOptions().tracesSampleRate).toBe(0);
    });

    it('explicit tracesSampleRate overrides env-aware default', () => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
        environment: 'production',
        tracesSampleRate: 0.5,
      });

      expect(getInitOptions().tracesSampleRate).toBe(0.5);
    });
  });

  describe('beforeSend', () => {
    beforeEach(() => {
      initSentry({
        dsn: 'https://test@sentry.io/123',
        serviceName: 'test-service',
        environment: 'production',
      });
    });

    it('drops events whose response status_code is < 500 (e.g. 404)', () => {
      const beforeSend = getBeforeSend();
      const event = {
        contexts: { response: { status_code: 404 } },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]);

      expect(result).toBeNull();
    });

    it('returns the (redacted) event when status_code is 500', () => {
      const beforeSend = getBeforeSend();
      const event = {
        contexts: { response: { status_code: 500 } },
        extra: { authorization: 'Bearer xyz' },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        contexts: { response: { status_code: 500 } },
        extra: { authorization: '[REDACTED]' },
      });
    });

    it('redacts authorization deep inside event.extra', () => {
      const beforeSend = getBeforeSend();
      const event = {
        extra: {
          headers: { authorization: 'Bearer secret' },
          other: 'kept',
        },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]) as {
        extra: { headers: { authorization: string }; other: string };
      } | null;

      expect(result).not.toBeNull();
      expect(result?.extra.headers.authorization).toBe('[REDACTED]');
      expect(result?.extra.other).toBe('kept');
    });

    it('preserves breadcrumbs entries that have no data', () => {
      const beforeSend = getBeforeSend();
      const event = {
        breadcrumbs: [{ type: 'navigation', message: 'go' }, { data: { token: 'x' } }],
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]) as {
        breadcrumbs: { type?: string; message?: string; data?: { token?: string } }[];
      } | null;

      expect(result).not.toBeNull();
      expect(result?.breadcrumbs[0]).toEqual({ type: 'navigation', message: 'go' });
      expect(result?.breadcrumbs[1]?.data?.token).toBe('[REDACTED]');
    });

    it('redacts password inside event.breadcrumbs[*].data', () => {
      const beforeSend = getBeforeSend();
      const event = {
        breadcrumbs: [{ data: { password: 'p1' } }, { data: { user: 'alice', password: 'p2' } }],
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]) as {
        breadcrumbs: { data: { password: string; user?: string } }[];
      } | null;

      expect(result).not.toBeNull();
      expect(result?.breadcrumbs[0]?.data.password).toBe('[REDACTED]');
      expect(result?.breadcrumbs[1]?.data.password).toBe('[REDACTED]');
      expect(result?.breadcrumbs[1]?.data.user).toBe('alice');
    });

    it('passes through events without contexts/response (no drop)', () => {
      const beforeSend = getBeforeSend();
      const event = {
        extra: { foo: 'bar' },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]);

      expect(result).not.toBeNull();
    });

    it('does not drop when status_code is exactly 500', () => {
      const beforeSend = getBeforeSend();
      const event = {
        contexts: { response: { status_code: 500 } },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]);

      expect(result).not.toBeNull();
    });

    it('does not drop when status_code is missing or non-numeric', () => {
      const beforeSend = getBeforeSend();
      const event = {
        contexts: { response: { status_code: 'oops' } },
      } as unknown as Parameters<BeforeSendHook>[0];

      const result = beforeSend(event, {} as Parameters<BeforeSendHook>[1]);

      expect(result).not.toBeNull();
    });
  });
});
