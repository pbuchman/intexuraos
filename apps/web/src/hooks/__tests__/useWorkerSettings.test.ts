/**
 * Tests for useWorkerSettings hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { WorkerSettingsResponse } from '@/services/workerSettingsApi.types';

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  user: { sub: 'auth0|user-1' } as { sub?: string } | undefined,
  getWorkerSettings: vi.fn(),
  addWorker: vi.fn(),
  updateWorker: vi.fn(),
  deleteWorker: vi.fn(),
  testWorkerConnectivity: vi.fn(),
  reorderWorkers: vi.fn(),
  updateDefaultWorkerType: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): {
    user: { sub?: string } | undefined;
    getAccessToken: typeof mocks.getAccessToken;
  } => ({
    user: mocks.user,
    getAccessToken: mocks.getAccessToken,
  }),
}));

vi.mock('@/services/workerSettingsApi', () => ({
  getWorkerSettings: mocks.getWorkerSettings,
  addWorker: mocks.addWorker,
  updateWorker: mocks.updateWorker,
  deleteWorker: mocks.deleteWorker,
  testWorkerConnectivity: mocks.testWorkerConnectivity,
  reorderWorkers: mocks.reorderWorkers,
  updateDefaultWorkerType: mocks.updateDefaultWorkerType,
}));

import { useWorkerSettings } from '../useWorkerSettings.js';

const sampleSettings: WorkerSettingsResponse = {
  workers: [
    {
      name: 'mac',
      url: 'https://mac.example.com',
      cfAccessClientId: '•••id',
      cfAccessClientSecret: '•••sec',
      dispatchSigningSecret: '•••sig',
      enabled: true,
    },
  ],
};

describe('useWorkerSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { sub: 'auth0|user-1' };
    mocks.getAccessToken.mockResolvedValue('tok');
  });

  it('happy path: loads worker settings on mount', async () => {
    mocks.getWorkerSettings.mockResolvedValue(sampleSettings);

    const { result } = renderHook(() => useWorkerSettings());

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.settings).toBe(sampleSettings);
    expect(result.current.error).toBeNull();
  });

  it('error path: surfaces error message', async () => {
    mocks.getWorkerSettings.mockRejectedValue(new Error('server unavailable'));

    const { result } = renderHook(() => useWorkerSettings());

    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.error).toBe('server unavailable');
    expect(result.current.settings).toBeNull();
  });

  it('addWorker: calls API and refreshes (no-loading-flag)', async () => {
    mocks.getWorkerSettings.mockResolvedValue(sampleSettings);
    mocks.addWorker.mockResolvedValue({ added: true });

    const { result } = renderHook(() => useWorkerSettings());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    await act(async () => {
      await result.current.addWorker({
        name: 'lin',
        url: 'https://lin.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'sec',
        dispatchSigningSecret: 'sig',
      });
    });

    expect(mocks.addWorker).toHaveBeenCalledWith('tok', expect.objectContaining({ name: 'lin' }));
    // Two getWorkerSettings calls: initial + after add
    expect(mocks.getWorkerSettings).toHaveBeenCalledTimes(2);
  });

  it('addWorker error: surfaces error and rethrows', async () => {
    mocks.getWorkerSettings.mockResolvedValue(sampleSettings);
    mocks.addWorker.mockRejectedValue(new Error('duplicate'));

    const { result } = renderHook(() => useWorkerSettings());
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.addWorker({
          name: 'mac',
          url: 'u',
          cfAccessClientId: 'id',
          cfAccessClientSecret: 'sec',
          dispatchSigningSecret: 'sig',
        });
      } catch (e) {
        caught = e;
      }
    });

    expect((caught as Error).message).toBe('duplicate');
    await waitFor(() => { expect(result.current.error).toBe('duplicate'); });
  });

  it('skips load when user is unauthenticated', async () => {
    mocks.user = undefined;

    const { result } = renderHook(() => useWorkerSettings());

    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(mocks.getWorkerSettings).not.toHaveBeenCalled();
  });
});
