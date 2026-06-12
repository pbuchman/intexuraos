/**
 * Tests for createWorkerLogger.
 *
 * The logger wraps pino with a `{ worker: name }` base binding and the shared
 * `serializeError` serializers. We exercise the structural surface of
 * `WorkerLogger` (level, child) plus environment-driven log-level resolution.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../logger.js';

describe('createWorkerLogger', () => {
  const originalLogLevel = process.env['LOG_LEVEL'];

  beforeEach(() => {
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel;
    }
  });

  it('returns a logger with the configured level', () => {
    process.env['LOG_LEVEL'] = 'debug';
    const log = createWorkerLogger('test-worker');
    expect(log.level).toBe('debug');
  });

  it('defaults to info when LOG_LEVEL is not set', () => {
    const log = createWorkerLogger('test-worker');
    expect(log.level).toBe('info');
  });

  it('exposes info/warn/error/debug as functions', () => {
    const log = createWorkerLogger('test-worker');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('supports .child() and returns a WorkerLogger', () => {
    const log = createWorkerLogger('test-worker');
    const child = log.child({ traceId: 'abc' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
    expect(child.level).toBe(log.level);
  });

  it('child() carries forward base bindings AND merges new bindings', () => {
    const lines: string[] = [];
    const parent = createWorkerLogger('test-worker', {
      destination: {
        write(chunk: string): void {
          lines.push(chunk);
        },
      },
    });
    const child = parent.child({ traceId: 'abc' });
    child.info({ foo: 'bar' }, 'hi');
    expect(lines.length).toBe(1);
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    // Base binding survives the child() call …
    expect(record['worker']).toBe('test-worker');
    // … and the child binding is attached …
    expect(record['traceId']).toBe('abc');
    // … and per-call fields still apply.
    expect(record['foo']).toBe('bar');
  });

  it('writes structured records that include the worker binding', () => {
    process.env['LOG_LEVEL'] = 'info';
    const lines: string[] = [];
    const log = createWorkerLogger('test-worker', {
      destination: {
        write(chunk: string): void {
          lines.push(chunk);
        },
      },
    });
    log.info({ foo: 'bar' }, 'hello');
    expect(lines.length).toBe(1);
    const first = lines[0];
    expect(first).toBeDefined();
    const record = JSON.parse(first ?? '{}') as Record<string, unknown>;
    expect(record['worker']).toBe('test-worker');
    expect(record['foo']).toBe('bar');
    expect(record['msg']).toBe('hello');
  });

  it('serializes Error instances under the {error} key via serializeError', () => {
    const lines: string[] = [];
    const log = createWorkerLogger('test-worker', {
      destination: {
        write(chunk: string): void {
          lines.push(chunk);
        },
      },
    });
    const boom = new Error('boom');
    log.error({ error: boom }, 'failed');
    expect(lines.length).toBe(1);
    const first = lines[0];
    expect(first).toBeDefined();
    const record = JSON.parse(first ?? '{}') as { error?: { message?: string; name?: string } };
    expect(record.error).toBeDefined();
    expect(record.error?.message).toBe('boom');
    expect(record.error?.name).toBe('Error');
  });
});
