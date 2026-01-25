/**
 * Tests for Worker Discovery service with health checking and caching.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { createWorkerDiscoveryService } from '../../../infra/services/workerDiscoveryImpl.js';

describe('workerDiscoveryImpl', () => {
  let logger: Logger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Store original env and set up test env
    originalEnv = { ...process.env };
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('checkHealth', () => {
    it('returns healthy when worker is ready with capacity', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 3 }),
      } as Response);

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          location: 'mac',
          healthy: true,
          capacity: 3,
          checkedAt: expect.any(Date),
        });
      }

      mockFetch.mockRestore();
    });

    it('returns unhealthy when worker has zero capacity', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 0 }),
      } as Response);

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.healthy).toBe(false);
        expect(result.value.capacity).toBe(0);
      }

      mockFetch.mockRestore();
    });

    it('returns unhealthy when worker is shutting down', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'shutting_down', capacity: 5 }),
      } as Response);

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.healthy).toBe(false);
      }

      mockFetch.mockRestore();
    });

    it('returns error when health check fails with non-OK status', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('health_check_failed');
        expect(result.error.message).toContain('HTTP 503');
      }

      mockFetch.mockRestore();
    });

    it('returns error when worker config not found', async () => {
      process.env['INTEXURAOS_CODE_WORKERS'] = 'mac:https://cc-mac.intexuraos.cloud:1';
      const service = createWorkerDiscoveryService({ logger });

      const result = await service.checkHealth('vm');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('vm');
      }
    });

    it('returns error on timeout', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        Object.assign(new Error('Timeout'), { name: 'AbortError' })
      );

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('health_check_failed');
        expect(result.error.message).toContain('timed out');
      }

      mockFetch.mockRestore();
    });

    it('returns error on timeout with nested cause', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const abortError = new Error('Request timeout') as Error & { cause?: Error };
      abortError.cause = new Error('Aborted');
      abortError.cause.name = 'AbortError';

      const mockFetch = vi.spyOn(global, 'fetch').mockRejectedValueOnce(abortError);

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('health_check_failed');
        expect(result.error.message).toContain('timed out');
      }

      mockFetch.mockRestore();
    });

    it('returns error on network error', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await service.checkHealth('mac');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
        expect(result.error.message).toContain('Network error');
      }

      mockFetch.mockRestore();
    });

    it('clamps capacity to 0-5 range', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch');

      // Test negative capacity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', capacity: -5 }),
      } as Response);

      const result1 = await service.checkHealth('mac');
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value.capacity).toBe(0);
      }

      // Test excessive capacity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 100 }),
      } as Response);

      const result2 = await service.checkHealth('vm');
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.capacity).toBe(5);
      }

      mockFetch.mockRestore();
    });

    it('includes Cloudflare Access headers in request', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 2 }),
      } as Response);

      await service.checkHealth('mac');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cc-mac.intexuraos.cloud/health',
        expect.objectContaining({
          headers: {
            'CF-Access-Client-Id': 'test-client-id',
            'CF-Access-Client-Secret': 'test-client-secret',
          },
        })
      );

      mockFetch.mockRestore();
    });
  });

  describe('health check caching', () => {
    it('caches health for 5 seconds', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 3 }),
      } as Response);

      // First call should hit the endpoint
      const result1 = await service.checkHealth('mac');
      expect(result1.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call within 5 seconds should use cache
      const result2 = await service.checkHealth('mac');
      expect(result2.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No new fetch

      mockFetch.mockRestore();
    });

    it('expires cache after 5 seconds', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 3 }),
      } as Response);

      // First call
      await service.checkHealth('mac');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Wait for cache to expire (5.1 seconds)
      await new Promise((resolve) => setTimeout(resolve, 5100));

      // Second call should hit endpoint again
      await service.checkHealth('mac');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      mockFetch.mockRestore();
    });
  });

  describe('findAvailableWorker', () => {
    it('returns Mac when healthy with capacity', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 3 }),
      } as Response);

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('mac');
        expect(result.value.url).toBe('https://cc-mac.intexuraos.cloud');
        expect(result.value.priority).toBe(1);
      }

      mockFetch.mockRestore();
    });

    it('falls back to VM when Mac is at capacity', async () => {
      const service = createWorkerDiscoveryService({ logger });
      let callCount = 0;
      const mockFetch = vi.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        // Mac at capacity
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ status: 'ready', capacity: 0 }),
          } as Response);
        }
        // VM has capacity
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ready', capacity: 2 }),
        } as Response);
      });

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('vm');
      }

      mockFetch.mockRestore();
    });

    it('falls back to VM when Mac is unhealthy', async () => {
      const service = createWorkerDiscoveryService({ logger });
      let callCount = 0;
      const mockFetch = vi.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        // Mac shutting down
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ status: 'shutting_down', capacity: 5 }),
          } as Response);
        }
        // VM healthy
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ready', capacity: 2 }),
        } as Response);
      });

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('vm');
      }

      mockFetch.mockRestore();
    });

    it('falls back to VM when Mac health check fails', async () => {
      const service = createWorkerDiscoveryService({ logger });
      let callCount = 0;
      const mockFetch = vi.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        // Mac fails
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
          } as Response);
        }
        // VM healthy
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ready', capacity: 2 }),
        } as Response);
      });

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('vm');
      }

      mockFetch.mockRestore();
    });

    it('returns error when both workers unavailable', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 0 }),
      } as Response);

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('No workers available');
      }

      mockFetch.mockRestore();
    });

    it('returns error when all health checks fail', async () => {
      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      const result = await service.findAvailableWorker();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }

      mockFetch.mockRestore();
    });
  });

  describe('worker configuration parsing', () => {
    it('throws error when INTEXURAOS_CODE_WORKERS not set', () => {
      delete process.env['INTEXURAOS_CODE_WORKERS'];

      expect(() => createWorkerDiscoveryService({ logger })).toThrow(
        'INTEXURAOS_CODE_WORKERS environment variable is required'
      );
    });

    it('sorts workers by priority', async () => {
      // VM with priority 1, Mac with priority 2
      process.env['INTEXURAOS_CODE_WORKERS'] =
        'vm:https://cc-vm.intexuraos.cloud:1,mac:https://cc-mac.intexuraos.cloud:2';

      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 2 }),
      } as Response);

      const result = await service.findAvailableWorker();

      // Should check VM first (priority 1)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('vm');
      }

      mockFetch.mockRestore();
    });

    it('ignores malformed worker entries', async () => {
      process.env['INTEXURAOS_CODE_WORKERS'] =
        'mac:https://cc-mac.intexuraos.cloud:1,invalid:entry,vm:https://cc-vm.intexuraos.cloud:2';

      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 2 }),
      } as Response);

      const result = await service.findAvailableWorker();

      // Should work with only valid entries
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('mac');
      }

      mockFetch.mockRestore();
    });

    it('ignores worker entry with no colon', async () => {
      process.env['INTEXURAOS_CODE_WORKERS'] =
        'mac:https://cc-mac.intexuraos.cloud:1,invalid-entry,vm:https://cc-vm.intexuraos.cloud:2';

      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 2 }),
      } as Response);

      const result = await service.findAvailableWorker();

      // Should work with only valid entries (invalid-entry has no colon)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('mac');
      }

      mockFetch.mockRestore();
    });

    it('ignores worker entry with invalid location (not mac or vm)', async () => {
      process.env['INTEXURAOS_CODE_WORKERS'] =
        'mac:https://cc-mac.intexuraos.cloud:1,cloud:https://cc-cloud.intexuraos.cloud:2,vm:https://cc-vm.intexuraos.cloud:3';

      const service = createWorkerDiscoveryService({ logger });
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', capacity: 2 }),
      } as Response);

      const result = await service.findAvailableWorker();

      // Should work with only valid locations (mac and vm)
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.location).toBe('mac');
      }

      mockFetch.mockRestore();
    });
  });
});
