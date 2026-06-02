/**
 * Tests for createLogStream - unified log stream factory.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createLogStream } from '../logStream.js';

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
});
