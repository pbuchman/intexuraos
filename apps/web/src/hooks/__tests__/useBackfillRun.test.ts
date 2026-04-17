/**
 * Tests for useBackfillRun hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { BackfillRun } from '@/types/notificationDigests';

const { mockGetAccessToken, mockGetBackfillRun } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetBackfillRun: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({ getAccessToken: mockGetAccessToken }),
}));

vi.mock('@/services/notificationDigestsApi', () => ({
  getBackfillRun: mockGetBackfillRun,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  },
}));

import { useBackfillRun, BACKFILL_POLL_INTERVAL_MS } from '../useBackfillRun.js';

function run(status: BackfillRun['status'], currentDate: string | null = '2026-04-01'): BackfillRun {
  return {
    runId: 'bf_1', userId: 'u', groupKey: 'g',
    fromDate: '2026-04-01', toDate: '2026-04-03', status,
    totalDates: 3, completedDates: [], failedDates: [], currentDate,
    startedAt: '2026-04-15T00:00:00Z', updatedAt: '2026-04-15T00:00:00Z',
  };
}

describe('useBackfillRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  it('loads run on mount', async () => {
    mockGetBackfillRun.mockResolvedValue(run('completed'));
    const { result } = renderHook(() => useBackfillRun('bf_1'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.run?.runId).toBe('bf_1');
    expect(result.current.run?.status).toBe('completed');
  });

  it('does nothing when runId is undefined', async () => {
    const { result } = renderHook(() => useBackfillRun(undefined));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(mockGetBackfillRun).not.toHaveBeenCalled();
    expect(result.current.run).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    mockGetBackfillRun.mockRejectedValue(new Error('fetch failed'));
    const { result } = renderHook(() => useBackfillRun('bf_1'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe('fetch failed');
  });

  it('polls while status is running and stops on completed', async () => {
    mockGetBackfillRun.mockResolvedValueOnce(run('running'));
    mockGetBackfillRun.mockResolvedValueOnce(run('running'));
    mockGetBackfillRun.mockResolvedValue(run('completed'));
    const { result } = renderHook(() => useBackfillRun('bf_1'));

    await waitFor(() => { expect(result.current.run?.status).toBe('running'); });

    // Poll interval is 2s; wait up to ~3 intervals for a completed result
    await waitFor(
      () => { expect(result.current.run?.status).toBe('completed'); },
      { timeout: BACKFILL_POLL_INTERVAL_MS * 4 },
    );

    const callsWhenCompleted = mockGetBackfillRun.mock.calls.length;
    // After reaching terminal, further polls should not happen.
    await new Promise<void>((resolve) => { setTimeout(resolve, BACKFILL_POLL_INTERVAL_MS + 100); });
    expect(mockGetBackfillRun.mock.calls.length).toBe(callsWhenCompleted);
  }, 15000);
});
