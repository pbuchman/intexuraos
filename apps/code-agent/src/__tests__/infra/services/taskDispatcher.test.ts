/**
 * Tests for Task Dispatcher service with HMAC signing and worker fallback.
 *
 * Note: With per-user credentials, the dispatcher no longer stores credentials.
 * Instead, each dispatch call receives credentials via workerCredentials.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, type Logger } from '@intexuraos/common-core';
import type {
  TaskDispatcherDeps,
  DispatchWorkerCredentials,
} from '../../../domain/services/taskDispatcher.js';
import type { WorkerHealthProbe } from '../../../domain/ports/workerHealthProbe.js';
import type { WorkerHealthState } from '../../../domain/models/workerSettings.js';
import type { WorkerConfig as WorkerSettingsConfig } from '../../../domain/models/workerSettings.js';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import { generateNonce, signDispatchRequest } from '../../../infra/services/hmacSigning.js';
import { generateWebhookSecret } from '../../../domain/utils/secrets.js';

const HEALTHY_WORKER_DETAILS = {
  workerAuths: {
    claude: { status: 'active' },
    codex: { status: 'active' },
  },
  providerApiKeys: {
    MINIMAX_API_KEY: { configured: true },
    MIMO_API_KEY: { configured: true },
    DASHSCOPE_API_KEY: { configured: true },
    KIMI_API_KEY: { configured: true },
    OPENROUTER_API_KEY: { configured: true },
  },
  dockerHealthy: true,
  diskHealthy: true,
} satisfies Pick<
  Extract<WorkerHealthState, { _tag: 'healthy' }>,
  'workerAuths' | 'providerApiKeys' | 'dockerHealthy' | 'diskHealthy'
>;

/**
 * Create a mock WorkerHealthProbe with optional overrides.
 * Default: all workers report healthy with 3 available slots.
 */
function createMockHealthProbe(
  overrides?: Partial<WorkerHealthProbe>
): WorkerHealthProbe {
  return {
    probeWorker: vi.fn().mockResolvedValue({
      _tag: 'healthy',
      healthy: true,
      capacity: 5,
      running: 2,
      available: 3,
      responseTimeMs: 50,
      ...HEALTHY_WORKER_DETAILS,
    } satisfies WorkerHealthState),
    probeAllWorkers: vi.fn().mockImplementation(
      async (workers: WorkerSettingsConfig[]): Promise<Record<string, WorkerHealthState>> => {
        const results: Record<string, WorkerHealthState> = {};
        for (const w of workers) {
          results[w.name] = {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 2,
            available: 3,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          };
        }
        return results;
      }
    ),
    ...overrides,
  };
}

describe('taskDispatcherImpl', () => {
  let logger: Logger;
  let baseDeps: TaskDispatcherDeps;
  let testWorkerCredentials: DispatchWorkerCredentials;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    baseDeps = {
      logger,
      workerHealthProbe: createMockHealthProbe(),
    };

    testWorkerCredentials = {
      workers: [
        {
          name: 'home-mac',
          url: 'https://cc-mac.intexuraos.cloud',
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
          dispatchSigningSecret: 'test-dispatch-secret',
        },
        {
          name: 'cloud-vm',
          url: 'https://cc-vm.intexuraos.cloud',
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
          dispatchSigningSecret: 'test-dispatch-secret',
        },
      ],
    };

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('dispatch', () => {
    it('successfully dispatches to available worker', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dispatched).toBe(true);
        expect(result.value.workerLocation).toBe('home-mac');
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

    it('skips disabled credentials before health probing and dispatch attempts', async () => {
      const probeAllWorkers = vi.fn().mockImplementation(
        async (workers: WorkerSettingsConfig[]): Promise<Record<string, WorkerHealthState>> => {
          const worker = workers[0];
          if (worker === undefined) {
            return {};
          }
          return {
            [worker.name]: {
              _tag: 'healthy',
              healthy: true,
              capacity: 5,
              running: 0,
              available: 5,
              responseTimeMs: 50,
              ...HEALTHY_WORKER_DETAILS,
            },
          };
        }
      );
      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: createMockHealthProbe({ probeAllWorkers }),
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const [homeMac, cloudVm] = testWorkerCredentials.workers;
      if (homeMac === undefined || cloudVm === undefined) {
        throw new Error('test setup failed');
      }

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Fix the bug',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test123',
        workerCredentials: {
          workers: [
            {
              ...homeMac,
              enabled: false,
            },
            {
              ...cloudVm,
              enabled: true,
            },
          ],
        },
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      expect(probeAllWorkers).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'cloud-vm' }),
      ]);
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        'https://cc-vm.intexuraos.cloud/tasks',
        expect.any(Object)
      );
    });

    it('computes HMAC signature correctly', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

// Verify signature is deterministic for same timestamp and nonce
      const timestamp = headers['X-Dispatch-Timestamp'];
      const nonce = headers['X-Dispatch-Nonce'];
      // Body excludes workerCredentials (not sent to worker)
      const { workerCredentials: _, ...requestWithoutCredentials } = dispatchRequest;
      const body = JSON.stringify(requestWithoutCredentials);
      const crypto = await import('node:crypto');
      const message = `${timestamp}.${nonce}.${body}`;
      const expectedSignature = crypto
        .createHmac('sha256', 'test-dispatch-secret')
        .update(message)
        .digest('hex');

      expect(headers['X-Dispatch-Signature']).toBe(expectedSignature);
    });

    it('includes all required headers', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

    it('sends agentType derived from agentType for orchestrator compatibility', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'planning',
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      if (!fetchCall) throw new Error('Fetch was not called');
      const options = fetchCall[1];
      if (!options || typeof options.body !== 'string') throw new Error('Missing body');
      const body = JSON.parse(options.body) as Record<string, unknown>;
      expect(body['agentType']).toBe('planning');
    });

    it('threads executionMemoryContext for execution-agent tasks', async () => {
      const service = createTaskDispatcherService(baseDeps);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-memory-context',
        prompt: 'Fix callback route logging and tests',
        systemPromptHash: 'hash-123',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        agentType: 'execution',
        executionMemoryContext: {
          applicationId: 'app_123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Auth0 callback bug touching route logging and verification.',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'Log incoming requests when changing callback routes',
              memoryType: 'pitfall_pattern',
              score: 0.93,
              appliesWhen: 'A route handler changes auth callback request handling.',
              action: 'Update route logging and preserve request context.',
              avoid: 'Do not add the route change without request logging coverage.',
              verification: 'Cover the route with app.inject assertions.',
            },
          ],
        },
      });

      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      if (!fetchCall) throw new Error('Fetch was not called');
      const options = fetchCall[1];
      if (!options || typeof options.body !== 'string') throw new Error('Missing body');
      const body = JSON.parse(options.body) as Record<string, unknown>;

      expect(body).toMatchObject({
        taskId: 'task-memory-context',
        agentType: 'execution',
        executionMemoryContext: {
          applicationId: 'app_123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Auth0 callback bug touching route logging and verification.',
          matchedMemories: [
            {
              memoryId: 'mem_142',
              title: 'Log incoming requests when changing callback routes',
              memoryType: 'pitfall_pattern',
              score: 0.93,
              appliesWhen: 'A route handler changes auth callback request handling.',
              action: 'Update route logging and preserve request context.',
              avoid: 'Do not add the route change without request logging coverage.',
              verification: 'Cover the route with app.inject assertions.',
            },
          ],
        },
      });
    });

    it('falls back to second worker on 503', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // First call (home-mac) returns 503
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { code: '503' }));

      // Second call (cloud-vm) succeeds
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('cloud-vm');
      }

      // Should have tried both workers
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns at_capacity when all workers return 503', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('at_capacity');
      }
    });

    it('returns Codex auth blocker metadata before attempting worker dispatch', async () => {
      const codexAuthUnavailable = {
        ...HEALTHY_WORKER_DETAILS,
        workerAuths: {
          claude: { status: 'active' },
          codex: { status: 'expired' },
        },
      } satisfies Pick<
        Extract<WorkerHealthState, { _tag: 'healthy' }>,
        'workerAuths' | 'providerApiKeys' | 'dockerHealthy' | 'diskHealthy'
      >;
      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 0,
            available: 5,
            responseTimeMs: 50,
            ...codexAuthUnavailable,
          },
          'cloud-vm': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 0,
            available: 5,
            responseTimeMs: 50,
            ...codexAuthUnavailable,
          },
        } satisfies Record<string, WorkerHealthState>),
      });
      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      const result = await service.dispatch({
        taskId: 'task-codex-auth',
        prompt: 'Test codex auth',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'codex-xhigh',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'worker_unavailable',
          blocker: {
            reason: 'codex_auth_unavailable',
            workerNames: ['home-mac', 'cloud-vm'],
          },
        });
      }
      expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
    });

    it('returns error when worker rejects task', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        dispatchAttemptId: '00000000-0000-4000-8000-000000000002',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          dispatchAttemptId: '00000000-0000-4000-8000-000000000002',
          reason: 'Worker overloaded',
          _skipSentry: true,
        }),
        'Worker rejected task',
      );
    });

    it.each([500, 501, 599])(
      'treats non-contractual HTTP %i after POST as an unknown outcome',
      async (status) => {
      const service = createTaskDispatcherService(baseDeps);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status,
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'network_error',
          outcomeUnknown: true,
          workerLocation: 'home-mac',
        });
        expect(result.error.message).toContain(`HTTP ${String(status)}`);
      }
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('returns error for 401 unauthorized from worker', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('dispatch_failed');
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('retains the claim when a successful worker POST returns invalid JSON', async () => {
      const service = createTaskDispatcherService(baseDeps);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        headers: new Headers(),
        status: 200,
        statusText: 'OK',
        url: 'https://test.com',
      } as unknown as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'network_error',
          outcomeUnknown: true,
          workerLocation: 'home-mac',
        });
        expect(result.error.message).toContain('invalid JSON');
      }
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retains the claim when a successful worker POST returns an unknown response shape', async () => {
      const service = createTaskDispatcherService(baseDeps);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queued: true }),
      } as unknown as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result).toEqual(err({
        code: 'network_error',
        message: 'Worker returned an unknown response after the dispatch POST',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retains the claim when a successful worker POST returns a non-object body', async () => {
      const service = createTaskDispatcherService(baseDeps);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      } as unknown as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result).toEqual(err({
        code: 'network_error',
        message: 'Worker returned an unknown response after the dispatch POST',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('returns error when dispatchSigningSecret is empty', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const credentialsWithEmptySecret: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: '',
          },
        ],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        dispatchAttemptId: '00000000-0000-4000-8000-000000000003',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: credentialsWithEmptySecret,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // When signing fails for all workers, they're all skipped and treated as unavailable
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('all rejected or busy');
      }
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          dispatchAttemptId: '00000000-0000-4000-8000-000000000003',
          _skipSentry: true,
        }),
        'Failed to sign dispatch request',
      );
    });

    it('covers 503 error handling code path (Response with status 503)', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        dispatchAttemptId: '00000000-0000-4000-8000-000000000004',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('cloud-vm');
      }
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          dispatchAttemptId: '00000000-0000-4000-8000-000000000004',
          error: expect.any(Error),
          _skipSentry: true,
        }),
        'Failed to dispatch to worker',
      );
    });

    it('does not fall back after an ambiguous 502 response to the worker POST', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // First call returns 502 (bad gateway / worker down)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad Gateway' }),
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'network_error',
          outcomeUnknown: true,
        });
        expect(result.error.message).toContain('HTTP 502');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not fall back after an ambiguous 504 response to the worker POST', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({ error: 'Gateway Timeout' }),
      } as Response);

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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
        expect(result.error.message).toContain('HTTP 504');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('stops after the first worker returns ambiguous 502', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('stops on ambiguous 502 after a definite capacity rejection', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // home-mac returns 503 (at capacity)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
      // cloud-vm returns 502 (infrastructure error — neutral)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
      }
    });

    it('stops on ambiguous 504 after a definite capacity rejection', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // home-mac returns 503
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
      // cloud-vm returns 504 (gateway timeout — neutral)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
      }
    });

    it('does not fall back after an ambiguous Cloudflare 530 response', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // First call returns 530 (Cloudflare origin error)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 530,
        json: async () => ({ error: 'Origin DNS Error' }),
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
        expect(result.error.message).toContain('HTTP 530');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not fall back after an ambiguous Cloudflare 520 response', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // First call returns 520 (Cloudflare Web Server Returned an Unknown Error)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 520,
        json: async () => ({ error: 'Unknown Error' }),
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
        expect(result.error.message).toContain('HTTP 520');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('stops after the first worker returns ambiguous Cloudflare 530', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 530, json: async () => ({}) } as Response);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 530, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('stops on ambiguous Cloudflare 530 after a definite capacity rejection', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // home-mac returns 503 (at capacity)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
      // cloud-vm returns 530 (Cloudflare error — neutral like 502/504)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 530, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network_error');
      }
    });

    it('returns worker_unavailable when 503 mixed with explicit rejection', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // home-mac returns 503 (at capacity)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);
      // cloud-vm returns 200 but rejects the task
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'rejected', reason: 'Worker overloaded' }),
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }
    });

    it('returns worker_unavailable when HMAC failure mixed with 503', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // Use credentials where first worker has empty signing secret (HMAC fail)
      // and second worker returns 503
      const mixedCredentials: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: '', // Will cause HMAC failure
          },
          {
            name: 'cloud-vm',
            url: 'https://cc-vm.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

      // cloud-vm returns 503
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: mixedCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
      }
    });

    it('includes linearIssueId when provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

    it('includes trackingCommentId in body when provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
        trackingCommentId: '12345',
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) throw new Error('Fetch was not called');
      const options = fetchCall[1];
      if (!options) throw new Error('Fetch options not found');
      const body = JSON.parse(options.body as string) as Record<string, unknown>;

      expect(body['trackingCommentId']).toBe('12345');
    });

    it('includes continuation PR metadata in body when provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'Continue existing PR work',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        continuationPrNumber: 1139,
        continuationPrBranch: 'task_existing_pr_branch',
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) throw new Error('Fetch was not called');
      const options = fetchCall[1];
      if (!options) throw new Error('Fetch options not found');
      const body = JSON.parse(options.body as string) as Record<string, unknown>;

      expect(body['continuationPrNumber']).toBe(1139);
      expect(body['continuationPrBranch']).toBe('task_existing_pr_branch');
    });

    it('includes prNumber in body when provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      await service.dispatch({
        taskId: 'task-123',
        prompt: 'PR task',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        agentType: 'pull_request',
        prNumber: 42,
      });

      const fetchCall = mockFetch.mock.calls[0];
      if (!fetchCall) throw new Error('Fetch was not called');
      const options = fetchCall[1];
      if (!options) throw new Error('Fetch options not found');
      const body = JSON.parse(options.body as string) as Record<string, unknown>;

      expect(body['prNumber']).toBe(42);
    });

    it('omits linearIssueId when undefined', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

    it('includes traceId in headers when provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        traceId: 'test-trace-id-123',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

      expect(headers['X-Trace-Id']).toBe('test-trace-id-123');
    });

    it('omits traceId header when not provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
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
        // traceId not provided
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
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

      expect(headers['X-Trace-Id']).toBeUndefined();
    });

    it('returns network_error on fetch failure', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      // Mock fetch to throw a non-503 error
      mockFetch.mockRejectedValueOnce(new Error('Network connection failed'));

      const result = await service.dispatch({
        taskId: 'task-123',
        dispatchAttemptId: '00000000-0000-4000-8000-000000000005',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'network_error',
          outcomeUnknown: true,
          workerLocation: 'home-mac',
        });
        expect(result.error.message).toContain('Network error');
        expect(result.error.message).toContain('Network connection failed');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          dispatchAttemptId: '00000000-0000-4000-8000-000000000005',
          error: expect.any(Error),
          _skipSentry: true,
        }),
        'Failed to dispatch to worker',
      );
    });

    it('does not treat transport error text containing 503 as a safe capacity rejection', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('socket closed by upstream node worker-503'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-transport-503-text',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result).toEqual(err({
        code: 'network_error',
        message: 'Network error: socket closed by upstream node worker-503',
        outcomeUnknown: true,
        workerLocation: 'home-mac',
      }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not fall back after a worker POST times out', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
      mockFetch.mockRejectedValueOnce(timeoutError);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-timeout',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          code: 'network_error',
          outcomeUnknown: true,
          workerLocation: 'home-mac',
        });
        expect(result.error.message).toContain('timeout');
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses empty string for missing CF credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const credentialsWithEmptyCF: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: '',
            cfAccessClientSecret: '',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

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
        workerCredentials: credentialsWithEmptyCF,
        linearIssueLabels: [],
        hasChildren: false,
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

  describe('getWorkerConfigsFromCredentials', () => {
    it('returns error when no workers configured in credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const emptyCredentials: DispatchWorkerCredentials = {
        workers: [],
      };

      const result = await service.dispatch({
        taskId: 'task-123',
        prompt: 'Test',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: emptyCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error).toMatchObject({
          message: 'No enabled code-task workers are configured for opus.',
          blocker: { reason: 'no_enabled_workers' },
        });
      }
    });

    it('uses only home-mac worker when cloud-vm not in credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const macOnlyCredentials: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

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
        workerCredentials: macOnlyCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('home-mac');
      }

      // Only one call since cloud-vm is not configured
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });

    it('uses only cloud-vm worker when home-mac not in credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const vmOnlyCredentials: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'cloud-vm',
            url: 'https://cc-vm.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

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
        workerCredentials: vmOnlyCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('cloud-vm');
      }
    });

    it('respects priority order in credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const vmFirstCredentials: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'cloud-vm',
            url: 'https://cc-vm.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

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
        workerCredentials: vmFirstCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('cloud-vm');
      }

      // Should have called cloud-vm first due to priority
      expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
        'https://cc-vm.intexuraos.cloud/tasks',
        expect.any(Object)
      );
    });
  });

  describe('generateWebhookSecret', () => {
    it('generates deterministic secret from sharedSecret and taskId', () => {
      const secret1 = generateWebhookSecret('test-secret', 'task-1');
      const secret2 = generateWebhookSecret('test-secret', 'task-1');

      // Same inputs produce same output
      expect(secret1).toBe(secret2);
      expect(secret1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('generates different secrets for different taskIds', () => {
      const secret1 = generateWebhookSecret('test-secret', 'task-1');
      const secret2 = generateWebhookSecret('test-secret', 'task-2');

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
    it('returns error when dispatchSigningSecret is empty', () => {
      const result = signDispatchRequest(
        { logger, dispatchSigningSecret: '' },
        { body: '{"test": "body"}', timestamp: Date.now(), nonce: generateNonce() }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('missing_secret');
      }
    });

    it('generates correct HMAC signature', () => {
      const body = '{"test": "body"}';
      const timestamp = 1234567890;
      const nonce = 'fixed-nonce-for-test';

      const result = signDispatchRequest(
        { logger, dispatchSigningSecret: 'test-dispatch-secret' },
        { body, timestamp, nonce }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timestamp).toBe(timestamp);
        // Signature is now based on timestamp.nonce.body
        expect(result.value.signature).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('generates different signatures for different inputs', () => {
      const timestamp = Date.now();
      const dispatchSigningSecret = 'test-dispatch-secret';

      const result1 = signDispatchRequest(
        { logger, dispatchSigningSecret },
        { body: '{"test": "body1"}', timestamp, nonce: generateNonce() }
      );
      const result2 = signDispatchRequest(
        { logger, dispatchSigningSecret },
        { body: '{"test": "body2"}', timestamp, nonce: generateNonce() }
      );

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.value.signature).not.toBe(result2.value.signature);
      }
    });
  });

  describe('cancelOnWorker', () => {
    it('sends DELETE request to worker with credentials', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const credentials = {
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      };

      await service.cancelOnWorker('task-123', 'mac', credentials);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cc-mac.intexuraos.cloud/tasks/task-123',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'CF-Access-Client-Id': 'test-client-id',
            'CF-Access-Client-Secret': 'test-client-secret',
          }),
        })
      );
    });

    it('rejects cancellation when no credentials are provided', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);

      await expect(service.cancelOnWorker('task-123', 'mac')).rejects.toThrow(
        'Worker cancellation credentials unavailable',
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123' }),
        expect.stringContaining('No credentials')
      );
    });

    it('logs and rejects on cancellation transport failure', async () => {
      const service = createTaskDispatcherService(baseDeps);
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const credentials = {
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      };

      await expect(service.cancelOnWorker('task-123', 'mac', credentials)).rejects.toThrow(
        'Network error',
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          error: expect.stringContaining('Network error'),
        }),
        expect.any(String)
      );
    });
  });

  describe('capacity-aware dispatch', () => {
    it('dispatches to worker with more available capacity', async () => {
      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 4,
            available: 1,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          },
          'cloud-vm': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 1,
            available: 4,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          },
        } satisfies Record<string, WorkerHealthState>),
      });

      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-cap-1',
        prompt: 'Test capacity',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // cloud-vm has 4 available vs home-mac's 1, so it should be tried first
        expect(result.value.workerLocation).toBe('cloud-vm');
      }

      // Verify fetch was called with cloud-vm's URL (sorted first by capacity)
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
      const fetchUrl = vi.mocked(global.fetch).mock.calls[0]?.[0];
      expect(fetchUrl).toBe('https://cc-vm.intexuraos.cloud/tasks');
    });

    it('uses priority as tiebreaker when capacity is equal', async () => {
      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 2,
            available: 3,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          },
          'cloud-vm': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 2,
            available: 3,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          },
        } satisfies Record<string, WorkerHealthState>),
      });

      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-cap-2',
        prompt: 'Test tiebreak',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Equal capacity, home-mac has priority 1 (first in array), cloud-vm has priority 2
        expect(result.value.workerLocation).toBe('home-mac');
      }
    });

    it('excludes workers with failed health probes', async () => {
      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'tunnel-down',
            healthy: false,
            reason: 'connection-refused',
            code: 'ECONNREFUSED',
          },
          'cloud-vm': {
            _tag: 'healthy',
            healthy: true,
            capacity: 5,
            running: 1,
            available: 4,
            responseTimeMs: 50,
            ...HEALTHY_WORKER_DETAILS,
          },
        } satisfies Record<string, WorkerHealthState>),
      });

      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-cap-3',
        prompt: 'Test probe exclusion',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // home-mac failed probe, only cloud-vm is available
        expect(result.value.workerLocation).toBe('cloud-vm');
      }

      // Only one fetch call (to cloud-vm)
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
      const fetchUrl = vi.mocked(global.fetch).mock.calls[0]?.[0];
      expect(fetchUrl).toBe('https://cc-vm.intexuraos.cloud/tasks');
    });

    it('returns worker_unavailable when all health probes fail', async () => {
      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'tunnel-down',
            healthy: false,
            reason: 'dns-failed',
          },
          'cloud-vm': {
            _tag: 'orchestrator-unreachable',
            healthy: false,
            reason: 'timeout',
          },
        } satisfies Record<string, WorkerHealthState>),
      });

      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      const result = await service.dispatch({
        taskId: 'task-cap-4',
        prompt: 'Test all probes fail',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: testWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error).toMatchObject({
          message: 'No configured workers are reachable for opus.',
          blocker: { reason: 'workers_unreachable', workerNames: ['home-mac', 'cloud-vm'] },
        });
      }

      // No dispatch attempt should be made
      expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
    });

    it('works correctly with a single worker', async () => {
      const singleWorkerCredentials: DispatchWorkerCredentials = {
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-dispatch-secret',
          },
        ],
      };

      const mockProbe = createMockHealthProbe({
        probeAllWorkers: vi.fn().mockResolvedValue({
          'home-mac': {
            _tag: 'healthy',
            healthy: true,
            capacity: 3,
            running: 0,
            available: 3,
            responseTimeMs: 30,
            ...HEALTHY_WORKER_DETAILS,
          },
        } satisfies Record<string, WorkerHealthState>),
      });

      const service = createTaskDispatcherService({
        ...baseDeps,
        workerHealthProbe: mockProbe,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'accepted' }),
      } as Response);

      const result = await service.dispatch({
        taskId: 'task-cap-5',
        prompt: 'Test single worker',
        systemPromptHash: 'abc123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'whsec_test',
        workerCredentials: singleWorkerCredentials,
        linearIssueLabels: [],
        hasChildren: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('home-mac');
      }
    });
  });
});
