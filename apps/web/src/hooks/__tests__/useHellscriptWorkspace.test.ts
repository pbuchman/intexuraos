/**
 * Tests for useHellscriptWorkspace hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHellscriptWorkspace } from '../useHellscriptWorkspace.js';
import type { HellscriptWorkspaceResponse, HellscriptImposeResponse } from '../../types/index.js';

const mockGetAccessToken = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: (): typeof mockNavigate => mockNavigate,
  };
});

const mockGetHellscriptWorkspace = vi.fn();
const mockImposeOnBuffer = vi.fn();

vi.mock('../../services/hellscriptAgentApi.js', () => ({
  getHellscriptWorkspace: (...args: unknown[]): unknown => mockGetHellscriptWorkspace(...args),
  imposeOnBuffer: (...args: unknown[]): unknown => mockImposeOnBuffer(...args),
}));

const mockWorkspace: HellscriptWorkspaceResponse = {
  buffer: {
    id: 'buf-123',
    userId: 'user-456',
    title: 'My Thoughts',
    eventCount: 1,
    latestDraftVersionNumber: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  events: [
    {
      id: 'evt-1',
      bufferId: 'buf-123',
      rawUtterance: 'First thought',
      intent: { kind: 'append_thought', payload: {} },
      createdAt: '2024-01-01T00:00:00Z',
    },
  ],
  draftVersions: [],
  state: null,
};

describe('useHellscriptWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  it('fetches workspace when bufferId is provided', async () => {
    mockGetHellscriptWorkspace.mockResolvedValue(mockWorkspace);

    const { result } = renderHook(() => useHellscriptWorkspace('buf-123'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetHellscriptWorkspace).toHaveBeenCalledWith('test-token', 'buf-123');
    expect(result.current.workspace).toEqual(mockWorkspace);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when bufferId is undefined (new conversation)', async () => {
    const { result } = renderHook(() => useHellscriptWorkspace(undefined));

    expect(result.current.loading).toBe(false);
    expect(result.current.workspace).toBeNull();
    expect(mockGetHellscriptWorkspace).not.toHaveBeenCalled();
  });

  it('handles workspace fetch error', async () => {
    mockGetHellscriptWorkspace.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useHellscriptWorkspace('buf-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Not found');
    expect(result.current.workspace).toBeNull();
  });

  it('impose on existing buffer re-fetches workspace', async () => {
    mockGetHellscriptWorkspace.mockResolvedValue(mockWorkspace);

    const { result } = renderHook(() => useHellscriptWorkspace('buf-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const imposeResponse: HellscriptImposeResponse = {
      bufferId: 'buf-123',
      action: 'append_thought',
    };
    mockImposeOnBuffer.mockResolvedValue(imposeResponse);

    const updatedWorkspace = {
      ...mockWorkspace,
      events: [
        ...mockWorkspace.events,
        {
          id: 'evt-2',
          bufferId: 'buf-123',
          rawUtterance: 'Second thought',
          intent: { kind: 'append_thought' as const, payload: {} },
          createdAt: '2024-01-01T01:00:00Z',
        },
      ],
    };
    mockGetHellscriptWorkspace.mockResolvedValue(updatedWorkspace);

    await act(async () => {
      await result.current.impose('Second thought');
    });

    expect(mockImposeOnBuffer).toHaveBeenCalledWith('test-token', {
      bufferId: 'buf-123',
      utterance: 'Second thought',
    });
    // workspace should have been re-fetched (2 fetches total: mount + after impose)
    expect(mockGetHellscriptWorkspace).toHaveBeenCalledTimes(2);
    expect(result.current.imposing).toBe(false);
  });

  it('impose on new conversation navigates to created buffer', async () => {
    const imposeResponse: HellscriptImposeResponse = {
      bufferId: 'buf-new',
      action: 'append_thought',
    };
    mockImposeOnBuffer.mockResolvedValue(imposeResponse);

    const { result } = renderHook(() => useHellscriptWorkspace(undefined));

    await act(async () => {
      await result.current.impose('First thought');
    });

    expect(mockImposeOnBuffer).toHaveBeenCalledWith('test-token', {
      bufferId: undefined,
      utterance: 'First thought',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/hellscript/buf-new', { replace: true });
    expect(result.current.imposing).toBe(false);
  });

  it('handles impose error', async () => {
    mockGetHellscriptWorkspace.mockResolvedValue(mockWorkspace);

    const { result } = renderHook(() => useHellscriptWorkspace('buf-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockImposeOnBuffer.mockRejectedValue(new Error('Server error'));

    await act(async () => {
      await result.current.impose('Bad thought');
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.imposing).toBe(false);
  });
});
