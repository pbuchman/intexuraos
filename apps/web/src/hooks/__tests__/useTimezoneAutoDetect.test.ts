/**
 * Tests for useTimezoneAutoDetect hook.
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimezoneAutoDetect } from '../useTimezoneAutoDetect.js';

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

describe('useTimezoneAutoDetect', () => {
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

  it('PATCHes detected timezone when no timezone is stored', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: undefined,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockPatchUserTimezone.mockResolvedValue({ timezone: 'Europe/Berlin' });

    renderHook(() => useTimezoneAutoDetect());

    await waitFor(() => {
      expect(mockPatchUserTimezone).toHaveBeenCalledOnce();
    });

    expect(mockGetUserTimezoneSettings).toHaveBeenCalledWith('test-token', 'user-123');
    expect(mockPatchUserTimezone).toHaveBeenCalledWith(
      'test-token',
      'user-123',
      expect.any(String) // detected timezone from browser
    );
  });

  it('does not PATCH when timezone is already stored', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: 'America/New_York',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    renderHook(() => useTimezoneAutoDetect());

    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
    });

    expect(mockPatchUserTimezone).not.toHaveBeenCalled();
  });

  it('does not run when user is not authenticated', () => {
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: false,
      user: undefined,
      getAccessToken: mockGetAccessToken,
    });

    renderHook(() => useTimezoneAutoDetect());

    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockGetUserTimezoneSettings).not.toHaveBeenCalled();
  });

  it('does not run when user.sub is undefined', () => {
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: true,
      user: undefined,
      getAccessToken: mockGetAccessToken,
    });

    renderHook(() => useTimezoneAutoDetect());

    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockGetUserTimezoneSettings).not.toHaveBeenCalled();
  });

  it('silently ignores errors without blocking app load', async () => {
    mockGetUserTimezoneSettings.mockRejectedValue(new Error('Network error'));

    // Should not throw
    const { result } = renderHook(() => useTimezoneAutoDetect());

    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
    });

    // Hook returns void, no error surfaced
    expect(result.current).toBeUndefined();
    expect(mockPatchUserTimezone).not.toHaveBeenCalled();
  });

  it('retries after a transient failure when deps change', async () => {
    // First call fails
    mockGetUserTimezoneSettings.mockRejectedValueOnce(new Error('Network error'));
    // Second call succeeds with no timezone stored
    mockGetUserTimezoneSettings.mockResolvedValueOnce({
      userId: 'user-123',
      timezone: undefined,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockPatchUserTimezone.mockResolvedValue({ timezone: 'America/New_York' });

    // Start with first token getter (triggers first attempt)
    const tokenGetter1 = vi.fn().mockResolvedValue('test-token');
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: true,
      user: { sub: 'user-123' },
      getAccessToken: tokenGetter1,
    });

    const { rerender } = renderHook(() => useTimezoneAutoDetect());

    // Wait for the first (failing) attempt
    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
    });

    // Simulate a new getAccessToken reference (e.g. token refresh) which
    // changes the effect deps, allowing the hook to re-fire since
    // hasRun.current was reset to false on failure
    const tokenGetter2 = vi.fn().mockResolvedValue('test-token-2');
    mockUseAuth = (): MockAuthResult => ({
      isAuthenticated: true,
      user: { sub: 'user-123' },
      getAccessToken: tokenGetter2,
    });

    rerender();

    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(mockPatchUserTimezone).toHaveBeenCalledOnce();
    });
  });

  it('runs only once even if the component re-renders', async () => {
    mockGetUserTimezoneSettings.mockResolvedValue({
      userId: 'user-123',
      timezone: 'Europe/Berlin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const { rerender } = renderHook(() => useTimezoneAutoDetect());

    await waitFor(() => {
      expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
    });

    rerender();
    rerender();

    expect(mockGetUserTimezoneSettings).toHaveBeenCalledOnce();
  });
});
