/**
 * Tests for WorkerHealthProbe service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkerHealthProbe } from '../../../infra/services/workerHealthProbe.js';

// Mock fetch to simulate worker responses
global.fetch = vi.fn();

const mockedFetch = vi.mocked(fetch);

describe('WorkerHealthProbe', () => {
  const mockWorker = {
    name: 'home-mac',
    url: 'https://cc-mac.intexuraos.cloud',
    cfAccessClientId: 'test-client-id',
    cfAccessClientSecret: 'test-client-secret',
    dispatchSigningSecret: 'test-signing-secret',
    enabled: true,
  };

  let probe: ReturnType<typeof createWorkerHealthProbe>;

  beforeEach(() => {
    vi.clearAllMocks();
    probe = createWorkerHealthProbe();
  });

  describe('probeWorker', () => {
    it('should return healthy state when orchestrator responds with ready status', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ready',
          capacity: 2,
          running: 1,
          available: 1,
        }),
      } as Response);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'healthy',
        healthy: true,
        capacity: 2,
        running: 1,
        available: 1,
        responseTimeMs: expect.any(Number),
      });
    });

    it('should return orchestrator-unreachable with timeout when request times out', async () => {
      // Simulate timeout by rejecting with AbortError
      const abortError = new Error('Request timeout') as Error & { name: string };
      abortError.name = 'AbortError';
      mockedFetch.mockRejectedValueOnce(abortError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'orchestrator-unreachable',
        healthy: false,
        reason: 'timeout',
      });
    });

    it('should return orchestrator-unreachable with http-error when status >= 500', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'orchestrator-unreachable',
        healthy: false,
        reason: 'http-error',
        code: '503',
      });
    });

    it('should return orchestrator-unreachable with http-error when status is 404', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'orchestrator-unreachable',
        healthy: false,
        reason: 'http-error',
        code: '404',
      });
    });

    it('should return tunnel-down with dns-failed when DNS lookup fails', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND') as Error & { code?: string };
      dnsError.code = 'ENOTFOUND';
      mockedFetch.mockRejectedValueOnce(dnsError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'dns-failed',
        code: 'ENOTFOUND',
      });
    });

    it('should return tunnel-down with connection-refused when connection is refused', async () => {
      const connError = new Error('connect ECONNREFUSED') as Error & { code?: string };
      connError.code = 'ECONNREFUSED';
      mockedFetch.mockRejectedValueOnce(connError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'connection-refused',
        code: 'ECONNREFUSED',
      });
    });

    it('should return tunnel-down with tls-error when TLS certificate fails', async () => {
      const tlsError = new Error('certificate has expired') as Error & { code?: string };
      mockedFetch.mockRejectedValueOnce(tlsError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'tls-error',
        code: 'TLS_ERROR',
      });
    });

    it('should return unknown state for unhandled errors', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('Unexpected error'));

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'unknown',
        healthy: false,
        error: 'Unexpected error',
      });
    });

    it('should return unknown state when health response format is invalid', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ invalid: 'response' }),
      } as Response);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'unknown',
        healthy: false,
        error: 'Invalid health response format',
      });
    });

    it('should return unknown state when response body is not valid JSON', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          throw new SyntaxError('Unexpected token');
        },
      } as Response);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'unknown',
        healthy: false,
        error: 'Invalid health response format',
      });
    });

    it('should return tunnel-down with connection-refused when connection resets', async () => {
      const connError = new Error('read ECONNRESET') as Error & { code?: string };
      connError.code = 'ECONNRESET';
      mockedFetch.mockRejectedValueOnce(connError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'connection-refused',
        code: 'ECONNRESET',
      });
    });

    it('should return tunnel-down with connection-refused when connection times out at TCP level', async () => {
      const connError = new Error('connect ETIMEDOUT') as Error & { code?: string };
      connError.code = 'ETIMEDOUT';
      mockedFetch.mockRejectedValueOnce(connError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'connection-refused',
        code: 'ETIMEDOUT',
      });
    });

    it('should return tunnel-down with tls-error and preserve error code when TLS fails with code', async () => {
      const tlsError = new Error('TLS handshake failed') as Error & { code?: string };
      tlsError.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
      mockedFetch.mockRejectedValueOnce(tlsError);

      const result = await probe.probeWorker(mockWorker);

      expect(result).toEqual({
        _tag: 'tunnel-down',
        healthy: false,
        reason: 'tls-error',
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
    });
  });

  describe('probeAllWorkers', () => {
    it('should probe all workers in parallel and return results map', async () => {
      const workers = [
        mockWorker,
        {
          name: 'cloud-vm',
          url: 'https://cc-vm.intexuraos.cloud',
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
          dispatchSigningSecret: 'test-signing-secret',
          enabled: true,
        },
      ];

      mockedFetch.mockImplementation(async (input) => {
        // Handle both string URLs and Request objects
        const url = typeof input === 'string' ? input : String(input);
        if (url.includes('cc-mac.intexuraos.cloud')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ready',
              capacity: 2,
              running: 1,
              available: 1,
            }),
          } as Response;
        }
        if (url.includes('cc-vm.intexuraos.cloud')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ready',
              capacity: 1,
              running: 0,
              available: 1,
            }),
          } as Response;
        }
        throw new Error('Unknown worker');
      });

      const results = await probe.probeAllWorkers(workers);

      expect(results).toEqual({
        'home-mac': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 1,
          available: 1,
          responseTimeMs: expect.any(Number),
        },
        'cloud-vm': {
          _tag: 'healthy',
          healthy: true,
          capacity: 1,
          running: 0,
          available: 1,
          responseTimeMs: expect.any(Number),
        },
      });
    });

    it('should return mixed states when some workers fail', async () => {
      const workers = [mockWorker];

      const abortError = new Error('Request timeout') as Error & { name: string };
      abortError.name = 'AbortError';
      mockedFetch.mockRejectedValueOnce(abortError);

      const results = await probe.probeAllWorkers(workers);

      expect(results).toEqual({
        'home-mac': {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'timeout',
        },
      });
    });
  });
});
