/**
 * Tests for Task Dispatcher service with HMAC signing and worker fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import { generateNonce, generateWebhookSecret, signDispatchRequest } from '../../../infra/services/hmacSigning.js';

describe('taskDispatcherImpl', () => {
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
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('dispatch', () => {
    it('successfully dispatches to available worker', async () => {
      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Fix the bug',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dispatched).toBe(true);
        expect(result.value.workerLocation).toBe('mac');
      }

      // Verify fetch was called with correct headers
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        'https://cc-mac.intexuraos.cloud/tasks',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'CF-Access-Client-Id': 'test-client-id',
            'CF-Access-Client-Secret': 'test-client-secret',
            'X-Dispatch-Timestamp': expect.any(String),
            'X-Dispatch-Signature': expect.any(String),
            'X-Dispatch-Nonce': expect.any(String),
          }),
        })
      );
    });

    it('computes HMAC signature correctly', async () => {
      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const dispatchRequest = {
        taskId: 'task-123',
        prompt: 'Fix the bug',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus' as const,
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test123',
      };

      await service.dispatch(dispatchRequest);

      // Get the fetch call arguments
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      if (!fetchCall) {
        throw new Error('Fetch was not called');
      }
      const options = fetchCall[1];
      if (!options) {
        throw new Error('Fetch options not found');
      }
      const headers = options.headers as Record<string, string>;

      // Verify signature format
      expect(headers['X-Dispatch-Signature']).toMatch(/^[a-f0-99]{64}$/);
      expect(headers['X-Dispatch-Timestamp']).toMatch(/^\d+$/);
      expect(headers['X-Dispatch-Nonce']).toMatch(/^[a-f0-99-]{8}-[a-f0-9-9]{4}-[a-f0-9-9]{4}-[a-f0-9-9]{4}-[a-f0-9-9]{12}$/);

      // Verify signature is deterministic for same timestamp
      const timestamp = headers['X-Dispatch-Timestamp'];
      const body = JSON.stringify(dispatchRequest);
      const crypto = await import('node:crypto');
      const message = `${timestamp}.${body}`;
      const expectedSignature = crypto
        .createHmac('sha256', 'test-dispatch-secret')
        .update(message)
        .digest('hex');

      expect(headers['X-Dispatch-Signature']).toBe(expectedSignature);
    });

    it('includes all required headers', async () => {
      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      if (!fetchCall) {
        throw new Error('Fetch was not called');
      }
      const options = fetchCall[1];
      if (!options) {
        throw new Error('Fetch options not found');
      }
      const headers = options.headers as Record<string, string>;

      // Verify all required headers
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['CF-Access-Client-Id']).toBe('test-client-id');
      expect(headers['CF-Access-Client-Secret']).toBe('test-client-secret');
      expect(headers['X-Dispatch-Timestamp']).toBeDefined();
      expect(headers['X-Dispatch-Signature']).toBeDefined();
      expect(headers['X-Dispatch-Nonce']).toBeDefined();
    });

    it('falls back to second worker on 503', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);

      // First call (Mac) returns 503
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { code: '503' }));

      // Second call (VM) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('vm');
      }

      // Should have tried both workers
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns error when all workers fail', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);

      // Both workers return 503
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { code: '503' }));
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { code: '503' }));

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }
    });

    it('returns error when worker rejects task', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'rejected', reason: 'Worker overloaded' }),
      } as Response);

      // Second worker also rejects
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'rejected', reason: 'Worker shutting down' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }
    });

    it('returns error for non-503 HTTP errors during dispatch', async () => {
      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('dispatch_failed');
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error for 401 unauthorized from worker', async () => {
      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('dispatch_failed');
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error when signDispatchRequest fails (missing dispatch secret)', async () => {
      // Delete dispatch secret to trigger signDispatchRequest failure
      delete process.env['INTEXURAOS_DISPATCH_SECRET'];

      const service = createTaskDispatcherService({ logger });
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('dispatch_failed');
        expect(result.error.message).toContain('INTEXURAOS_DISPATCH_SECRET');
      }
    });

    it('covers 503 error handling code path (Response with status 503)', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);

      // First call returns Response with status 503 (not rejected)
      // This hits lines 194-197: creating error with code='503'
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      } as Response);

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('vm');
      }
    });

    it('includes linearIssueId when provided', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        linearIssueId: 'INT-123',
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) {
        throw new Error('Fetch was not called');
      }
      const options = fetchCall[1];
      if (!options) {
        throw new Error('Fetch options not found');
      }
      const body = JSON.parse(options.body as string);

      expect(body.linearIssueId).toBe('INT-123');
    });

    it('omits linearIssueId when undefined', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        // linearIssueId not provided
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) {
        throw new Error('Fetch was not called');
      }
      const options = fetchCall[1];
      if (!options) {
        throw new Error('Fetch options not found');
      }
      const body = JSON.parse(options.body as string);

      expect(body.linearIssueId).toBeUndefined();
    });

    it('returns network_error on fetch failure', async () => {
      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);

      // Mock fetch to throw a non-503 error
      mockFetch.mockRejectedValueOnce(new Error('Network connection failed'));

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
        expect(result.error.message).toContain('Network error');
        expect(result.error.message).toContain('Network connection failed');
      }
    });

    it('uses empty string for missing CF credentials', async () => {
      // Delete CF credentials from env
      delete process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'];
      delete process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'];

      const service = createTaskDispatcherService({ logger });
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) {
        throw new Error('Fetch was not called');
      }
      const options = fetchCall[1];
      if (!options) {
        throw new Error('Fetch options not found');
      }
      const headers = options.headers as Record<string, string>;

      expect(headers['CF-Access-Client-Id']).toBe('');
      expect(headers['CF-Access-Client-Secret']).toBe('');
    });
  });

  describe('getWorkerConfigs', () => {
    it('returns empty array when INTEXURAOS_CODE_WORKERS not set', () => {
      delete process.env['INTEXURAOS_CODE_WORKERS'];

      // Service should initialize but have no workers
      // This will cause dispatch to fail with worker_unavailable
      createTaskDispatcherService({ logger });
    });

    it('returns empty array when INTEXURAOS_CODE_WORKERS is empty string', () => {
      process.env['INTEXURAOS_CODE_WORKERS'] = '';

      // Service should initialize but have no workers
      createTaskDispatcherService({ logger });
    });

    it('dispatch fails when no workers available', async () => {
      // Set empty workers env var
      process.env['INTEXURAOS_CODE_WORKERS'] = '';

      const service = createTaskDispatcherService({ logger });

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('No workers available');
      }
    });
  });

  describe('generateWebhookSecret', () => {
    it('generates unique webhook secret per task', () => {
      const secret1 = generateWebhookSecret();
      const secret2 = generateWebhookSecret();

      // Verify format: whsec_{48 hex chars}
      expect(secret1).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(secret2).toMatch(/^whsec_[a-f0-9]{48}$/);

      // Verify uniqueness
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('generateNonce', () => {
    it('generates unique nonce per request', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      // Verify UUID v4 format
      expect(nonce1).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
      expect(nonce2).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);

      // Verify uniqueness
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('signDispatchRequest', () => {
    it('returns error when INTEXURAOS_DISPATCH_SECRET is not set', () => {
      delete process.env['INTEXURAOS_DISPATCH_SECRET'];

      const result = signDispatchRequest(
        { logger },
        { body: '{"test": "body"}', timestamp: Date.now() }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_secret');
      }
    });

    it('generates correct HMAC signature', () => {
      const body = '{"test": "body"}';
      const timestamp = 1234567890;

      const result = signDispatchRequest({ logger }, { body, timestamp });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timestamp).toBe(timestamp);
        expect(result.value.signature).toBe('bdeafe056de274fbde7d3c2c028b1eb2a41f5f37f4bb203e1527f8e565f2e331');

        // Verify signature format
        expect(result.value.signature).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('generates different signatures for different inputs', () => {
      const timestamp = Date.now();

      const result1 = signDispatchRequest({ logger }, { body: '{"test": "body1"}', timestamp });
      const result2 = signDispatchRequest({ logger }, { body: '{"test": "body2"}', timestamp });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });
  });
});
