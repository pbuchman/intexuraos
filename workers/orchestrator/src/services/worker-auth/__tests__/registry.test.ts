import { describe, it, expect, vi } from 'vitest';
import { WorkerAuthRegistry } from '../registry.js';
import type { WorkerAuthManager, WorkerAuthProvider, WorkerAuthState } from '../types.js';

function createManager(
  provider: WorkerAuthProvider,
  state: WorkerAuthState,
  refreshResult = true
): WorkerAuthManager {
  return {
    provider,
    loadCredentials: vi.fn(() => true),
    startMonitoring: vi.fn(),
    stopMonitoring: vi.fn(),
    getState: vi.fn(() => state),
    isExpiringSoon: vi.fn(() => false),
    refresh: vi.fn(async () => refreshResult),
    getCurrentAccessToken: vi.fn(() => null),
  };
}

describe('WorkerAuthRegistry', () => {
  it('returns both provider states', () => {
    const registry = new WorkerAuthRegistry([
      createManager('claude', {
        status: 'active',
        authMode: 'oauth',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        subscriptionType: 'max',
      }),
      createManager('codex', {
        status: 'active',
        authMode: 'chatgpt',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        lastRefreshAt: '2026-03-26T11:00:00.000Z',
      }),
    ]);

    expect(registry.getStates()).toEqual({
      claude: {
        status: 'active',
        authMode: 'oauth',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        subscriptionType: 'max',
      },
      codex: {
        status: 'active',
        authMode: 'chatgpt',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        lastRefreshAt: '2026-03-26T11:00:00.000Z',
      },
    });
  });

  it('delegates refresh to the selected provider manager', async () => {
    const codexManager = createManager('codex', {
      status: 'expired',
      authMode: 'chatgpt',
      refreshSupported: true,
      message: 'expired',
    });
    const registry = new WorkerAuthRegistry([
      createManager('claude', {
        status: 'active',
        authMode: 'oauth',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
        subscriptionType: 'max',
      }),
      codexManager,
    ]);

    const result = await registry.refresh('codex');

    expect(result).toBe(true);
    expect(codexManager.refresh).toHaveBeenCalledTimes(1);
  });

  it('returns fallback defaults for missing providers and missing tokens', async () => {
    const claudeManager = createManager('claude', {
      status: 'active',
      authMode: 'oauth',
      refreshSupported: true,
      expiresAt: '2026-03-26T16:00:00.000Z',
      expiresInMinutes: 60,
      subscriptionType: 'max',
    });
    claudeManager.loadCredentials = vi.fn(() => true);
    claudeManager.isExpiringSoon = vi.fn(() => true);
    claudeManager.getCurrentAccessToken = vi.fn(() => 'claude-token');
    const registry = new WorkerAuthRegistry([claudeManager]);

    expect(registry.loadCredentials()).toEqual({ claude: true, codex: false });
    expect(registry.getState('codex')).toEqual({
      status: 'not_configured',
      authMode: null,
      refreshSupported: false,
      message: 'Worker auth manager not configured',
    });
    expect(registry.isExpiringSoon('codex', 1000)).toBe(false);
    expect(await registry.refresh('codex')).toBe(false);
    expect(registry.getCurrentAccessToken('codex')).toBeNull();
    expect(registry.getCurrentAccessToken('claude')).toBe('claude-token');
  });

  it('returns false for loadCredentials when claude manager is missing', () => {
    const registry = new WorkerAuthRegistry([
      createManager('codex', {
        status: 'active',
        authMode: 'chatgpt',
        refreshSupported: true,
        expiresAt: '2026-03-26T16:00:00.000Z',
        expiresInMinutes: 60,
      }),
    ]);

    expect(registry.loadCredentials()).toEqual({ claude: false, codex: true });
  });
});
