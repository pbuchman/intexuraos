import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import {
  registerUsageSink,
  clearUsageSinkRegistry,
  type FlushableUsageSink,
} from '../usageSinkRegistry.js';
import {
  defaultExit,
  installUsageSinkShutdownHandler,
} from '../installUsageSinkShutdownHandler.js';

const makeLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

class FakeSink implements FlushableUsageSink {
  flushSync: () => Promise<void>;

  constructor(behavior: () => Promise<void> = () => Promise.resolve()) {
    this.flushSync = vi.fn(behavior);
  }
}

describe('installUsageSinkShutdownHandler', () => {
  // Track every disposer we register so a failing assertion never leaves
  // listeners attached across tests (which would pile up SIGTERM handlers
  // and break later cases).
  const disposers: (() => void)[] = [];

  beforeEach(() => {
    clearUsageSinkRegistry();
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    clearUsageSinkRegistry();
  });

  function trackedInstall(opts: Parameters<typeof installUsageSinkShutdownHandler>[0]): () => void {
    const dispose = installUsageSinkShutdownHandler(opts);
    disposers.push(dispose);
    return dispose;
  }

  it('on signal: closes app, drains sinks, then exits with code 0', async () => {
    const close = vi.fn(() => Promise.resolve());
    const sink = new FakeSink();
    registerUsageSink(sink);

    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'], // use SIGUSR2 so it doesn't kill the test runner if exit stub fails
      exit,
    });

    process.emit('SIGUSR2' as NodeJS.Signals);

    const code = await exitPromise;
    expect(code).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sink.flushSync).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      (sink.flushSync as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? Infinity
    );
  });

  it('exits with code 1 when app.close() throws', async () => {
    const close = vi.fn(() => Promise.reject(new Error('close failed')));
    const logger = makeLogger();
    const sink = new FakeSink();
    registerUsageSink(sink);

    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit,
      logger,
    });

    process.emit('SIGUSR2' as NodeJS.Signals);

    const code = await exitPromise;
    expect(code).toBe(1);
    // Sinks still drain even when the app-close fails — we want to deliver
    // events buffered by in-flight requests up to the point of failure.
    expect(sink.flushSync).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('close failed') }),
      expect.stringContaining('app.close() failed')
    );
  });

  it('exits cleanly even when a sink rejects (drain failures must not flip exit code)', async () => {
    const close = vi.fn(() => Promise.resolve());
    const sink = new FakeSink(() => Promise.reject(new Error('drain boom')));
    registerUsageSink(sink);

    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit,
      logger: makeLogger(),
    });

    process.emit('SIGUSR2' as NodeJS.Signals);

    const code = await exitPromise;
    expect(code).toBe(0);
  });

  it('returned disposer removes the listeners', () => {
    const close = vi.fn(() => Promise.resolve());
    const before = process.listenerCount('SIGUSR2');

    const dispose = trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit: vi.fn(),
    });

    expect(process.listenerCount('SIGUSR2')).toBe(before + 1);

    dispose();
    expect(process.listenerCount('SIGUSR2')).toBe(before);
  });

  it('defaults to SIGTERM and SIGINT signals when omitted', () => {
    const close = vi.fn(() => Promise.resolve());
    const beforeSigterm = process.listenerCount('SIGTERM');
    const beforeSigint = process.listenerCount('SIGINT');

    // Omit `signals` and `exit` to exercise the `??` default branches.
    const dispose = trackedInstall({
      app: { close },
    });

    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);

    dispose();
  });

  it('forwards flushTimeoutMs and a logger to runShutdown without throwing', async () => {
    const logger = makeLogger();
    const close = vi.fn(() => Promise.resolve());
    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit,
      logger,
      flushTimeoutMs: 250,
    });

    process.emit('SIGUSR2' as NodeJS.Signals);
    await exitPromise;
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('defaultExit calls process.exit with the given code', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    defaultExit(0);
    defaultExit(1);
    expect(exitSpy).toHaveBeenNthCalledWith(1, 0);
    expect(exitSpy).toHaveBeenNthCalledWith(2, 1);
    exitSpy.mockRestore();
  });

  it('handles app.close failure cleanly when no logger is configured', async () => {
    const close = vi.fn(() => Promise.reject(new Error('quiet failure')));

    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit,
      // logger intentionally omitted to exercise the `logger === undefined`
      // branch inside runShutdown's app.close catch.
    });

    process.emit('SIGUSR2' as NodeJS.Signals);
    const code = await exitPromise;
    expect(code).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('logs an app.close failure via the provided logger and still exits 1', async () => {
    const logger = makeLogger();
    const close = vi.fn(() => Promise.reject(new Error('close exploded')));

    let resolveExit: ((code: number) => void) | undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const exit = vi.fn((code: number) => {
      resolveExit?.(code);
    });

    trackedInstall({
      app: { close },
      signals: ['SIGUSR2' as 'SIGTERM'],
      exit,
      logger,
    });

    process.emit('SIGUSR2' as NodeJS.Signals);
    const code = await exitPromise;
    expect(code).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('close exploded') }),
      expect.stringContaining('app.close() failed')
    );
  });
});
