/**
 * Tests for useWorkersStatus hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkersStatus } from '../useCodeTasks.js';
import type { WorkersStatusResponse } from '../../types/index.js';

const mockGetAccessToken = vi.fn();
const mockIsAuthenticated = true;
const mockUser = { sub: 'user-123' };

vi.mock('../../context/index.js', () => ({
  useAuth: (): {
    getAccessToken: typeof mockGetAccessToken;
    isAuthenticated: boolean;
    user: typeof mockUser;
  } => ({
    getAccessToken: mockGetAccessToken,
    isAuthenticated: mockIsAuthenticated,
    user: mockUser,
  }),
}));

const mockGetWorkersStatus = vi.fn();

vi.mock('../../services/codeAgentApi.js', () => ({
  getWorkersStatus: (...args: unknown[]): unknown => mockGetWorkersStatus(...args),
}));

describe('useWorkersStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockStatus: WorkersStatusResponse = {
    workers: [
      { name: 'mac-worker', url: 'https://mac.example.com', priority: 1, healthy: true, checkedAt: '2024-01-01T00:00:00Z' },
      { name: 'vm-worker', url: 'https://vm.example.com', priority: 2, healthy: false, checkedAt: '2024-01-01T00:00:00Z' },
    ],
  };

  it('fetches worker status on mount', async () => {
    mockGetWorkersStatus.mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useWorkersStatus());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetWorkersStatus).toHaveBeenCalledWith('test-token');
    expect(result.current.status).toEqual(mockStatus);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockGetWorkersStatus.mockRejectedValue(new Error('Status unavailable'));

    const { result } = renderHook(() => useWorkersStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Status unavailable');
    expect(result.current.status).toBeNull();
  });

  it('refreshes status', async () => {
    mockGetWorkersStatus.mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useWorkersStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockGetWorkersStatus.mockClear();
    const updatedStatus: WorkersStatusResponse = {
      workers: [
        { name: 'mac-worker', url: 'https://mac.example.com', priority: 1, healthy: true, checkedAt: '2024-01-01T00:00:00Z' },
      ],
    };
    mockGetWorkersStatus.mockResolvedValue(updatedStatus);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGetWorkersStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status?.workers).toHaveLength(1);
  });
});
