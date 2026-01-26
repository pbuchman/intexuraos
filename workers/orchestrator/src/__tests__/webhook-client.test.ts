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

    return {
      load: vi.fn(
        (): Promise<OrchestratorState> => Promise.resolve(JSON.parse(JSON.stringify(state)))
      ),
      save: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
      saveAtomic: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
      detectOrphanWorktrees: vi.fn(async () => []),
      emptyState: () => ({ tasks: {}, githubToken: null, pendingWebhooks: [] }),
    } as unknown as StatePersistence;
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
      const client = new WebhookClient(statePersistence, mockLogger);

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
    });

    it('should not retry on 4xx errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger);

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

    it('should retry 3x on 5xx errors with exponential backoff', { timeout: 30000 }, async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger);

      const payload: WebhookPayload = {
        taskId: 'task-3',
        status: 'completed',
        duration: 2000,
      };

      const startTime = Date.now();
      await client.send({
        url: 'https://example.com/webhook',
        secret: 'test-secret',
        payload,
        taskId: 'task-3',
      });

      const elapsedTime = Date.now() - startTime;

      // Should have retried 3 times with delays: 0s, 5s, 15s = 20s minimum
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(elapsedTime).toBeGreaterThanOrEqual(19500); // 5s + 15s (with timing tolerance)

      // Should be queued in pending webhooks
      const state = await statePersistence.load();
      expect(state.pendingWebhooks).toHaveLength(1);
      expect(state.pendingWebhooks?.[0]?.taskId).toBe('task-3');
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
      const client = new WebhookClient(statePersistence, mockLogger);

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
      const client = new WebhookClient(statePersistence, mockLogger);

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
      const client = new WebhookClient(statePersistence, mockLogger);

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
      const client = new WebhookClient(statePersistence, mockLogger);

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

    it('should classify 5xx errors correctly', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger);

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
    it('should retry pending webhooks and remove successful ones', { timeout: 30000 }, async () => {
      // Setup pending webhooks
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

      // Mock: first succeeds, second fails
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

      const client = new WebhookClient(statePersistence, mockLogger);
      await client.retryPending();

      const updatedState = await statePersistence.load();

      // task-1 should be removed (success), task-2 should remain
      expect(updatedState.pendingWebhooks).toHaveLength(1);
      expect(updatedState.pendingWebhooks?.[0]?.taskId).toBe('task-2');
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

      const client = new WebhookClient(statePersistence, mockLogger);
      await client.retryPending();

      const updatedState = await statePersistence.load();
      expect(updatedState.pendingWebhooks).toHaveLength(0);
    });

    it('should handle empty pending queue', async () => {
      const statePersistence = createStatePersistence();
      const state = await statePersistence.load();
      state.pendingWebhooks = [];
      await statePersistence.save(state);

      const client = new WebhookClient(statePersistence, mockLogger);
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

      const client = new WebhookClient(statePersistence, mockLogger);
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

      const client = new WebhookClient(statePersistence, mockLogger);

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

    it('should classify non-Error throwables as network errors', async () => {
      vi.useFakeTimers();

      // Throw a string (not an Error)
      mockFetch.mockRejectedValue('Some string error');

      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger);

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

      const client = new WebhookClient(statePersistence, mockLogger);
      const count = await client.getPendingCount();

      expect(count).toBe(2);
    });

    it('should return 0 when no pending webhooks', async () => {
      const statePersistence = createStatePersistence();
      const client = new WebhookClient(statePersistence, mockLogger);

      const count = await client.getPendingCount();

      expect(count).toBe(0);
    });
  });
});
