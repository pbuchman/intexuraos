/**
 * Tests for usePageLifecycle hook.
 * @vitest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSaveCheckpoint = vi.fn();
const mockLoadCheckpoint = vi.fn();
const mockClearCheckpoint = vi.fn();
const mockNavigate = vi.fn();

let mockLocation = { pathname: '/dashboard', search: '', hash: '' };

vi.mock('@/services/stateCheckpoint.js', () => ({
  saveCheckpoint: (...args: unknown[]): unknown => mockSaveCheckpoint(...args),
  loadCheckpoint: (...args: unknown[]): unknown => mockLoadCheckpoint(...args),
  clearCheckpoint: (...args: unknown[]): unknown => mockClearCheckpoint(...args),
}));

vi.mock('react-router-dom', () => ({
  useLocation: (): typeof mockLocation => mockLocation,
  useNavigate: (): typeof mockNavigate => mockNavigate,
}));

// Dynamically import after mocks are set up
const { usePageLifecycle } = await import('../usePageLifecycle.js');

describe('usePageLifecycle', () => {
  let docAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let docRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let winAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let winRemoveEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let originalScrollTo: typeof window.scrollTo;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation = { pathname: '/dashboard', search: '', hash: '' };
    mockLoadCheckpoint.mockResolvedValue(null);

    docAddEventListenerSpy = vi.spyOn(document, 'addEventListener');
    docRemoveEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    winAddEventListenerSpy = vi.spyOn(window, 'addEventListener');
    winRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    originalScrollTo = window.scrollTo;
    window.scrollTo = vi.fn();

    // Mock navigator.storage.persist
    Object.defineProperty(navigator, 'storage', {
      value: { persist: vi.fn().mockResolvedValue(true) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.scrollTo = originalScrollTo;
  });

  it('registers event listeners on mount', () => {
    renderHook(() => usePageLifecycle());

    const docEvents = docAddEventListenerSpy.mock.calls.map((call) => call[0]);
    expect(docEvents).toContain('visibilitychange');
    expect(docEvents).toContain('freeze');

    const winEvents = winAddEventListenerSpy.mock.calls.map((call) => call[0]);
    expect(winEvents).toContain('pagehide');
    expect(winEvents).toContain('pageshow');
  });

  it('calls saveCheckpoint with current route and scroll on visibilitychange to hidden', async () => {
    mockSaveCheckpoint.mockResolvedValue(undefined);
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, 'scrollY', {
      value: 150,
      writable: true,
      configurable: true,
    });

    renderHook(() => usePageLifecycle());

    // Allow mount effects to complete
    await act(async () => {
      await Promise.resolve();
    });

    // Trigger visibilitychange
    const visibilityHandler = docAddEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'visibilitychange'
    )?.[1] as EventListener | undefined;

    if (visibilityHandler === undefined) {
      throw new Error('visibilitychange handler not registered');
    }
    act(() => {
      visibilityHandler(new Event('visibilitychange'));
    });

    expect(mockSaveCheckpoint).toHaveBeenCalledWith({
      routePath: '/dashboard',
      scrollY: 150,
      timestamp: expect.any(Number) as number,
    });
  });

  it('calls loadCheckpoint on mount and navigates if checkpoint found', async () => {
    mockLoadCheckpoint.mockResolvedValue({
      routePath: '/settings',
      scrollY: 300,
      timestamp: Date.now(),
    });

    renderHook(() => usePageLifecycle());

    await act(async () => {
      // Let the async mount effect resolve
      await vi.waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/settings');
      });
    });
  });

  it('does NOT navigate if loadCheckpoint returns null', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls navigator.storage.persist on mount', async () => {
    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
    });

    expect(navigator.storage.persist).toHaveBeenCalledOnce();
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = renderHook(() => usePageLifecycle());

    unmount();

    const docRemovedEvents = docRemoveEventListenerSpy.mock.calls.map((call) => call[0]);
    expect(docRemovedEvents).toContain('visibilitychange');
    expect(docRemovedEvents).toContain('freeze');

    const winRemovedEvents = winRemoveEventListenerSpy.mock.calls.map((call) => call[0]);
    expect(winRemovedEvents).toContain('pagehide');
    expect(winRemovedEvents).toContain('pageshow');
  });

  it('saves checkpoint on pagehide event (registered on window)', async () => {
    mockSaveCheckpoint.mockResolvedValue(undefined);
    Object.defineProperty(window, 'scrollY', {
      value: 350,
      writable: true,
      configurable: true,
    });

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
    });

    const pagehideHandler = winAddEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'pagehide'
    )?.[1] as EventListener | undefined;

    if (pagehideHandler === undefined) {
      throw new Error('pagehide handler not registered on window');
    }
    act(() => {
      pagehideHandler(new Event('pagehide'));
    });

    expect(mockSaveCheckpoint).toHaveBeenCalledWith({
      routePath: '/dashboard',
      scrollY: 350,
      timestamp: expect.any(Number) as number,
    });
  });

  it('saves checkpoint on freeze event', async () => {
    mockSaveCheckpoint.mockResolvedValue(undefined);
    Object.defineProperty(window, 'scrollY', {
      value: 200,
      writable: true,
      configurable: true,
    });

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
    });

    const freezeHandler = docAddEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'freeze'
    )?.[1] as EventListener | undefined;

    if (freezeHandler === undefined) {
      throw new Error('freeze handler not registered');
    }
    act(() => {
      freezeHandler(new Event('freeze'));
    });

    expect(mockSaveCheckpoint).toHaveBeenCalledWith({
      routePath: '/dashboard',
      scrollY: 200,
      timestamp: expect.any(Number) as number,
    });
  });

  it('restores scroll position after navigating from checkpoint', async () => {
    mockLoadCheckpoint.mockResolvedValue({
      routePath: '/settings',
      scrollY: 450,
      timestamp: Date.now(),
    });

    vi.useFakeTimers();

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance past the scroll restore delay
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(window.scrollTo).toHaveBeenCalledWith(0, 450);

    vi.useRealTimers();
  });

  it('clears checkpoint after restoring', async () => {
    mockLoadCheckpoint.mockResolvedValue({
      routePath: '/settings',
      scrollY: 0,
      timestamp: Date.now(),
    });

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockClearCheckpoint).toHaveBeenCalledOnce();
      });
    });
  });

  it('does not save on visibilitychange when state is visible', async () => {
    mockSaveCheckpoint.mockResolvedValue(undefined);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    renderHook(() => usePageLifecycle());

    await act(async () => {
      await Promise.resolve();
    });

    const visibilityHandler = docAddEventListenerSpy.mock.calls.find(
      (call) => call[0] === 'visibilitychange'
    )?.[1] as EventListener | undefined;

    if (visibilityHandler === undefined) {
      throw new Error('visibilitychange handler not registered');
    }
    act(() => {
      visibilityHandler(new Event('visibilitychange'));
    });

    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });
});
