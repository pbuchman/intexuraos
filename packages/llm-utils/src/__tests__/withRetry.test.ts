import { describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { LLMError } from '@intexuraos/llm-contract';

import { withRetry } from '../withRetry.js';

const success: Result<string, LLMError> = ok('done');

describe('withRetry', () => {
  it('returns success immediately without sleeping', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue(success);

    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep });

    expect(res).toEqual(success);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries RATE_LIMITED then OVERLOADED, succeeds on third attempt', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<Result<string, LLMError>>>()
      .mockResolvedValueOnce(err({ code: 'RATE_LIMITED', message: 'rate limited' }))
      .mockResolvedValueOnce(err({ code: 'OVERLOADED', message: 'overloaded' }))
      .mockResolvedValueOnce(success);

    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep });

    expect(res).toEqual(success);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Exponential backoff: 100ms then 200ms
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it('does NOT retry non-retriable errors', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<Result<string, LLMError>>>()
      .mockResolvedValue(err({ code: 'INVALID_KEY', message: 'bad key' }));

    const res = await withRetry(fn, { maxAttempts: 5, baseDelayMs: 100, sleep });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_KEY');
    }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honors retryAfterMs from the error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<Result<string, LLMError>>>()
      .mockResolvedValueOnce(
        err({ code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 1234 } as LLMError & {
          retryAfterMs: number;
        })
      )
      .mockResolvedValueOnce(success);

    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep });

    expect(res).toEqual(success);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it('gives up after maxAttempts and returns the last retriable error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<Result<string, LLMError>>>()
      .mockResolvedValueOnce(err({ code: 'TIMEOUT', message: 'timeout 1' }))
      .mockResolvedValueOnce(err({ code: 'TIMEOUT', message: 'timeout 2' }))
      .mockResolvedValueOnce(err({ code: 'TIMEOUT', message: 'timeout 3' }));

    const res = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 50, sleep });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('TIMEOUT');
      expect(res.error.message).toBe('timeout 3');
    }
    expect(fn).toHaveBeenCalledTimes(3);
    // Sleeps only between attempts (after attempt 1 and 2, not after final attempt)
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('caps exponential backoff at maxDelayMs', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn<() => Promise<Result<string, LLMError>>>()
      .mockResolvedValueOnce(err({ code: 'RATE_LIMITED', message: 'r1' }))
      .mockResolvedValueOnce(err({ code: 'RATE_LIMITED', message: 'r2' }))
      .mockResolvedValueOnce(err({ code: 'RATE_LIMITED', message: 'r3' }))
      .mockResolvedValueOnce(success);

    const res = await withRetry(fn, {
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 1500,
      sleep,
    });

    expect(res).toEqual(success);
    // attempt 1 -> 1000ms, attempt 2 -> capped 1500ms, attempt 3 -> capped 1500ms
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1500);
    expect(sleep).toHaveBeenNthCalledWith(3, 1500);
  });

  it('uses default sleeper when none is provided', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn<() => Promise<Result<string, LLMError>>>()
        .mockResolvedValueOnce(err({ code: 'RATE_LIMITED', message: 'r1' }))
        .mockResolvedValueOnce(success);

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 });
      await vi.runAllTimersAsync();
      const res = await promise;

      expect(res).toEqual(success);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
