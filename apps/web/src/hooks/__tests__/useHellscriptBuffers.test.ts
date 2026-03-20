/**
 * Tests for useHellscriptBuffers hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHellscriptBuffers } from '../useHellscriptBuffers.js';
import type { HellscriptBufferSummary } from '../../types/index.js';

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockListHellscriptBuffers = vi.fn();

vi.mock('../../services/hellscriptAgentApi.js', () => ({
  listHellscriptBuffers: (...args: unknown[]): unknown => mockListHellscriptBuffers(...args),
}));

const mockBuffer: HellscriptBufferSummary = {
  id: 'buf-123',
  userId: 'user-456',
  title: 'My Thoughts',
  eventCount: 3,
  latestDraftVersionNumber: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('useHellscriptBuffers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  it('fetches buffers on mount', async () => {
    mockListHellscriptBuffers.mockResolvedValue([mockBuffer]);

    const { result } = renderHook(() => useHellscriptBuffers());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListHellscriptBuffers).toHaveBeenCalledWith('test-token');
    expect(result.current.buffers).toHaveLength(1);
    expect(result.current.buffers[0]).toEqual(mockBuffer);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockListHellscriptBuffers.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useHellscriptBuffers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.buffers).toHaveLength(0);
  });

  it('refreshes buffers when refresh is called', async () => {
    mockListHellscriptBuffers.mockResolvedValue([mockBuffer]);

    const { result } = renderHook(() => useHellscriptBuffers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedBuffer = { ...mockBuffer, title: 'Updated' };
    mockListHellscriptBuffers.mockResolvedValue([updatedBuffer]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.buffers[0]?.title).toBe('Updated');
    expect(mockListHellscriptBuffers).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when no buffers exist', async () => {
    mockListHellscriptBuffers.mockResolvedValue([]);

    const { result } = renderHook(() => useHellscriptBuffers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.buffers).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});
