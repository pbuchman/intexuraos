import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec, type ChildProcess } from 'node:child_process';
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

const createMockChildProcess = (): ChildProcess => ({
  pid: 12345,
  stdin: null,
  stdout: null,
  stderr: null,
  stdio: [null, null, null],
  killed: false,
  exitCode: null,
  signalCode: null,
  spawnargs: [],
  spawnfile: '',
  connected: false,
  kill: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn(),
  unref: vi.fn(),
  ref: vi.fn(),
  addListener: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  prependListener: vi.fn(),
  prependOnceListener: vi.fn(),
  removeListener: vi.fn(),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
  setMaxListeners: vi.fn(),
  getMaxListeners: vi.fn(() => 10),
  listeners: vi.fn(() => []),
  rawListeners: vi.fn(() => []),
  listenerCount: vi.fn(() => 0),
  eventNames: vi.fn(() => []),
  [Symbol.dispose]: vi.fn(),
}) as unknown as ChildProcess;

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
      saveAtomic: vi.fn(async (newState: OrchestratorState) => {
        Object.assign(state, newState);
      }),
      detectOrphanWorktrees: vi.fn(async () => []),
      emptyState: () => ({ tasks: {}, githubToken: null, pendingWebhooks: [] }),
    } as unknown as StatePersistence;
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
    getPendingCount: vi.fn(async () => 0),
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

    it('should handle worktree creation failure', async () => {
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

    it('should use provided repository and baseBranch when given', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-with-repo',
        workerType: 'auto',
        prompt: 'Test prompt',
        repository: 'custom/repo',
        baseBranch: 'main',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith(
        'test-task-with-repo',
        'main'
      );
    });
  });

  describe('cancelTask', () => {
    it('should cancel running task', { timeout: 15000 }, async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };
      await dispatcher.submitTask(request);

      const result = await dispatcher.cancelTask('test-task');

      expect(result.ok).toBe(true);
      expect(mockTmuxManager.killSession).toHaveBeenCalled();
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
      const task = state.tasks['test-task'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
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

  describe('Task Timeout', () => {
    let timeoutDispatcher: TaskDispatcher;
    let timeoutStatePersistence: StatePersistence;

    beforeEach(() => {
      vi.useFakeTimers();
      // For timeout tests, session should always appear running (until killed)
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(true);
      timeoutStatePersistence = createStatePersistence();
      timeoutDispatcher = new TaskDispatcher(
        mockConfig,
        timeoutStatePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);
    });

    it('should log warning at 1h 55m', async () => {
      const request: CreateTaskRequest = {
        taskId: 'timeout-test',
        workerType: 'auto',
        prompt: 'Test timeout',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);

      // Advance to 1h 55m (115 minutes)
      await vi.advanceTimersByTimeAsync(115 * 60 * 1000);

      expect(timeoutDispatcher.getRunningCount()).toBe(1);
    });

    it('should kill session at 2h timeout', async () => {
      const request: CreateTaskRequest = {
        taskId: 'timeout-kill-test',
        workerType: 'auto',
        prompt: 'Test timeout kill',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);
      vi.clearAllMocks();

      // Advance to 2h (120 minutes)
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);

      expect(mockTmuxManager.killSession).toHaveBeenCalled();
    });

    it('should log timeout warning for running task', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const request: CreateTaskRequest = {
        taskId: 'warning-test',
        workerType: 'auto',
        prompt: 'Test warning',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);

      // Advance to 1h 55m (115 minutes) - warning timeout
      await vi.advanceTimersByTimeAsync(115 * 60 * 1000);

      expect(warnSpy).toHaveBeenCalledWith(
        { taskId: 'warning-test' },
        'Task approaching 2-hour timeout'
      );
    });

    it('should kill task and send webhook on timeout', async () => {
      const request: CreateTaskRequest = {
        taskId: 'kill-webhook-test',
        workerType: 'auto',
        prompt: 'Test kill webhook',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);
      vi.clearAllMocks();

      // Advance past 2h timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      expect(mockTmuxManager.killSession).toHaveBeenCalledWith('kill-webhook-test', false);
      expect(mockLogForwarder.stopForwarding).toHaveBeenCalledWith('kill-webhook-test');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: 'interrupted' }),
        })
      );
      expect(timeoutDispatcher.getRunningCount()).toBe(0);
    });

    it('should update task status to interrupted on timeout', async () => {
      const request: CreateTaskRequest = {
        taskId: 'interrupted-test',
        workerType: 'auto',
        prompt: 'Test interrupted status',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);

      // Advance past 2h timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      const task = await timeoutDispatcher.getTask('interrupted-test');
      expect(task?.status).toBe('interrupted');
      expect(task?.completedAt).toBeDefined();
    });
  });

  describe('Completion Monitoring', () => {
    let monitorDispatcher: TaskDispatcher;
    let monitorStatePersistence: StatePersistence;

    beforeEach(() => {
      vi.useFakeTimers();
      monitorStatePersistence = createStatePersistence();
      monitorDispatcher = new TaskDispatcher(
        mockConfig,
        monitorStatePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect task completion when tmux session stops', async () => {
      const request: CreateTaskRequest = {
        taskId: 'completion-test',
        workerType: 'auto',
        prompt: 'Test completion',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await monitorDispatcher.submitTask(request);

      // Initially session is running
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      expect(monitorDispatcher.getRunningCount()).toBe(1);

      // Session stops
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Task should be marked as completed or failed
      const task = await monitorDispatcher.getTask('completion-test');
      expect(task?.status).not.toBe('running');
    });

    it('should not detect completion if task already stopped', async () => {
      const request: CreateTaskRequest = {
        taskId: 'already-stopped-test',
        workerType: 'auto',
        prompt: 'Test already stopped',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await monitorDispatcher.submitTask(request);

      // Manually mark as completed
      const state = await monitorStatePersistence.load();
      const task = state.tasks['already-stopped-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await monitorStatePersistence.save(state);

      // Advance time - should not try to handle completion again
      vi.mocked(mockTmuxManager.isSessionRunning).mockClear();
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockTmuxManager.isSessionRunning).not.toHaveBeenCalled();
    });

    it('should handle completion monitoring errors gracefully', async () => {
      const errorSpy = vi.spyOn(mockLogger, 'error');
      const request: CreateTaskRequest = {
        taskId: 'monitor-error-test',
        workerType: 'auto',
        prompt: 'Test monitor error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await monitorDispatcher.submitTask(request);

      // Make getTask throw error
      vi.spyOn(monitorDispatcher, 'getTask').mockRejectedValueOnce(new Error('Database error'));

      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(errorSpy).toHaveBeenCalledWith(
        { taskId: 'monitor-error-test', error: expect.any(Error) },
        'Error in completion monitoring callback'
      );
    });
  });

  describe('checkForResult', () => {
    let resultDispatcher: TaskDispatcher;
    let resultStatePersistence: StatePersistence;

    beforeEach(() => {
      vi.useFakeTimers();
      resultStatePersistence = createStatePersistence();
      resultDispatcher = new TaskDispatcher(
        mockConfig,
        resultStatePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect task completion when session stops', async () => {
      const request: CreateTaskRequest = {
        taskId: 'completion-detect-test',
        workerType: 'auto',
        prompt: 'Test completion detection',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await resultDispatcher.submitTask(request);

      // Initially session is running
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      expect(resultDispatcher.getRunningCount()).toBe(1);

      // Session stops - task should be marked completed
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await resultDispatcher.getTask('completion-detect-test');
      expect(task?.status).not.toBe('running');
    });

    it('should send webhook when task completes', async () => {
      const request: CreateTaskRequest = {
        taskId: 'webhook-on-complete-test',
        workerType: 'auto',
        prompt: 'Test webhook on completion',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await resultDispatcher.submitTask(request);

      // Stop the session to trigger completion
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Webhook should be sent with completed/failed status
      expect(mockWebhookClient.send).toHaveBeenCalled();
      const call = vi.mocked(mockWebhookClient.send).mock.calls[0];
      if (!call) throw new Error('No webhook call');
      const payload = call[0]?.payload as { status?: string } | undefined;
      expect(['completed', 'failed']).toContain(payload?.status);
    });
  });

  describe('optional payload fields', () => {
    it('should include linearIssueTitle, slug, and actionId in task when provided', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-optional-fields',
        workerType: 'auto',
        prompt: 'Test prompt',
        linearIssueId: 'LIN-123',
        linearIssueTitle: 'Fix authentication bug',
        slug: 'fix-auth',
        actionId: 'action-456',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const task = await dispatcher.getTask('test-task-optional-fields');
      expect(task).not.toBeNull();
      expect(task?.linearIssueId).toBe('LIN-123');
      expect(task?.linearIssueTitle).toBe('Fix authentication bug');
      expect(task?.slug).toBe('fix-auth');
      expect(task?.actionId).toBe('action-456');
    });

    it('should handle task without optional fields', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-no-optional',
        workerType: 'opus',
        prompt: 'Test prompt without optional fields',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const task = await dispatcher.getTask('test-task-no-optional');
      expect(task).not.toBeNull();
      expect(task?.linearIssueId).toBeUndefined();
      expect(task?.linearIssueTitle).toBeUndefined();
      expect(task?.slug).toBeUndefined();
      expect(task?.actionId).toBeUndefined();
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle generic error during submitTask', async () => {
      const request: CreateTaskRequest = {
        taskId: 'generic-error-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      // Mock getTask to throw unexpected error during submit
      vi.spyOn(dispatcher, 'getTask').mockRejectedValueOnce(new Error('Unexpected error'));

      // Use a fresh dispatcher to avoid state pollution
      const errorDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      // Override getTask to throw during submitTask's saveTask call
      vi.spyOn(statePersistence, 'save').mockRejectedValueOnce(new Error('DB error'));

      const result = await errorDispatcher.submitTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('service_error');
        expect(result.error.message).toBe('Failed to start task');
      }
      // Running count should be decremented even after error
      expect(errorDispatcher.getRunningCount()).toBe(0);
    });

    it('should cleanup worktree when tmux session start fails', async () => {
      const cleanupWorktreeManager = {
        ...mockWorktreeManager,
        removeWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
      } as unknown as WorktreeManager;

      const errorDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        cleanupWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      vi.mocked(mockTmuxManager.startSession).mockRejectedValueOnce(
        new Error('Failed to start tmux')
      );

      const request: CreateTaskRequest = {
        taskId: 'cleanup-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const result = await errorDispatcher.submitTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('service_error');
        expect(result.error.message).toBe('Failed to start tmux session');
      }
      // Worktree should be cleaned up
      expect(cleanupWorktreeManager.removeWorktree).toHaveBeenCalledWith('cleanup-test');
    });

    it('should force kill task after graceful shutdown period', { timeout: 15000 }, async () => {
      const forceKillTmuxManager = {
        ...mockTmuxManager,
        killSession: vi.fn(async (_taskId, graceful) => {
          if (graceful) {
            // First call is graceful, return immediately
            return { ok: true, value: undefined };
          }
          // Second call is force kill
          return { ok: true, value: undefined };
        }),
        isSessionRunning: vi.fn()
          .mockResolvedValueOnce(true) // Still running after graceful period
          .mockResolvedValueOnce(false), // Not running after force kill
      } as unknown as TmuxManager;

      const cancelDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        forceKillTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      const request: CreateTaskRequest = {
        taskId: 'force-kill-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await cancelDispatcher.submitTask(request);
      vi.clearAllMocks();

      // Mock that session is still running after graceful shutdown
      vi.mocked(forceKillTmuxManager.isSessionRunning).mockResolvedValue(true);

      const result = await cancelDispatcher.cancelTask('force-kill-test');

      expect(result.ok).toBe(true);
      // Should have called kill twice - once graceful, once force
      expect(forceKillTmuxManager.killSession).toHaveBeenCalledTimes(2);
      // Second call should be force kill (graceful=false)
      expect(forceKillTmuxManager.killSession).toHaveBeenLastCalledWith(
        'force-kill-test',
        false
      );
    });

    it('should return early from timeout kill if task no longer running', async () => {
      vi.useFakeTimers();

      const request: CreateTaskRequest = {
        taskId: 'no-timeout-kill-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await dispatcher.submitTask(request);

      // Manually mark task as completed (not running)
      const state = await statePersistence.load();
      const task = state.tasks['no-timeout-kill-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await statePersistence.save(state);

      // Advance past 2h timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      // Task should still be completed (not interrupted)
      const finalTask = await dispatcher.getTask('no-timeout-kill-test');
      expect(finalTask?.status).toBe('completed');
      // No webhook should be sent for interruption
      expect(mockWebhookClient.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: 'interrupted' }),
        })
      );

      vi.useRealTimers();
    });
  });

  describe('checkForResult edge cases', () => {
    it('should handle empty PR list from gh command', async () => {
      vi.useFakeTimers();

      const resultDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      // Submit a task
      const request: CreateTaskRequest = {
        taskId: 'no-pr-test',
        workerType: 'auto',
        prompt: 'Test with no PR',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await resultDispatcher.submitTask(request);

      // Manually mark task as completed
      const state = await statePersistence.load();
      const task = state.tasks['no-pr-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'running';
      await statePersistence.save(state);

      // Mock gh pr list to return empty array
      const execSpy = vi.spyOn({ exec }, 'exec').mockImplementation(
        (_command: string, _options: unknown, callback: unknown) => {
          const cb = callback as (
            error: Error | null,
            stdout: string,
            stderr: string
          ) => void;
          cb(null, '[]', '');
          return createMockChildProcess();
        }
      );

      // Stop the session to trigger completion check
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Verify no error was thrown
      const finalTask = await resultDispatcher.getTask('no-pr-test');
      expect(finalTask?.status).not.toBe('running');

      execSpy.mockRestore();

      vi.useRealTimers();
    });

    it('should handle gh command JSON parse failure gracefully', async () => {
      vi.useFakeTimers();

      const resultDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      // Submit a task
      const request: CreateTaskRequest = {
        taskId: 'json-error-test',
        workerType: 'auto',
        prompt: 'Test with JSON error',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await resultDispatcher.submitTask(request);

      // Manually mark task as completed
      const state = await statePersistence.load();
      const task = state.tasks['json-error-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'running';
      await statePersistence.save(state);

      // Mock gh pr list to return invalid JSON
      const execSpy = vi.spyOn({ exec }, 'exec').mockImplementation(
        (_command: string, _options: unknown, callback: unknown) => {
          const cb = callback as (
            error: Error | null,
            stdout: string,
            stderr: string
          ) => void;
          cb(null, 'invalid json {{{', '');
          return createMockChildProcess();
        }
      );

      // Mock isSessionRunning to return false
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Verify task was marked as failed (no PR created)
      const finalTask = await resultDispatcher.getTask('json-error-test');
      expect(finalTask?.status).toBe('failed');

      execSpy.mockRestore();

      vi.useRealTimers();
    });

    it('should mark task as failed when CI fails with PR created', async () => {
      vi.useFakeTimers();

      const resultDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      // Submit a task
      const request: CreateTaskRequest = {
        taskId: 'ci-failed-test',
        workerType: 'auto',
        prompt: 'Test with CI failure',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await resultDispatcher.submitTask(request);

      // Mock gh pr list to return a PR
      const execSpy = vi.spyOn({ exec }, 'exec').mockImplementation(
        (command: string, _options: unknown, callback: unknown) => {
          const cb = callback as (
            error: Error | null,
            stdout: string,
            stderr: string
          ) => void;

          if (command.includes('gh pr list')) {
            // Return a PR
            cb(
              null,
              JSON.stringify([
                {
                  url: 'https://github.com/pbuchman/intexuraos/pull/123',
                  headRefName: 'feature/test',
                  commits: { totalCount: 2 },
                  title: 'Test PR',
                },
              ]),
              ''
            );
          } else if (command.includes('gh pr checks')) {
            // Return CI status as FAILURE
            cb(null, JSON.stringify('FAILURE'), '');
          } else {
            cb(null, '', '');
          }
          return createMockChildProcess();
        }
      );

      // Mock isSessionRunning to return false (task completed)
      vi.mocked(mockTmuxManager.isSessionRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Verify task was marked as failed due to CI failure
      const finalTask = await resultDispatcher.getTask('ci-failed-test');
      expect(finalTask?.status).toBe('failed');

      execSpy.mockRestore();

      vi.useRealTimers();
    });

    it('should not kill task if status changed between warning and kill timeout', async () => {
      vi.useFakeTimers();

      const timeoutDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockTmuxManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger
      );

      const request: CreateTaskRequest = {
        taskId: 'status-change-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      await timeoutDispatcher.submitTask(request);

      // Manually mark task as completed before kill timeout
      const state = await statePersistence.load();
      const task = state.tasks['status-change-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await statePersistence.save(state);

      vi.clearAllMocks();

      // Advance past the 2h kill timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      // Task should still be completed (not interrupted)
      const finalTask = await timeoutDispatcher.getTask('status-change-test');
      expect(finalTask?.status).toBe('completed');

      // No webhook should be sent for interruption
      expect(mockWebhookClient.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: 'interrupted' }),
        })
      );

      vi.useRealTimers();
    });
  });
});
