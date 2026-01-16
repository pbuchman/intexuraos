/**
 * Tests for useFailedLinearIssues hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFailedLinearIssues } from '../useFailedLinearIssues';
import type { FailedLinearIssue } from '@/types';

// Mock modules
vi.mock('../../context', () => ({
  useAuth: vi.fn(() => ({
    getAccessToken: vi.fn().mockResolvedValue('mock-token'),
  })),
}));

vi.mock('../../services/linearApi', () => ({
  listFailedLinearIssues: vi.fn(),
}));

vi.mock('@intexuraos/common-core/errors.js', () => ({
  getErrorMessage: vi.fn((err, defaultMsg) => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  }),
}));

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
  });

  it('loads issues on mount', async () => {
    const { listFailedLinearIssues } = await import('../../services/linearApi');
    vi.mocked(listFailedLinearIssues).mockResolvedValue(mockIssues);

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
    const { listFailedLinearIssues } = await import('../../services/linearApi');
    vi.mocked(listFailedLinearIssues).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('provides refresh function', async () => {
    const { listFailedLinearIssues } = await import('../../services/linearApi');
    vi.mocked(listFailedLinearIssues).mockResolvedValue(mockIssues);

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual(mockIssues);

    // Mock updated data
    const updatedIssues = [...mockIssues, {
      id: 'issue-3',
      userId: 'user-1',
      actionType: 'create_issue',
      payload: { title: 'Test Issue 3' },
      error: 'Failed to create',
      createdAt: '2024-01-03T00:00:00Z',
      retryCount: 0,
    }];
    vi.mocked(listFailedLinearIssues).mockResolvedValue(updatedIssues);

    // Call refresh
    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toEqual(updatedIssues);
  });

  it('clears error on successful refresh', async () => {
    const { listFailedLinearIssues } = await import('../../services/linearApi');

    // First call fails
    vi.mocked(listFailedLinearIssues).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');

    // Second call succeeds
    vi.mocked(listFailedLinearIssues).mockResolvedValue(mockIssues);

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.issues).toEqual(mockIssues);
  });

  it('uses auth token from context', async () => {
    const { useAuth } = await import('../../context');
    const { listFailedLinearIssues } = await import('../../services/linearApi');

    const mockGetAccessToken = vi.fn().mockResolvedValue('test-token-123');
    vi.mocked(useAuth).mockReturnValue({
      getAccessToken: mockGetAccessToken,
    } as ReturnType<typeof useAuth>);

    vi.mocked(listFailedLinearIssues).mockResolvedValue(mockIssues);

    renderHook(() => useFailedLinearIssues());

    await waitFor(() => {
      expect(mockGetAccessToken).toHaveBeenCalled();
      expect(listFailedLinearIssues).toHaveBeenCalledWith('test-token-123');
    });
  });
});
