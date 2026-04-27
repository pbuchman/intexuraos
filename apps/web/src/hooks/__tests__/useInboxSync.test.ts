/**
 * Tests for useInboxSync hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useInboxSync } from '../useInboxSync.js';

describe('useInboxSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls poll on mount and exposes data', async () => {
    const poll = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useInboxSync({ poll }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ value: 1 });
    expect(result.current.error).toBeNull();
  });

  it('records error when poll fails', async () => {
    const poll = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useInboxSync({ poll }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('long-polls at the configured interval', async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValue({ value: 1 });
    renderHook(() => useInboxSync({ poll, intervalMs: 1000 }));

    // Allow the initial poll to flush.
    await act(async () => {
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('stops polling after unmount and cancels in-flight via AbortController', async () => {
    vi.useFakeTimers();
    const seenSignals: AbortSignal[] = [];
    // Poll never resolves so the request stays in-flight until we abort it.
    const poll = vi.fn().mockImplementation((signal: AbortSignal) => {
      seenSignals.push(signal);
      return new Promise<{ value: number }>(() => {
        // never resolves
      });
    });
    const { unmount } = renderHook(() => useInboxSync({ poll, intervalMs: 500 }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(seenSignals[0]?.aborted).toBe(false);

    unmount();
    // The signal of the in-flight request must be aborted on unmount.
    expect(seenSignals[0]?.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('refresh() triggers an immediate re-poll', async () => {
    const poll = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useInboxSync({ poll, intervalMs: 60_000 }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(poll).toHaveBeenCalledTimes(2);
    });
  });
});
