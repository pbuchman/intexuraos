/**
 * Tests for useDigestView hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { GroupState, PersistedDailySummary, RunDigestResponse } from '@/types/notificationDigests';

const { mockGetAccessToken, mockGetDigest, mockGetDigestState, mockRunDigest } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetDigest: vi.fn(),
  mockGetDigestState: vi.fn(),
  mockRunDigest: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({ getAccessToken: mockGetAccessToken }),
}));

vi.mock('@/services/notificationDigestsApi', () => ({
  getDigest: mockGetDigest,
  getDigestState: mockGetDigestState,
  runDigest: mockRunDigest,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  },
}));

import { useDigestView } from '../useDigestView.js';
import { ApiError } from '@/services/apiClient';

const DIGEST: PersistedDailySummary = {
  summary: {
    date: '2026-04-15', groupKey: 'g', messageCount: 0, narrative: '',
    threads: [], moderatorPosts: [], openQuestions: [], activityOutliers: [],
  },
  generation: 1, generatedAt: '2026-04-15T12:00:00Z', modelId: 'm',
};

const STATE: GroupState = {
  userId: 'u', groupKey: 'g', updatedAt: '',
  identityLedger: [], moderatorEvents: [], openThreads: [], recentSummaryDates: [],
};

describe('useDigestView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  it('loads digest and state on mount', async () => {
    mockGetDigest.mockResolvedValue(DIGEST);
    mockGetDigestState.mockResolvedValue(STATE);

    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.digest).toBe(DIGEST);
    expect(result.current.state).toBe(STATE);
    expect(result.current.error).toBeNull();
  });

  it('keeps digest null on 404 without setting error', async () => {
    mockGetDigest.mockRejectedValue(new ApiError('NOT_FOUND', 'Digest not found', 404));
    mockGetDigestState.mockRejectedValue(new ApiError('NOT_FOUND', 'State not found', 404));
    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.digest).toBeNull();
    expect(result.current.state).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets error on non-404 digest fetch failure', async () => {
    mockGetDigest.mockRejectedValue(new Error('boom'));
    mockGetDigestState.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe('boom');
  });

  it('regenerate calls runDigest and refreshes', async () => {
    mockGetDigest.mockResolvedValue(DIGEST);
    mockGetDigestState.mockResolvedValue(STATE);
    const runResp: RunDigestResponse = {
      summaryDocId: 'u_g_2026-04-15', generation: 2, messageCount: 10,
      modelId: 'm', regenerated: true,
    };
    mockRunDigest.mockResolvedValue(runResp);

    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => { await result.current.regenerate(); });

    expect(mockRunDigest).toHaveBeenCalledWith('tok', { groupKey: 'g', date: '2026-04-15' });
    expect(result.current.lastRegenerateResult).toBe(runResp);
    // Refresh triggers after regenerate: getDigest called twice (mount + post-regen)
    expect(mockGetDigest).toHaveBeenCalledTimes(2);
  });

  it('skips refresh when regenerate returns lockSkipped=true', async () => {
    mockGetDigest.mockResolvedValue(DIGEST);
    mockGetDigestState.mockResolvedValue(STATE);
    mockRunDigest.mockResolvedValue({
      summaryDocId: '', generation: 0, messageCount: 0,
      modelId: 'm', regenerated: false, lockSkipped: true,
    });

    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => { await result.current.regenerate(); });

    expect(mockGetDigest).toHaveBeenCalledTimes(1); // No refresh
    expect(result.current.lastRegenerateResult?.lockSkipped).toBe(true);
  });

  it('sets regenerateError when runDigest throws', async () => {
    mockGetDigest.mockResolvedValue(DIGEST);
    mockGetDigestState.mockResolvedValue(STATE);
    mockRunDigest.mockRejectedValue(new Error('regen failed'));

    const { result } = renderHook(() => useDigestView('g', '2026-04-15'));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => { await result.current.regenerate(); });

    expect(result.current.regenerateError).toBe('regen failed');
  });
});
