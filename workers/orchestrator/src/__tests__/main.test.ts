/**
 * Comprehensive tests for orchestrator main.ts entry point.
 * Tests service lifecycle, startup recovery, background jobs, and shutdown handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorConfig } from '../types/config.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { WebhookClient } from '../services/webhook-client.js';
import type { HeartbeatManager } from '../heartbeat.js';
import type { Logger } from '@intexuraos/common-core';
import type { OrchestratorState } from '../types/state.js';
import type { IsolationProvider, DiscoveredContainer } from '../services/isolation/types.js';

// Mock Fastify to avoid actual server startup
vi.mock('fastify', () => ({
  default: vi.fn(() => ({
    register: vi.fn(),
    listen: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  })),
}));

// Mock CORS
vi.mock('@fastify/cors', () => ({
  default: vi.fn(() => vi.fn()),
}));

// Mock routes to avoid importing them
vi.mock('../routes.js', () => ({
  registerRoutes: vi.fn(),
}));

// Create a mock exit function that we can control
const mockExit = vi.fn();

// Mock node:process to control the exit function
vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:process')>();
  return {
    ...actual,
    exit: mockExit,
  };
});

describe('main.ts', () => {
  const mockConfig: OrchestratorConfig = {
    port: 8100,
    capacity: 5,
    taskTimeoutMs: 7200000,
    stateFilePath: '/tmp/state.json',
    worktreeBasePath: '/tmp/worktrees',
    logBasePath: '/tmp/logs',
    codeAgentUrl: 'http://localhost:8080',
    githubAppId: 'test-app-id',
    githubAppPrivateKeyPath: '/tmp/key.pem',
    githubInstallationId: 'test-installation-id',
    orchestratorSecret: 'test-secret',
    secretsBasePath: '/tmp/secrets',
  };

  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockStatePersistence = {
    load: vi.fn<() => Promise<OrchestratorState>>(),
    save: vi.fn<(state: OrchestratorState) => Promise<void>>(),
    saveAtomic: vi.fn<(state: OrchestratorState) => Promise<void>>(),
    modify: vi.fn<(fn: (s: OrchestratorState) => void | Promise<void>) => Promise<void>>(),
    detectOrphanWorktrees: vi.fn<() => Promise<string[]>>(),
  } as unknown as StatePersistence;

  const mockDispatcher: TaskDispatcher = {
    submitTask: vi.fn(),
    cancelTask: vi.fn(),
    getTask: vi.fn(),
    getRunningCount: vi.fn(() => 0),
    getCapacity: vi.fn(() => 5),
    adoptTask: vi.fn(),
    recoverPendingResumeTask: vi.fn(),
  } as unknown as TaskDispatcher;

  const mockListWorkerContainers = vi.fn<() => Promise<DiscoveredContainer[]>>();
  const mockIsolationProvider: IsolationProvider = {
    createWorker: vi.fn(),
    destroyWorker: vi.fn(),
    isWorkerRunning: vi.fn(),
    getWorkerLogs: vi.fn(),
    streamLogs: vi.fn(),
    waitForCompletion: vi.fn(),
    getResourceUsage: vi.fn(),
    listWorkers: vi.fn(),
    listWorkerContainers: mockListWorkerContainers,
  } as unknown as IsolationProvider;

  const mockTokenService: GitHubTokenService = {
    refreshToken: vi.fn(),
    getToken: vi.fn(),
  } as unknown as GitHubTokenService;

  const mockWebhookClient: WebhookClient = {
    send: vi.fn(),
    retryPending: vi.fn(),
    getPendingCount: vi.fn(),
  } as unknown as WebhookClient;

  const mockHeartbeatManager: HeartbeatManager = {
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as HeartbeatManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup default mock implementations
    vi.mocked(mockStatePersistence.load).mockResolvedValue({
      tasks: {},
      githubToken: null,
      pendingWebhooks: [],
    });
    vi.mocked(mockStatePersistence.save).mockResolvedValue(undefined);
    vi.mocked(mockTokenService.refreshToken).mockResolvedValue({
      ok: true,
      value: 'new-token',
    });
    vi.mocked(mockWebhookClient.send).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(mockWebhookClient.retryPending).mockResolvedValue(undefined);
    vi.mocked(mockDispatcher.adoptTask).mockResolvedValue({ ok: true, value: undefined });
    vi.mocked(mockDispatcher.recoverPendingResumeTask).mockResolvedValue({ ok: true, value: undefined });
    mockListWorkerContainers.mockResolvedValue([]);
    vi.mocked(mockIsolationProvider.destroyWorker).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getServiceStatus', () => {
    it('should return "initializing" status when service not started', async () => {
      const { getServiceStatus } = await import('../main.js');

      const status = getServiceStatus();

      expect(status).toBe('initializing');
    });
  });

  describe('runStartupRecovery', () => {
    it('should log when no interrupted tasks found', async () => {
      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });

      // Exit will be called, catch it
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Check that recovery was logged
      const infoCalls = vi.mocked(mockLogger.info).mock.calls;
      const recoveryCall = infoCalls.find((call) => {
        const firstArg = call[0] as { message?: string } | undefined;
        return (
          firstArg?.message === 'Running startup recovery' || call[1] === 'Running startup recovery'
        );
      });
      expect(recoveryCall).toBeDefined();

      const noInterruptedCall = infoCalls.find((call) => {
        const firstArg = call[0] as { message?: string } | undefined;
        return (
          firstArg?.message === 'No interrupted tasks to recover' ||
          call[1] === 'No interrupted tasks to recover'
        );
      });
      expect(noInterruptedCall).toBeDefined();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should notify webhook client for each interrupted task', async () => {
      const interruptedTask = {
        taskId: 'interrupted-1',
        workerType: 'opus' as const,
        prompt: 'Test prompt',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'session-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {
          'interrupted-1': interruptedTask,
        },
        githubToken: null,
        pendingWebhooks: [],
      });

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(mockWebhookClient.send).toHaveBeenCalledWith({
        url: 'https://example.com/webhook',
        secret: 'secret',
        payload: {
          taskId: 'interrupted-1',
          status: 'interrupted',
          duration: 0,
        },
        taskId: 'interrupted-1',
      });

      expect(mockStatePersistence.save).toHaveBeenCalled();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should handle webhook send error gracefully', async () => {
      const interruptedTask = {
        taskId: 'interrupted-1',
        workerType: 'opus' as const,
        prompt: 'Test prompt',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'session-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {
          'interrupted-1': interruptedTask,
        },
        githubToken: null,
        pendingWebhooks: [],
      });

      vi.mocked(mockWebhookClient.send).mockRejectedValue(new Error('Webhook send failed'));

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'interrupted-1',
          error: expect.any(Error),
        }),
        'Failed to notify code-agent of interrupted task'
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should only recover tasks with "running" status', async () => {
      const runningTask = {
        taskId: 'running-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'session-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      const completedTask = {
        taskId: 'completed-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'completed' as const,
        containerId: 'session-2',
        worktreePath: '/path/to/worktree2',
        startedAt: '2025-01-26T00:00:00.000Z',
        completedAt: '2025-01-26T01:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {
          'running-1': runningTask,
          'completed-1': completedTask,
        },
        githubToken: null,
        pendingWebhooks: [],
      });

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Should only notify for running task
      expect(mockWebhookClient.send).toHaveBeenCalledTimes(1);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'running-1',
          }),
        })
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should handle multiple interrupted tasks', async () => {
      const task1 = {
        taskId: 'interrupted-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook1',
        webhookSecret: 'secret1',
        status: 'running' as const,
        containerId: 'session-1',
        worktreePath: '/path/to/worktree1',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      const task2 = {
        taskId: 'interrupted-2',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook2',
        webhookSecret: 'secret2',
        status: 'running' as const,
        containerId: 'session-2',
        worktreePath: '/path/to/worktree2',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {
          'interrupted-1': task1,
          'interrupted-2': task2,
        },
        githubToken: null,
        pendingWebhooks: [],
      });

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(mockLogger.info).toHaveBeenCalledWith({ count: 2 }, 'Found interrupted tasks');
      expect(mockWebhookClient.send).toHaveBeenCalledTimes(2);

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should adopt running container with matching state', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'container-1', taskId: 'task-1', state: 'running' },
      ]);

      vi.mocked(mockDispatcher.adoptTask).mockResolvedValue({ ok: true, value: undefined });

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockDispatcher.adoptTask).toHaveBeenCalledWith(runningTask);
      expect(mockWebhookClient.send).not.toHaveBeenCalled();
    });

    it('should recover a pending accepted resume instead of interrupting it when no container is discovered', async () => {
      const pendingResumeTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Original prompt',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: '',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
        pendingResumeStart: {
          prompt: '[RESUME PRE-FLIGHT]\nUser follow-up message',
          acceptedAt: '2025-01-26T00:05:00.000Z',
        },
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': pendingResumeTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockDispatcher.recoverPendingResumeTask).toHaveBeenCalledWith(pendingResumeTask);
      expect(mockDispatcher.adoptTask).not.toHaveBeenCalled();
      expect(mockWebhookClient.send).not.toHaveBeenCalled();
    });

    it('should recover a pending accepted resume instead of adopting directly when a live container is discovered', async () => {
      const pendingResumeTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Original prompt',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: '',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
        pendingResumeStart: {
          prompt: '[RESUME PRE-FLIGHT]\nUser follow-up message',
          acceptedAt: '2025-01-26T00:05:00.000Z',
        },
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': pendingResumeTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'container-1', taskId: 'task-1', state: 'running' },
      ]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockDispatcher.recoverPendingResumeTask).toHaveBeenCalledWith(pendingResumeTask);
      expect(mockDispatcher.adoptTask).not.toHaveBeenCalled();
      expect(mockWebhookClient.send).not.toHaveBeenCalled();
    });

    it('should mark a pending accepted resume interrupted when recovery returns an error result', async () => {
      const pendingResumeTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Original prompt',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: '',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
        pendingResumeStart: {
          prompt: '[RESUME PRE-FLIGHT]\nUser follow-up message',
          acceptedAt: '2025-01-26T00:05:00.000Z',
        },
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': pendingResumeTask },
        githubToken: null,
        pendingWebhooks: [],
      });
      vi.mocked(mockDispatcher.recoverPendingResumeTask).mockResolvedValue({
        ok: false,
        error: { type: 'invalid_status', message: 'missing pending resume prompt' },
      });
      mockListWorkerContainers.mockResolvedValue([]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockDispatcher.recoverPendingResumeTask).toHaveBeenCalledWith(pendingResumeTask);
      expect(mockWebhookClient.send).toHaveBeenCalledWith({
        url: 'https://example.com/webhook',
        secret: 'secret',
        payload: {
          taskId: 'task-1',
          status: 'interrupted',
          duration: 0,
        },
        taskId: 'task-1',
      });
    });

    it('should send interrupted webhook for task with no container', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      // No containers discovered
      mockListWorkerContainers.mockResolvedValue([]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'interrupted',
          }),
        })
      );
    });

    it('should remove exited container and send interrupted webhook', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'container-1', taskId: 'task-1', state: 'exited' },
      ]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('task-1');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'interrupted',
          }),
        })
      );
    });

    it('should remove stateless orphan container', async () => {
      // No tasks in state
      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: {},
        githubToken: null,
        pendingWebhooks: [],
      });

      // But a container exists
      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'orphan-container', taskId: 'orphan-task', state: 'running' },
      ]);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('orphan-task');
      expect(mockWebhookClient.send).not.toHaveBeenCalled();
    });

    it('should fall back to state-only when no isolationProvider', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      const { main } = await import('../main.js');

      // No isolationProvider passed
      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Should send interrupted webhook (state-only fallback)
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'interrupted',
          }),
        })
      );
    });

    it('should continue processing other tasks when one adoption fails', async () => {
      const task1 = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook1',
        webhookSecret: 'secret1',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree1',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      const task2 = {
        taskId: 'task-2',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook2',
        webhookSecret: 'secret2',
        status: 'running' as const,
        containerId: 'container-2',
        worktreePath: '/path/to/worktree2',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': task1, 'task-2': task2 },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'container-1', taskId: 'task-1', state: 'running' },
        { containerId: 'container-2', taskId: 'task-2', state: 'running' },
      ]);

      // First adoption fails, second succeeds
      vi.mocked(mockDispatcher.adoptTask)
        .mockRejectedValueOnce(new Error('Adoption failed'))
        .mockResolvedValueOnce({ ok: true, value: undefined });

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      // First task adoption failed — should fall through to interrupted webhook
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ taskId: 'task-1', status: 'interrupted' }),
        })
      );

      // Second task adoption succeeded — should NOT get interrupted webhook
      expect(mockWebhookClient.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ taskId: 'task-2' }),
        })
      );

      expect(mockDispatcher.adoptTask).toHaveBeenCalledTimes(2);
    });

    it('falls through to interrupted webhook when adoptTask returns error result', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      mockListWorkerContainers.mockResolvedValue([
        { containerId: 'container-1', taskId: 'task-1', state: 'running' },
      ]);

      vi.mocked(mockDispatcher.adoptTask).mockResolvedValue({
        ok: false,
        error: { type: 'at_capacity', message: 'No capacity' },
      });

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger,
          undefined,
          mockIsolationProvider
        );
      } catch {
        // Expected
      }

      expect(mockDispatcher.adoptTask).toHaveBeenCalledWith(runningTask);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'interrupted',
          }),
        })
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1' }),
        'Adoption failed, marking as interrupted'
      );
    });

    it('falls back to state-only recovery when container discovery times out', async () => {
      const runningTask = {
        taskId: 'task-1',
        workerType: 'opus' as const,
        prompt: 'Test',
        repository: 'test/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running' as const,
        containerId: 'container-1',
        worktreePath: '/path/to/worktree',
        startedAt: '2025-01-26T00:00:00.000Z',
        linearIssueLabels: [],
      };

      vi.mocked(mockStatePersistence.load).mockResolvedValue({
        tasks: { 'task-1': runningTask },
        githubToken: null,
        pendingWebhooks: [],
      });

      // Return a never-resolving promise to simulate a hang
      mockListWorkerContainers.mockReturnValue(
        new Promise<DiscoveredContainer[]>(() => {
          // Never resolves
        })
      );

      const { main } = await import('../main.js');

      const mainPromise = main(
        mockConfig,
        mockStatePersistence,
        mockDispatcher,
        mockTokenService,
        mockWebhookClient,
        mockHeartbeatManager,
        mockLogger,
        undefined,
        mockIsolationProvider
      );

      // Advance past the 60-second timeout
      await vi.advanceTimersByTimeAsync(60_001);

      try {
        await mainPromise;
      } catch {
        // Expected
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 60_000 }),
        'Container discovery timed out, falling back to state-only recovery'
      );
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'interrupted',
          }),
        })
      );
    });
  });

  describe('scheduleTokenRefresh', () => {
    it('should schedule token refresh at 5 minute intervals', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Should have been called for token refresh, webhook retry, and task polling
      expect(setIntervalSpy).toHaveBeenCalled();

      // Advance time to trigger token refresh
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockTokenService.refreshToken).toHaveBeenCalled();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should log error when token refresh fails', async () => {
      vi.mocked(mockTokenService.refreshToken).mockResolvedValue({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'Token refresh failed' },
      });

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Advance time to trigger token refresh
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { code: 'NETWORK_ERROR', message: 'Token refresh failed' },
        'Token refresh failed'
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should log debug message on successful token refresh', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Advance time to trigger token refresh
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLogger.debug).toHaveBeenCalledWith({ message: 'Token refreshed successfully' });

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should catch and log exceptions during token refresh', async () => {
      vi.mocked(mockTokenService.refreshToken).mockRejectedValue(
        new Error('Unexpected token service error')
      );

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Advance time to trigger token refresh
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Token refresh error'
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });
  });

  describe('scheduleWebhookRetry', () => {
    it('should schedule webhook retry at 5 minute intervals', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Advance time to trigger webhook retry
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockWebhookClient.retryPending).toHaveBeenCalled();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should log error when webhook retry fails', async () => {
      vi.mocked(mockWebhookClient.retryPending).mockRejectedValue(
        new Error('Webhook retry failed')
      );

      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Advance time to trigger webhook retry
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Webhook retry failed'
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });
  });

  describe('setupShutdownHandlers', () => {
    it('should register SIGTERM and SIGINT handlers', async () => {
      const onSpy = vi.spyOn(process, 'on');
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should clear intervals on shutdown', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler and call it
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        // Mock dispatcher to return 0 running tasks
        vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

        try {
          await sigtermHandler();
        } catch {
          // exit(0) will throw
        }
      }

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should wait for running tasks to complete before exit', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        // Mock dispatcher to return 1 running task initially, then 0
        vi.mocked(mockDispatcher.getRunningCount)
          .mockReturnValueOnce(1)
          .mockReturnValueOnce(1)
          .mockReturnValueOnce(0);

        try {
          await sigtermHandler();
        } catch {
          // exit(0) will throw
        }
      }

      // Should have called getRunningCount multiple times while waiting
      expect(mockDispatcher.getRunningCount).toHaveBeenCalled();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should save state before exit', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

        sigtermHandler();
        // Allow all async operations in shutdown to complete
        await vi.runAllTimersAsync();
      }

      // Should save state before exit
      expect(mockStatePersistence.save).toHaveBeenCalled();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should close server on shutdown', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

        try {
          sigtermHandler();
          // Allow async shutdown to complete
          await vi.advanceTimersByTimeAsync(0);
        } catch {
          // exit(0) will throw
        }
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Orchestrator shutdown complete' })
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should exit with code 0 on successful shutdown', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

        try {
          sigtermHandler();
          // Allow async shutdown to complete
          await vi.advanceTimersByTimeAsync(0);
        } catch {
          // exit(0) will throw
        }
      }

      // Check that exit was called with 0
      expect(mockExit).toHaveBeenCalledWith(0);

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should handle multiple shutdown signals gracefully', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get both signal handlers
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigintCall = onCalls.find((call) => call[0] === 'SIGINT');
      const sigtermHandler = sigtermCall?.[1];
      const sigintHandler = sigintCall?.[1];

      vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

      // Call SIGTERM first
      if (typeof sigtermHandler === 'function') {
        try {
          await sigtermHandler();
        } catch {
          // Expected
        }
      }

      // Flush microtasks so the fire-and-forget shutdown() completes
      await vi.advanceTimersByTimeAsync(0);

      // Calling SIGINT should return early (already shutting down)
      const saveCallCount = vi.mocked(mockStatePersistence.save).mock.calls.length;

      if (typeof sigintHandler === 'function') {
        try {
          await sigintHandler();
        } catch {
          // Expected
        }
      }

      // Should not have called save again (early return)
      expect(vi.mocked(mockStatePersistence.save).mock.calls.length).toBe(saveCallCount);

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should log shutdown signal received', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Get the SIGTERM handler
      const onCalls = vi.mocked(process.on).mock.calls;
      const sigtermCall = onCalls.find((call) => call[0] === 'SIGTERM');
      const sigtermHandler = sigtermCall?.[1];

      if (typeof sigtermHandler === 'function') {
        vi.mocked(mockDispatcher.getRunningCount).mockReturnValue(0);

        try {
          sigtermHandler();
          // Allow async shutdown to complete
          await vi.advanceTimersByTimeAsync(0);
        } catch {
          // Expected
        }
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ signal: 'SIGTERM' }),
        'Shutdown requested'
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });
  });

  describe('main function integration', () => {
    it('should start HTTP server on configured port', async () => {
      // exit is mocked at module level via mockExit

      const fastify = await import('fastify');
      const mockApp = {
        register: vi.fn(),
        listen: vi.fn(({ port }) => {
          expect(port).toBe(8100);
          return Promise.resolve();
        }),
        close: vi.fn(),
      };
      vi.mocked(fastify.default).mockReturnValueOnce(mockApp as never);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(mockApp.listen).toHaveBeenCalledWith({
        port: 8100,
        host: '0.0.0.0',
      });

      // Check that the HTTP server started log was called
      const infoCalls = vi.mocked(mockLogger.info).mock.calls;
      const serverStartedCall = infoCalls.find((call) => {
        const firstArg = call[0] as { port?: number } | undefined;
        return firstArg?.port === 8100 || call[1] === 'Orchestrator HTTP server started';
      });
      expect(serverStartedCall).toBeDefined();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should exit with code 1 on startup failure', async () => {
      // exit is mocked at module level via mockExit

      // Make fastify listen fail
      const fastify = await import('fastify');
      vi.mocked(fastify.default).mockReturnValueOnce({
        register: vi.fn(),
        listen: vi.fn(() => Promise.reject(new Error('Port in use'))),
      } as never);

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Failed to start orchestrator'
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should register routes with dispatcher and token service', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');
      const { registerRoutes } = await import('../routes.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      expect(registerRoutes).toHaveBeenCalledWith(
        expect.any(Object),
        mockDispatcher,
        mockTokenService,
        mockConfig,
        mockLogger,
        expect.any(Function),
        undefined,
        undefined
      );

      // mockExit doesn't need restore - it's cleared in beforeEach
    });

    it('should log ready message after startup completes', async () => {
      // exit is mocked at module level via mockExit

      const { main } = await import('../main.js');

      try {
        await main(
          mockConfig,
          mockStatePersistence,
          mockDispatcher,
          mockTokenService,
          mockWebhookClient,
          mockHeartbeatManager,
          mockLogger
        );
      } catch {
        // Expected
      }

      // Check that ready message was logged
      const infoCalls = vi.mocked(mockLogger.info).mock.calls;
      const readyCall = infoCalls.find((call) => {
        const firstArg = call[0] as { message?: string } | undefined;
        return firstArg?.message === 'Orchestrator ready' || call[1] === 'Orchestrator ready';
      });
      expect(readyCall).toBeDefined();

      // mockExit doesn't need restore - it's cleared in beforeEach
    });
  });
});
