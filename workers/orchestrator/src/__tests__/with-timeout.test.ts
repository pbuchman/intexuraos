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
});
