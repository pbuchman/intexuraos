import { describe, it, expect, vi } from 'vitest';
import { ClaudeAuthManager } from '../claude-auth-manager.js';

describe('ClaudeAuthManager', () => {
  it('maps active monitor state to worker auth state', () => {
    const monitor = {
      loadCredentials: vi.fn(() => true),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      getState: vi.fn(() => ({
        status: 'active' as const,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        subscriptionType: 'max' as const,
      })),
      isExpiringSoon: vi.fn(() => false),
      getCurrentAccessToken: vi.fn(() => 'claude-token'),
    };
    const refresher = { refresh: vi.fn(async () => true) };
    const manager = new ClaudeAuthManager(monitor as never, refresher as never);

    expect(manager.loadCredentials()).toBe(true);
    expect(manager.getState()).toEqual({
      status: 'active',
      authMode: 'oauth',
      refreshSupported: true,
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 60,
      subscriptionType: 'max',
    });
    expect(manager.getCurrentAccessToken()).toBe('claude-token');
  });

  it('maps expired monitor state to refreshable oauth worker auth state', async () => {
    const monitor = {
      loadCredentials: vi.fn(() => true),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      getState: vi.fn(() => ({
        status: 'expired' as const,
        message: 'Access token expired',
      })),
      isExpiringSoon: vi.fn(() => true),
      getCurrentAccessToken: vi.fn(() => null),
    };
    const refresher = { refresh: vi.fn(async () => true) };
    const manager = new ClaudeAuthManager(monitor as never, refresher as never);

    expect(manager.getState()).toEqual({
      status: 'expired',
      authMode: 'oauth',
      refreshSupported: true,
      message: 'Access token expired',
    });
    expect(manager.isExpiringSoon(5 * 60 * 1000)).toBe(true);
    expect(await manager.refresh()).toBe(true);
  });

  it('maps missing monitor state to non-refreshable null-auth mode', () => {
    const monitor = {
      loadCredentials: vi.fn(() => false),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      getState: vi.fn(() => ({
        status: 'not_configured' as const,
        message: 'Claude credentials not found',
      })),
      isExpiringSoon: vi.fn(() => false),
      getCurrentAccessToken: vi.fn(() => null),
    };
    const refresher = { refresh: vi.fn(async () => false) };
    const manager = new ClaudeAuthManager(monitor as never, refresher as never);

    manager.startMonitoring();
    manager.stopMonitoring();

    expect(manager.getState()).toEqual({
      status: 'not_configured',
      authMode: null,
      refreshSupported: false,
      message: 'Claude credentials not found',
    });
  });
});
