import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserSettings } from '../authApi.js';

vi.mock('../apiClient.js', () => ({ apiRequest: vi.fn() }));

vi.mock('../../config', () => ({
  config: { authServiceUrl: 'https://user-service.test' },
}));

const availableSettings = {
  userId: 'auth0:user_1',
  timezone: 'Europe/Warsaw',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  intexAgentCapabilities: {
    testRuns: { status: 'available', runtimeAudience: 'hetzner-prod' },
  },
};

describe('authApi User Settings capability decoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes the authenticated user, forwards cancellation, and accepts available', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const controller = new AbortController();
    vi.mocked(apiRequest).mockResolvedValue(availableSettings);

    await expect(getUserSettings('token', 'auth0:user /1', controller.signal)).resolves.toEqual(
      availableSettings
    );
    expect(vi.mocked(apiRequest).mock.calls[0]).toEqual([
      'https://user-service.test',
      '/users/auth0%3Auser%20%2F1/settings',
      'token',
      { signal: controller.signal },
    ]);
  });

  it('accepts the reason-free unavailable capability', async () => {
    const { apiRequest } = await import('../apiClient.js');
    const unavailable = {
      ...availableSettings,
      intexAgentCapabilities: { testRuns: { status: 'unavailable' } },
    };
    vi.mocked(apiRequest).mockResolvedValue(unavailable);

    await expect(getUserSettings('token', 'auth0:user_1')).resolves.toEqual(unavailable);
  });

  it.each([
    ['private capability reason', { status: 'unavailable', reason: 'wrong-user' }],
    ['private configured identity', { status: 'unavailable', configuredUserId: 'private' }],
    ['available without audience', { status: 'available' }],
    ['legacy Home Dev audience', { status: 'available', runtimeAudience: 'home-dev' }],
    ['unknown production audience', { status: 'available', runtimeAudience: 'production' }],
  ])('fails closed for %s', async (_name, testRuns) => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({
      ...availableSettings,
      intexAgentCapabilities: { testRuns },
    });

    await expect(getUserSettings('token', 'auth0:user_1')).rejects.toThrow(
      'Invalid user settings response'
    );
  });

  it('rejects unknown top-level fields instead of carrying them into browser state', async () => {
    const { apiRequest } = await import('../apiClient.js');
    vi.mocked(apiRequest).mockResolvedValue({ ...availableSettings, accountEmail: 'private@test' });

    await expect(getUserSettings('token', 'auth0:user_1')).rejects.toThrow(
      'Invalid user settings response'
    );
  });
});
