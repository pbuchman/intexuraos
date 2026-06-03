/**
 * Tests for workerSettingsApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getWorkerSettings,
  addWorker,
  updateWorker,
  deleteWorker,
  reorderWorkers,
  testWorkerConnectivity,
  updateDefaultWorkerType,
} from '../workerSettingsApi.js';
import type { WorkerSettingsResponse } from '../workerSettingsApi.types.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    codeAgentUrl: 'https://code.test',
  },
}));

const TOKEN = 'tok';

const sampleSettings: WorkerSettingsResponse = {
  workers: [
    {
      name: 'mac',
      url: 'https://mac.example.com',
      cfAccessClientId: '•••••id',
      cfAccessClientSecret: '•••••sec',
      dispatchSigningSecret: '•••••sig',
      enabled: true,
    },
  ],
};

describe('workerSettingsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWorkerSettings (happy path)', () => {
    it('GETs /code/worker-settings', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(sampleSettings);

      const result = await getWorkerSettings(TOKEN);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[0]).toBe('https://code.test');
      expect(call?.[1]).toBe('/worker-settings');
      expect(call?.[2]).toBe(TOKEN);
      expect(result).toBe(sampleSettings);
    });
  });

  describe('addWorker', () => {
    it('POSTs body to /code/worker-settings/workers', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ added: true });

      const config = {
        name: 'mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'sec',
        dispatchSigningSecret: 'sig',
      };
      await addWorker(TOKEN, config);

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/worker-settings/workers');
      expect(call?.[3]).toEqual({ method: 'POST', body: config });
    });
  });

  describe('updateWorker', () => {
    it('PATCHes /code/worker-settings/workers/:name', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ updated: true });

      await updateWorker(TOKEN, 'mac', { enabled: false });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/worker-settings/workers/mac');
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { enabled: false } });
    });
  });

  describe('deleteWorker', () => {
    it('DELETEs /code/worker-settings/workers/:name', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ deleted: true });

      await deleteWorker(TOKEN, 'mac');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/worker-settings/workers/mac');
      expect(call?.[3]).toEqual({ method: 'DELETE' });
    });
  });

  describe('reorderWorkers', () => {
    it('PUTs to /code/worker-settings/priority', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ reordered: true });

      await reorderWorkers(TOKEN, { workerNames: ['a', 'b'] });

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/worker-settings/priority');
      expect(call?.[3]).toEqual({ method: 'PUT', body: { workerNames: ['a', 'b'] } });
    });
  });

  describe('testWorkerConnectivity', () => {
    it('POSTs to /code/worker-settings/workers/:name/test', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({
        testStatus: 'success', testMessage: 'ok', lastTestedAt: '2026-04-26T00:00:00Z',
      });

      await testWorkerConnectivity(TOKEN, 'mac');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe('/worker-settings/workers/mac/test');
      expect(call?.[3]).toEqual({ method: 'POST' });
    });
  });

  describe('updateDefaultWorkerType', () => {
    it.each([
      ['review' as const, '/worker-settings/default-review-worker-type'],
      ['remediation' as const, '/worker-settings/default-remediation-worker-type'],
      ['execution' as const, '/worker-settings/default-execution-worker-type'],
      ['planning' as const, '/worker-settings/default-planning-worker-type'],
      ['pull-request' as const, '/worker-settings/default-pull-request-worker-type'],
    ])('PATCHes the right path for category %s', async (category, expectedPath) => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ updated: true });

      await updateDefaultWorkerType(TOKEN, category, 'opus');

      const call = vi.mocked(apiRequest).mock.calls[0];
      expect(call?.[1]).toBe(expectedPath);
      expect(call?.[3]).toEqual({ method: 'PATCH', body: { workerType: 'opus' } });
    });
  });

  describe('error path', () => {
    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('forbidden'));

      await expect(getWorkerSettings(TOKEN)).rejects.toThrow('forbidden');
    });
  });
});
