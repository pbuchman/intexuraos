/**
 * Tests for useFailedLinearIssues hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { FailedLinearIssue } from '@/types';

// Use vi.hoisted to declare mocks before they're hoisted
const { mockGetAccessToken, mockListFailedLinearIssues } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListFailedLinearIssues: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/linearApi', () => ({
  listFailedLinearIssues: mockListFailedLinearIssues,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  },
}));

// Import hook after mocks are set up
import { useFailedLinearIssues } from '../useFailedLinearIssues';

describe('useFailedLinearIssues', () => {
  const mockIssues: FailedLinearIssue[] = [
    {
      id: 'issue-1',
      userId: 'user-1',
      actionType: 'create_issue',
      payload: { title: 'Test Issue 1' },
      error: 'Failed to create',
      createdAt: '2024-01-01T00:00:00Z',
      retryCount: 1,
    },
    {
      id: 'issue-2',
      userId: 'user-1',
      actionType: 'update_issue',
      payload: { title: 'Test Issue 2' },
      error: 'Failed to update',
      createdAt: '2024-01-02T00:00:00Z',
      retryCount: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('mock-token');
  });

  it('loads issues on mount', async () => {
    mockListFailedLinearIssues.mockResolvedValue(mockIssues);

    const { result } = renderHook(() => useFailedLinearIssues());

    expect(result.current.loading).toBe(true);
    expect(result.current.issues).toEqual([]);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual(mockIssues);
    expect(result.current.error).toBeNull();
  });

  it('handles load error', async () => {
    mockListFailedLinearIssues.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('provides refresh function', async () => {
    mockListFailedLinearIssues.mockResolvedValue(mockIssues);

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual(mockIssues);

    // Mock updated data for next call
    const updatedIssues: FailedLinearIssue[] = [...mockIssues, {
      id: 'issue-3',
      userId: 'user-1',
      actionType: 'create_issue',
      payload: { title: 'Test Issue 3' },
      error: 'Failed to create',
      createdAt: '2024-01-03T00:00:00Z',
      retryCount: 0,
    }];
    mockListFailedLinearIssues.mockResolvedValue(updatedIssues);

    // Call refresh
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual(updatedIssues);
  });

  it('clears error on successful refresh', async () => {
    // First call fails
    mockListFailedLinearIssues.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');

    // Second call succeeds
    mockListFailedLinearIssues.mockResolvedValue(mockIssues);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.issues).toEqual(mockIssues);
  });

  it('uses auth token from context', async () => {
    mockGetAccessToken.mockResolvedValue('test-token-123');
    mockListFailedLinearIssues.mockResolvedValue(mockIssues);

    renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(mockGetAccessToken).toHaveBeenCalled();
      expect(mockListFailedLinearIssues).toHaveBeenCalledWith('test-token-123');
    });
  });
});
