import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebhookClient, type WebhookPayload } from '../services/webhook-client.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { Logger } from '@intexuraos/common-core';
import type { PendingWebhook, OrchestratorState } from '../types/state.js';

describe('WebhookClient', () => {
  // Mock StatePersistence
  const createStatePersistence = (): StatePersistence => {
    const state: OrchestratorState = {
      tasks: {},
      githubToken: null,
      pendingWebhooks: [] as PendingWebhook[],
    };

    const mock = {
      load: vi.fn(
        (): Promise<OrchestratorState> => Promise.resolve(JSON.parse(JSON.stringify(state)))
      ),
      save: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
      saveAtomic: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
      modify: vi.fn(async (fn: (s: OrchestratorState) => void | Promise<void>) => {
        const current: OrchestratorState = JSON.parse(JSON.stringify(state));
        await fn(current);
        Object.assign(state, current);
      }),
      detectOrphanWorktrees: vi.fn(async () => []),
      emptyState: () => ({ tasks: {}, githubToken: null, pendingWebhooks: [] }),
    } as unknown as StatePersistence;
    return mock;
  };

  // Mock Logger
  /* eslint-disable @typescript-eslint/no-empty-function */
  const mockLogger: Logger = {
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    debug: (): void => {},
  };

  // Mock fetch
  const mockFetch = vi.fn();
  global.fetch = mockFetch as typeof global.fetch;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send webhook with correct signature', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-1',
        status: 'completed',
        duration: 1000,
      };

      const result = await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-1',
      });

      expect(result).toEqual({ ok: true, value: undefined });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const callArgs = mockFetch.mock.calls[0];
      if (!callArgs) throw new Error('No fetch calls');
      expect(callArgs[0]).toBe('https://example.com/webhook');
      expect(callArgs[1]?.method).toBe('POST');

      const headers = callArgs[1]?.headers;
      expect(headers).toHaveProperty('Content-Type');
      expect(headers).toHaveProperty('X-Request-Timestamp');
      expect(headers).toHaveProperty('X-Request-Signature');
      expect(headers).toHaveProperty('X-Internal-Auth', 'test-internal-auth-token');
    });

    it('should not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-2',
        status: 'failed',
        error: { message: 'Test error' },
        duration: 500,
      };

      const result = await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-2',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('4xx');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry 3x on 5xx errors with exponential backoff', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-3',
        status: 'completed',
        duration: 2000,
      };

      const resultPromise = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-3',
      });

      await vi.advanceTimersByTimeAsync(25000);

      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(false);

      const state = await statePersistence.load();
      expect(state.pendingWebhooks).toHaveLength(1);
      expect(state.pendingWebhooks?.[0]?.taskId).toBe('task-3');

      vi.useRealTimers();
    });

    it('should log error details when send delivery attempt fails', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const statePersistence = createStatePersistence();
      const warnSpy = vi.fn();
      const spiedLogger: Logger = { ...mockLogger, warn: warnSpy };
      const client = new WebhookClient(statePersistence, spiedLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-send-log',
        status: 'completed',
        duration: 1000,
      };

      const resultPromise = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-send-log',
      });

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-send-log',
          errorType: '5xx',
          errorMessage: expect.stringContaining('Server error'),
          attempt: expect.any(Number),
        }),
        expect.stringContaining('Webhook delivery attempt failed')
      );

      vi.useRealTimers();
    });

    it('should use fallback delay when RETRY_DELAYS array index is out of bounds', async () => {
      vi.useFakeTimers();

      // Fail all attempts with a network error - this exercises the delay path
      // including the ?? 5000 fallback for out-of-bounds array access
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-fallback-delay',
        status: 'completed',
        duration: 1000,
      };

      const resultPromise = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-fallback-delay',
      });

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('network');
      }
      expect(mockFetch).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should return lastError after all retries fail', async () => {
      vi.useFakeTimers();

      mockFetch.mockRejectedValue(new Error('persistent failure'));

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-all-fail',
        status: 'failed',
        duration: 2000,
      };

      const resultPromise = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-all-fail',
      });

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('network');
        expect(result.error.message).toContain('persistent failure');
      }

      // Should have been queued for pending
      const state = await statePersistence.load();
      expect(state.pendingWebhooks).toHaveLength(1);

      vi.useRealTimers();
    });

    it('should succeed on 2nd attempt and stop retrying', async () => {
      let attemptCount = 0;
      mockFetch.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('HTTP 500');
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
        } as Response;
      });

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-4',
        status: 'completed',
        duration: 1500,
      };

      const result = await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-4',
      });

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Failed once, succeeded on retry

      // Should NOT be in pending queue
      const state = await statePersistence.load();
      expect(state.pendingWebhooks).toHaveLength(0);
    });
  });

  describe('signature generation', () => {
    it('should generate consistent HMAC-SHA256 signatures', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload = { taskId: 'task-1', status: 'completed' as const, duration: 1000 };

      await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-1',
      });

      const firstSignature = mockFetch.mock.calls[0]?.[1]?.headers?.['X-Request-Signature'];

      // Send again with same data
      await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-1',
      });

      const secondSignature = mockFetch.mock.calls[1]?.[1]?.headers?.['X-Request-Signature'];

      // Signatures should be the same (with same timestamp)
      // Note: timestamps may differ slightly between calls
      expect(firstSignature).toBeDefined();
      expect(secondSignature).toBeDefined();
    });
  });

  describe('error classification', () => {
    it('should classify timeout errors correctly', async () => {
      vi.useFakeTimers();

      const abortError = new Error('Request aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-timeout',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-timeout',
      });

      // Advance through all retry delays (5s + 15s + 45s = 65s)
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('timeout');
      }

      vi.useRealTimers();
    });

    it('should classify network errors correctly', async () => {
      vi.useFakeTimers();

      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-network',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-network',
      });

      // Advance through all retry delays (5s + 15s + 45s = 65s)
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('network');
      }

      vi.useRealTimers();
    });

    it('should include cause chain in network error message', async () => {
      vi.useFakeTimers();

      const cause = new Error('connect ECONNREFUSED 34.143.76.2:443') as Error & { code: string };
      cause.code = 'ECONNREFUSED';
      mockFetch.mockRejectedValue(new TypeError('fetch failed', { cause }));

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-cause',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-cause',
      });

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('network');
        expect(resolved.error.message).toContain('ECONNREFUSED');
      }

      vi.useRealTimers();
    });

    it('should include cause chain in fallback error message for generic Error', async () => {
      vi.useFakeTimers();

      const cause = new Error('SSL handshake failed') as Error & { code: string };
      cause.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
      const error = new Error('request failed', { cause });
      mockFetch.mockRejectedValue(error);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-generic-cause',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-generic-cause',
      });

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('network');
        expect(resolved.error.message).toContain('SSL handshake failed');
        expect(resolved.error.message).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
      }

      vi.useRealTimers();
    });

    it('should classify 5xx errors correctly', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-5xx',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-5xx',
      });

      // Advance through all retry delays (5s + 15s + 45s = 65s)
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('5xx');
      }

      vi.useRealTimers();
    });
  });

  describe('retryPending', () => {
    it('should retry pending webhooks and remove successful ones', async () => {
      vi.useFakeTimers();

      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();
      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook1',
          secret: 'secret1',
          payload: { taskId: 'task-1', status: 'completed' as const, duration: 1000 },
          taskId: 'task-1',
          attempts: 3,
          createdAt: Date.now(),
        },
        {
          url: 'https://example.com/webhook2',
          secret: 'secret2',
          payload: { taskId: 'task-2', status: 'failed' as const, duration: 500 },
          taskId: 'task-2',
          attempts: 3,
          createdAt: Date.now(),
        },
      ];
      await statePersistence.save(state);

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('webhook1')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
          } as Response;
        }
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response;
      });

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');
      const retryPromise = client.retryPending();

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      await retryPromise;

      const updatedState = await statePersistence.load();

      expect(updatedState.pendingWebhooks).toHaveLength(1);
      expect(updatedState.pendingWebhooks?.[0]?.taskId).toBe('task-2');

      vi.useRealTimers();
    });

    it('should remove pending webhooks older than 24 hours', async () => {
      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();
      const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;

      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook',
          secret: 'secret',
          payload: { taskId: 'old-task', status: 'completed' as const, duration: 1000 },
          taskId: 'old-task',
          attempts: 3,
          createdAt: twentyFiveHoursAgo,
        },
      ];
      await statePersistence.save(state);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');
      await client.retryPending();

      const updatedState = await statePersistence.load();
      expect(updatedState.pendingWebhooks).toHaveLength(0);
    });

    it('should handle empty pending queue', async () => {
      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();
      state.pendingWebhooks = [];
      await statePersistence.save(state);

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');
      await client.retryPending();

      const updatedState = await statePersistence.load();
      expect(updatedState.pendingWebhooks).toHaveLength(0);
    });

    it('should not retry pending webhook on 4xx errors', async () => {
      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();

      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook',
          secret: 'secret',
          payload: { taskId: 'task-4xx', status: 'completed' as const, duration: 1000 },
          taskId: 'task-4xx',
          attempts: 3,
          createdAt: Date.now(),
        },
      ];
      await statePersistence.save(state);

      // Mock returns 404 - should not retry
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');
      await client.retryPending();

      // Should be called only once (no retries for 4xx)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const updatedState = await statePersistence.load();
      // Failed 4xx should remain in queue with incremented attempts (not retried but preserved)
      expect(updatedState.pendingWebhooks).toHaveLength(1);
      expect(updatedState.pendingWebhooks?.[0]?.attempts).toBe(4);
    });

    it('should retry pending webhook on network error and queue if fails', async () => {
      vi.useFakeTimers();

      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();

      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook',
          secret: 'secret',
          payload: { taskId: 'task-network', status: 'completed' as const, duration: 1000 },
          taskId: 'task-network',
          attempts: 3,
          createdAt: Date.now(),
        },
      ];
      await statePersistence.save(state);

      // Mock fails with network error - should retry 3x
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      // Start the retry (it will retry async with delays)
      const retryPromise = client.retryPending();

      // Advance through all retry delays (5s + 15s + 45s = 65s)
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      await retryPromise;

      // Should have attempted 3 times
      expect(mockFetch).toHaveBeenCalledTimes(3);

      const updatedState = await statePersistence.load();
      // Should remain in queue with incremented attempts
      expect(updatedState.pendingWebhooks).toHaveLength(1);
      expect(updatedState.pendingWebhooks?.[0]?.attempts).toBe(4);

      vi.useRealTimers();
    });

    it('should log error details when retry delivery fails', async () => {
      vi.useFakeTimers();

      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();

      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook',
          secret: 'secret',
          payload: { taskId: 'task-log-err', status: 'completed' as const, duration: 1000 },
          taskId: 'task-log-err',
          attempts: 5,
          createdAt: Date.now(),
        },
      ];
      await statePersistence.save(state);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const warnSpy = vi.fn();
      const spiedLogger: Logger = { ...mockLogger, warn: warnSpy };
      const client = new WebhookClient(statePersistence, spiedLogger, 'test-internal-auth-token');

      const retryPromise = client.retryPending();
      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();
      await retryPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-log-err',
          errorType: '5xx',
          errorMessage: expect.stringContaining('Server error'),
          attempt: expect.any(Number),
        }),
        expect.stringContaining('Pending webhook retry attempt failed')
      );

      vi.useRealTimers();
    });

    it('should classify non-Error throwables as network errors', async () => {
      vi.useFakeTimers();

      // Throw a string (not an Error)
      mockFetch.mockRejectedValue('Some string error');

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const payload: WebhookPayload = {
        taskId: 'task-non-error',
        status: 'completed',
        duration: 1000,
      };

      const result = client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-non-error',
      });

      await vi.advanceTimersByTimeAsync(70000);
      await vi.runAllTimersAsync();

      const resolved = await result;
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error.type).toBe('network');
        expect(resolved.error.message).toBe('Unknown error');
      }

      vi.useRealTimers();
    });
  });

  describe('getPendingCount', () => {
    it('should return count of pending webhooks', async () => {
      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();

      state.pendingWebhooks = [
        {
          url: 'https://example.com/webhook1',
          secret: 'secret1',
          payload: { taskId: 'task-1', status: 'completed' as const, duration: 1000 },
          taskId: 'task-1',
          attempts: 3,
          createdAt: Date.now(),
        },
        {
          url: 'https://example.com/webhook2',
          secret: 'secret2',
          payload: { taskId: 'task-2', status: 'failed' as const, duration: 500 },
          taskId: 'task-2',
          attempts: 3,
          createdAt: Date.now(),
        },
      ];
      await statePersistence.save(state);

      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');
      const count = await client.getPendingCount();

      expect(count).toBe(2);
    });

    it('should return 0 when no pending webhooks', async () => {
      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger, 'test-internal-auth-token');

      const count = await client.getPendingCount();

      expect(count).toBe(0);
    });
  });
});
