import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskDispatcher } from '../services/task-dispatcher.js';
import type { OrchestratorConfig } from '../types/config.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { WorktreeManager } from '../services/worktree-manager.js';
import type { TmuxManager } from '../services/tmux-manager.js';
import type { LogForwarder } from '../services/log-forwarder.js';
import type { WebhookClient } from '../services/webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../types/api.js';
import type { OrchestratorState } from '../types/state.js';

describe('TaskDispatcher', () => {
  // Mock config
  const mockConfig: OrchestratorConfig = {
    port: 8100,
    capacity: 5,
    taskTimeoutMs: 7200000,
    stateFilePath: '/tmp/state.json',
    worktreeBasePath: '/tmp/worktrees',
    logBasePath: '/tmp/logs',
    githubAppId: 'test-app-id',
    githubAppPrivateKeyPath: '/tmp/key.pem',
    githubInstallationId: 'test-installation-id',
    dispatchSecret: 'test-secret',
  };

  // Mock StatePersistence
  const createStatePersistence = (): StatePersistence => {
    const state: OrchestratorState = {
      tasks: {},
      githubToken: null,
      pendingWebhooks: [],
    };

    return {
      load: vi.fn(
        (): Promise<OrchestratorState> => Promise.resolve(JSON.parse(JSON.stringify(state)))
      ),
      save: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
    };
  };

  // Mock WorktreeManager
  const mockWorktreeManager = {
    createWorktree: vi.fn(async () => ({
      ok: true,
      value: { path: '/tmp/worktrees/test-task' },
    })),
    deleteWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
  } as unknown as WorktreeManager;

  // Mock TmuxManager
  const mockTmuxManager = {
    startSession: vi.fn(async () => ({
      ok: true,
      value: { sessionName: 'orchestrator-test-task', logPath: '/tmp/logs/test-task.log' },
    })),
    stopSession: vi.fn(async () => ({ ok: true, value: undefined })),
    killSession: vi.fn(async () => ({ ok: true, value: undefined })),
    isSessionRunning: vi.fn(async () => false),
  } as unknown as TmuxManager;

  // Mock LogForwarder
  const mockLogForwarder = {
    startForwarding: vi.fn(),
    stopForwarding: vi.fn(async () => undefined),
    getDroppedChunkCount: vi.fn(() => 0),
  } as unknown as LogForwarder;

  // Mock WebhookClient
  const mockWebhookClient = {
    send: vi.fn(async () => ({ ok: true, value: undefined })),
    retryPending: vi.fn(async () => undefined),
    getPendingCount: vi.fn(() => 0),
  } as unknown as WebhookClient;

  // Mock GitHubTokenService
  const mockGitHubTokenService = {
    getToken: vi.fn(async () => ({ token: 'test-token', expiresAt: '2025-01-26T00:00:00Z' })),
  } as unknown as GitHubTokenService;

  // Mock Logger
  /* eslint-disable @typescript-eslint/no-empty-function */
  const mockLogger: Logger = {
    info(): void {},
    warn(): void {},
    error(): void {},
    debug(): void {},
  };

  let statePersistence: StatePersistence;
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    statePersistence = createStatePersistence();
    dispatcher = new TaskDispatcher(
      mockConfig,
      statePersistence,
      mockWorktreeManager,
      mockTmuxManager,
      mockLogForwarder,
      mockWebhookClient,
      mockGitHubTokenService,
      mockLogger
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('submitTask', () => {
    it('should accept task when capacity available', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-1',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockWorktreeManager.createWorktree).toHaveBeenCalled();
      expect(mockTmuxManager.startSession).toHaveBeenCalled();
      expect(mockLogForwarder.startForwarding).toHaveBeenCalledWith(
        'test-task-1',
        expect.any(String)
      );
    });

    it('should reject task when at capacity', async () => {
      // Fill capacity
      for (let i = 0; i < 5; i++) {
        const request: CreateTaskRequest = {
          taskId: `task-${i}`,
          workerType: 'auto',
          prompt: 'Test',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
        };
        await dispatcher.submitTask(request);
      }

      // Try to submit one more
      const request: CreateTaskRequest = {
        taskId: 'task-5',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('at_capacity');
      }
      expect(dispatcher.getRunningCount()).toBe(5);
    });

    it.skip('should handle worktree creation failure', async () => {
      // TODO: Fix test to match actual service API
      vi.mocked(mockWorktreeManager.createWorktree).mockRejectedValueOnce(
        new Error('Failed to create worktree')
      );

      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('service_error');
      }
      expect(dispatcher.getRunningCount()).toBe(0);
    });
  });

  describe('cancelTask', () => {
    it.skip('should cancel running task', { timeout: 15000 }, async () => {
      // TODO: Fix test to match actual service API
      // First submit a task
      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };
      await dispatcher.submitTask(request);

      // Then cancel it
      const result = await dispatcher.cancelTask('test-task');

      expect(result.ok).toBe(true);
      expect(mockTmuxManager.stopSession).toHaveBeenCalled();
      expect(mockLogForwarder.stopForwarding).toHaveBeenCalledWith('test-task');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: 'cancelled' }),
        })
      );
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it('should return error for non-existent task', async () => {
      const result = await dispatcher.cancelTask('non-existent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('not_found');
      }
    });

    it('should return error for already completed task', async () => {
      // Submit and complete a task
      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };
      await dispatcher.submitTask(request);

      // Manually mark as completed
      const state = await statePersistence.load();
      state.tasks['test-task'].status = 'completed';
      await statePersistence.save(state);

      // Try to cancel
      const result = await dispatcher.cancelTask('test-task');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('already_completed');
      }
    });
  });

  describe('getTask', () => {
    it('should return task when exists', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };
      await dispatcher.submitTask(request);

      const task = await dispatcher.getTask('test-task');

      expect(task).not.toBeNull();
      expect(task?.taskId).toBe('test-task');
      expect(task?.status).toBe('running');
    });

    it('should return null when task does not exist', async () => {
      const task = await dispatcher.getTask('non-existent');
      expect(task).toBeNull();
    });
  });

  describe('getRunningCount and getCapacity', () => {
    it('should return correct running count', async () => {
      expect(dispatcher.getRunningCount()).toBe(0);

      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };
      await dispatcher.submitTask(request);

      expect(dispatcher.getRunningCount()).toBe(1);
    });

    it('should return configured capacity', () => {
      expect(dispatcher.getCapacity()).toBe(5);
    });
  });
});
