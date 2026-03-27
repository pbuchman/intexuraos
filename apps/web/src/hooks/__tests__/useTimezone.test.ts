/**
 * Tests for useTimezone hook.
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimezone } from '../useTimezone.js';

const mockGetUserTimezoneSettings = vi.fn();
const mockPatchUserTimezone = vi.fn();
const mockGetAccessToken = vi.fn();

vi.mock('@/context', () => ({
  useAuth: (): {
    isAuthenticated: boolean;
    user: { sub: string } | undefined;
    getAccessToken: typeof mockGetAccessToken;
  } => mockUseAuth(),
}));

vi.mock('@/services/userTimezoneApi', () => ({
  getUserTimezoneSettings: (...args: unknown[]): unknown => mockGetUserTimezoneSettings(...args),
  patchUserTimezone: (...args: unknown[]): unknown => mockPatchUserTimezone(...args),
}));

interface MockAuthResult {
  isAuthenticated: boolean;
  user: { sub: string } | undefined;
  getAccessToken: typeof mockGetAccessToken;
}

let mockUseAuth: () => MockAuthResult;

describe('useTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: true,
      user: { sub: 'user-123' },
      getAccessToken: mockGetAccessToken,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads timezone on mount', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: 'Europe/Berlin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const { result } = renderHook(() => useTimezone());

    await waitFor(() => {
      expect(result.current.timezone).toBe('Europe/Berlin');
    });

    expect(result.current.error).toBeNull();
    expect(mockGetUserTimezoneSettings).toHaveBeenCalledWith('test-token', 'user-123');
  });

  it('returns null timezone when none is stored', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: undefined,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const { result } = renderHook(() => useTimezone());

    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
    });

    expect(result.current.timezone).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    mockGetUserTimezoneSettings.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useTimezone());

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });

    expect(result.current.timezone).toBeNull();
  });

  it('does not fetch when not authenticated', () => {
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: false,
      user: undefined,
      getAccessToken: mockGetAccessToken,
    });

    const { result } = renderHook(() => useTimezone());

    expect(result.current.timezone).toBeNull();
    expect(mockGetUserTimezoneSettings).not.toHaveBeenCalled();
  });

  it('updateTimezone PATCHes and updates local state', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: 'Europe/Berlin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockPatchUserTimezone.mockResolvedValue({ timezone: 'America/New_York' });

    const { result } = renderHook(() => useTimezone());

    await waitFor(() => {
      expect(result.current.timezone).toBe('Europe/Berlin');
    });

    await act(async () => {
      await result.current.updateTimezone('America/New_York');
    });

    expect(result.current.timezone).toBe('America/New_York');
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockPatchUserTimezone).toHaveBeenCalledWith('test-token', 'user-123', 'America/New_York');
  });

  it('updateTimezone sets error and rethrows on failure', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: 'Europe/Berlin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockPatchUserTimezone.mockRejectedValue(new Error('Save failed'));

    const { result } = renderHook(() => useTimezone());

    await waitFor(() => {
      expect(result.current.timezone).toBe('Europe/Berlin');
    });

    let thrownError: unknown;
    await act(async () => {
      try {
        await result.current.updateTimezone('America/New_York');
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('Save failed');
    expect(result.current.error).toBe('Save failed');
    expect(result.current.timezone).toBe('Europe/Berlin'); // unchanged
    expect(result.current.saving).toBe(false);
  });
});
