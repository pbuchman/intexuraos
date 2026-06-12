import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../with-timeout.js';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the value when promise resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 5000, 'test timeout');
    expect(result).toBe('ok');
  });

  it('rejects with timeout message when promise takes too long', async () => {
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentionally never resolves
    const neverResolves = new Promise<string>(() => {});
    const promise = withTimeout(neverResolves, 5000, 'test timeout');
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow('test timeout');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('propagates rejection from the original promise', async () => {
    const failing = Promise.reject(new Error('original error'));
    await expect(withTimeout(failing, 5000, 'test timeout')).rejects.toThrow('original error');
  });

  it('clears the timer on success to prevent leaks', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 5000, 'test timeout');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('clears the timer on rejection to prevent leaks', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await expect(
      withTimeout(Promise.reject(new Error('fail')), 5000, 'test timeout')
    ).rejects.toThrow('fail');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  describe('abortSignal (INT-1551 §E.7)', () => {
    it('rejects early when an already-aborted signal is supplied', async () => {
      const controller = new AbortController();
      controller.abort();
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentionally never resolves
      const neverResolves = new Promise<string>(() => {});
      await expect(
        withTimeout(neverResolves, 60_000, 'test timeout', controller.signal)
      ).rejects.toThrow(/aborted by shutdown signal/);
    });

    it('rejects when the signal aborts mid-flight', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- intentionally never resolves
      const neverResolves = new Promise<string>(() => {});
      const promise = withTimeout(neverResolves, 60_000, 'test timeout', controller.signal);
      const assertion = expect(promise).rejects.toThrow(/aborted by shutdown signal/);
      controller.abort();
      await assertion;
    });

    it('still resolves normally when the signal never aborts', async () => {
      const controller = new AbortController();
      const result = await withTimeout(
        Promise.resolve('ok'),
        5000,
        'test timeout',
        controller.signal
      );
      expect(result).toBe('ok');
    });

    it('removes the abort listener on success to avoid leaks', async () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
      await withTimeout(Promise.resolve('ok'), 5000, 'test timeout', controller.signal);
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
      removeSpy.mockRestore();
    });
  });
});
