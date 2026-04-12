/**
 * Tests for usePruneCandidateStatus hook.
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetAccessToken, mockIsAuthenticated, mockListPruneCandidates } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockIsAuthenticated: { value: true },
  mockListPruneCandidates: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken; isAuthenticated: boolean } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated.value,
  }),
}));

vi.mock('@/services/linearApi', () => ({
  listPruneCandidates: mockListPruneCandidates,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  },
}));

import { usePruneCandidateStatus } from '../usePruneCandidateStatus.js';

describe('usePruneCandidateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.value = true;
    mockGetAccessToken.mockResolvedValue('test-token');
    mockListPruneCandidates.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches candidates on mount and sets pendingCount', async () => {
    mockListPruneCandidates.mockResolvedValue([
      { id: '1', identifier: 'INT-1', title: 'Test', score: 80, reason: 'Cancelled', category: 'cancelled', classifiedAt: '2026-01-01' },
    ]);

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pendingCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('sets error when fetch fails', async () => {
    mockListPruneCandidates.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('sets loading false when not authenticated', async () => {
    mockIsAuthenticated.value = false;

    const { result } = renderHook(() => usePruneCandidateStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.pendingCount).toBe(0);
  });

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() => usePruneCandidateStatus());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
