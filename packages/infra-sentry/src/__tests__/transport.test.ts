/**
 * Tests for Sentry stream and transport functions.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  createSentryStream,
  createSentryTransport,
  sendToSentry,
  isSentryConfigured,
} from '../transport.js';

// Mock Sentry - must use factory function to avoid hoisting issues
vi.mock('@sentry/node', () => {
  const mockCaptureException = vi.fn();
  const mockCaptureMessage = vi.fn();
  const mockWithScope = vi.fn((callback: (scope: unknown) => void) => {
    const mockScope = {
      setExtras: vi.fn(),
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
    };
    callback(mockScope);
  });

  return {
    init: vi.fn(),
    captureException: mockCaptureException,
    captureMessage: mockCaptureMessage,
    withScope: mockWithScope,
  };
});

const originalEnv = process.env;

// Get references to the mocked functions after mock is set up
const getMockedSentry = (): {
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
} => ({
  captureException: vi.mocked(Sentry).captureException as ReturnType<typeof vi.fn>,
  captureMessage: vi.mocked(Sentry).captureMessage as ReturnType<typeof vi.fn>,
});

describe('isSentryConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when SENTRY_DSN is not set', () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const result = isSentryConfigured();

    expect(result).toBe(false);
  });

  it('returns false when SENTRY_DSN is empty string', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = '';

    const result = isSentryConfigured();

    expect(result).toBe(false);
  });

  it('returns true when SENTRY_DSN is set', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const result = isSentryConfigured();

    expect(result).toBe(true);
  });
});

describe('createSentryTransport', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined (deprecated, use createSentryStream instead)', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const transport = createSentryTransport();

    expect(transport).toBeUndefined();
  });
});

describe('createSentryStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns multistream unchanged when SENTRY_DSN is not set', () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);

    expect(result).toBe(mockMultistream);
  });

  it('adds Sentry stream to multistream when SENTRY_DSN is set', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);

    // Cast to access internal streams array
    const ms = result as unknown as {
      streams: { level: number; stream: unknown }[];
    };

    // Should have 1 stream: Sentry
    expect(ms.streams).toHaveLength(1);
    expect(ms.streams[0]?.level).toBe(40); // Sentry (warn+)
  });

  it('Sentry stream has write function', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);

    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    expect(typeof ms.streams[0]?.stream.write).toBe('function');

    // Test write function
    const testLog = JSON.stringify({ level: 50, msg: 'Test error', userId: '123' });
    expect(() => ms.streams[0]?.stream.write(testLog)).not.toThrow();
  });
});

describe('sendToSentry', () => {
  beforeEach(() => {
    const { captureException, captureMessage } = getMockedSentry();
    captureException.mockClear();
    captureMessage.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does nothing when SENTRY_DSN is not set', () => {
    delete process.env['INTEXURAOS_SENTRY_DSN'];
    const { captureException } = getMockedSentry();

    sendToSentry('error', 'Test error', { userId: 'user-123' });

    expect(captureException).not.toHaveBeenCalled();
  });

  it('sends error to Sentry.captureException', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();
    const context = { userId: 'user-123' };

    sendToSentry('error', 'Test error', context);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'error',
        extra: context,
      })
    );
  });

  it('creates Error with correct message', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    sendToSentry('error', 'Test error without context');

    const capturedError = captureException.mock.calls[0]?.[0] as Error;
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.message).toBe('Test error without context');
  });

  it('sends warning to Sentry.captureMessage', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureMessage } = getMockedSentry();
    const context = { userId: 'user-123' };

    sendToSentry('warn', 'Test warning', context);

    expect(captureMessage).toHaveBeenCalledWith(
      'Test warning',
      expect.objectContaining({
        level: 'warning',
        extra: context,
      })
    );
  });

  it('handles undefined context gracefully', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    sendToSentry('error', 'Test error');

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        level: 'error',
      })
    );
  });
});

describe('createSentryStream - sendLogToSentry internal function', () => {
  beforeEach(() => {
    const { captureException, captureMessage } = getMockedSentry();
    captureException.mockClear();
    captureMessage.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('ignores logs with level below warn (40)', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException, captureMessage } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    // Info log (level 30) should be ignored
    const infoLog = JSON.stringify({ level: 30, msg: 'Info message' });
    ms.streams[0]?.stream.write(infoLog);

    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('ignores logs with undefined level', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException, captureMessage } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    // Log without level should be ignored
    const logWithoutLevel = JSON.stringify({ msg: 'Message without level' });
    ms.streams[0]?.stream.write(logWithoutLevel);

    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('captures warn level logs as message', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureMessage } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const warnLog = JSON.stringify({ level: 40, msg: 'Warning message', userId: '123' });
    ms.streams[0]?.stream.write(warnLog);

    expect(captureMessage.mock.calls[0]?.[0]).toBe('Warning message');
  });

  it('handles error logs with err object containing stack and message', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const testStack = 'Error: Test error\n    at test.js:10:15';
    const errorMessage = 'Original error from application';
    const errorLog = JSON.stringify({
      level: 50,
      msg: 'Error occurred',
      err: { stack: testStack, message: errorMessage },
    });

    ms.streams[0]?.stream.write(errorLog);

    const capturedError = captureException.mock.calls[0]?.[0] as Error;
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.stack).toBe(testStack);
    expect(capturedError.message).toBe(errorMessage);
  });

  it('handles error logs with err object containing only stack', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const testStack = 'Error: Stack only\n    at test.js:5:10';
    const errorLog = JSON.stringify({
      level: 50,
      msg: 'Error with stack only',
      err: { stack: testStack },
    });

    ms.streams[0]?.stream.write(errorLog);

    const capturedError = captureException.mock.calls[0]?.[0] as Error;
    expect(capturedError.stack).toBe(testStack);
    // Message should come from msg when err.message is not present
    expect(capturedError.message).toBe('Error with stack only');
  });

  it('handles error logs with err object containing only message', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const errorMessage = 'Error message from err object';
    const errorLog = JSON.stringify({
      level: 50,
      msg: 'Generic error',
      err: { message: errorMessage },
    });

    ms.streams[0]?.stream.write(errorLog);

    const capturedError = captureException.mock.calls[0]?.[0] as Error;
    expect(capturedError.message).toBe(errorMessage);
  });

  it('handles fatal level logs (60)', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const fatalLog = JSON.stringify({ level: 60, msg: 'Fatal error' });
    ms.streams[0]?.stream.write(fatalLog);

    expect(captureException).toHaveBeenCalled();
  });

  it('handles malformed JSON gracefully', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException, captureMessage } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    // Malformed JSON should not throw
    expect(() => ms.streams[0]?.stream.write('not valid json')).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('adds extra context from log entries', () => {
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';
    const { captureException } = getMockedSentry();

    const mockMultistream = { streams: [] } as unknown as ReturnType<
      typeof import('pino').multistream
    >;

    const result = createSentryStream(mockMultistream);
    const ms = result as unknown as {
      streams: { level: number; stream: { write: (data: string) => void } }[];
    };

    const errorLog = JSON.stringify({
      level: 50,
      msg: 'Error with context',
      userId: 'user-123',
      requestId: 'req-456',
    });

    ms.streams[0]?.stream.write(errorLog);

    // The withScope mock should have been called with the extra context
    expect(captureException).toHaveBeenCalled();
  });
});
