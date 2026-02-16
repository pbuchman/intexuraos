/**
 * Tests for createLogStream - unified log stream factory.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createLogStream } from '../logStream.js';
import { _resetOtelTransport } from '../otelTransport.js';

vi.mock('../otelTransport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../otelTransport.js')>();
  return {
    ...actual,
    getOtelTransport: vi.fn(() => undefined),
  };
});

import { getOtelTransport } from '../otelTransport.js';

const originalEnv = process.env;

describe('createLogStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a writable stream in development mode', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const stream = createLogStream();

    expect(stream).toBeDefined();
    expect(typeof (stream as { write?: unknown }).write).toBe('function');
  });

  it('returns a writable stream in production mode', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const stream = createLogStream();

    expect(stream).toBeDefined();
    expect(typeof (stream as { write?: unknown }).write).toBe('function');
  });

  it('returns a writable stream when SENTRY_DSN is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const stream = createLogStream();

    expect(stream).toBeDefined();
    expect(typeof (stream as { write?: unknown }).write).toBe('function');
  });

  it('returns a writable stream with Sentry in development', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['INTEXURAOS_SENTRY_DSN'] = 'https://test@sentry.io/123';

    const stream = createLogStream();

    expect(stream).toBeDefined();
    expect(typeof (stream as { write?: unknown }).write).toBe('function');
  });

  it('stream can accept writes without throwing', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const stream = createLogStream();

    const testLog = JSON.stringify({ level: 30, time: Date.now(), msg: 'test', name: 'svc' });
    expect(() => (stream as { write: (s: string) => void }).write(testLog)).not.toThrow();
  });

  it('includes OTel transport when configured', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['INTEXURAOS_SENTRY_DSN'];

    const mockOtelStream = new Writable({
      write(_chunk: Buffer, _encoding: string, callback: () => void): void {
        callback();
      },
    }) as unknown as NodeJS.WritableStream;
    vi.mocked(getOtelTransport).mockReturnValue(mockOtelStream);

    const stream = createLogStream();

    expect(stream).toBeDefined();
    expect(typeof (stream as { write?: unknown }).write).toBe('function');
    const testLog = JSON.stringify({ level: 30, time: Date.now(), msg: 'otel-test', name: 'svc' });
    expect(() => (stream as { write: (s: string) => void }).write(testLog)).not.toThrow();
  });
});
