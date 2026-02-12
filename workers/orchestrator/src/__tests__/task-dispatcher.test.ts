import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec, type ChildProcess } from 'node:child_process';
import { TaskDispatcher, type IsolationConfig } from '../services/task-dispatcher.js';
import type { OrchestratorConfig } from '../types/config.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { WorktreeManager } from '../services/worktree-manager.js';
import type { LogForwarder } from '../services/log-forwarder.js';
import type { WebhookClient } from '../services/webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../types/api.js';
import type { OrchestratorState } from '../types/state.js';
import type { IsolationProvider, WorkerHandle } from '../services/isolation/types.js';
import type { TokenRefresher } from '../services/isolation/token-refresher.js';
import type { ApiKeyValidator } from '../services/api-key-validator.js';

const flushAsync = async (): Promise<void> => {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
};

const createMockChildProcess = (): ChildProcess =>
  ({
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

const phase1FinalAssistantLog = (label: 'code-task' | 'unclear', ready: 'yes' | 'no'): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: `PHASE1_FINAL:
- Linear label set: ${label}
- Phase 2 ready: ${ready}
- Linear issue: https://linear.app/intexuraos/issue/INT-123
- Summary: Phase 1 completed`,
        },
      ],
    },
  });

const phase2FinalAssistantLog = (): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: `PHASE2_FINAL:
- PR: https://github.com/pbuchman/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-123
- Summary: Phase 2 completed`,
        },
      ],
    },
  });

describe('TaskDispatcher', () => {
  // Mock config
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

  // Mock IsolationProvider
  const mockIsolationProvider: IsolationProvider = {
    createWorker: vi.fn(
      async (config): Promise<WorkerHandle> => ({
        taskId: config.taskId,
        containerId: `container-${config.taskId}`,
        status: 'running',
        startedAt: new Date(),
      })
    ),
    destroyWorker: vi.fn(async () => undefined),
    isWorkerRunning: vi.fn(async () => false),
    getWorkerLogs: vi.fn(async () => ''),
    streamLogs: vi.fn(async () => undefined),
    waitForCompletion: vi.fn(async () => 0),
    getResourceUsage: vi.fn(async () => ({ cpuPercent: 0, memoryUsedMB: 0, memoryLimitMB: 0 })),
    listWorkers: vi.fn(async () => []),
  };

  // Mock TokenRefresher
  const mockTokenRefresher = {
    registerTask: vi.fn(async () => undefined),
    unregisterTask: vi.fn(),
    stop: vi.fn(),
  } as unknown as TokenRefresher;

  // Mock ApiKeyValidator
  const mockApiKeyValidator = {
    validate: vi.fn(async () => ({ valid: true })),
  } as unknown as ApiKeyValidator;

  // Create mock isolation config
  const mockIsolationConfig: IsolationConfig = {
    provider: mockIsolationProvider,
    tokenRefresher: mockTokenRefresher,
    apiKeyValidator: mockApiKeyValidator,
    secrets: {
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      LINEAR_API_KEY: 'test-linear-key',
      SENTRY_AUTH_TOKEN: 'test-sentry-token',
      ZAI_API_KEY: 'test-zai-key',
    },
    gcpSaKeyPath: '/tmp/gcp-sa.json',
    githubAppKeyPath: '/tmp/github-app.pem',
  };

  // Mock LogForwarder
  const mockLogForwarder = {
    startForwarding: vi.fn(),
    stopForwarding: vi.fn(async () => undefined),
    flushAndStop: vi.fn(async () => undefined),
    getDroppedChunkCount: vi.fn(() => 0),
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    appendChunk: vi.fn(),
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

  interface VerifierMockResult {
    passed: boolean;
    confidence: number;
    reasons: string[];
    missingCriteria: string[];
    resumeInstruction: string;
    usedLlm: boolean;
  }

  const singleAttemptCompletionControl = {
    maxAttempts: 1,
    verifier: {
      verify: vi.fn(
        async (_input: unknown): Promise<VerifierMockResult> => ({
          passed: true,
          confidence: 1,
          reasons: ['verification passed'],
          missingCriteria: [],
          resumeInstruction: 'No further action required.',
          usedLlm: true,
        })
      ),
      describe: (): { enabled: boolean; provider: string; model: string } => ({
        enabled: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
    },
  };

  let statePersistence: StatePersistence;
  let dispatcher: TaskDispatcher;

  beforeEach(() => {
    statePersistence = createStatePersistence();
    dispatcher = new TaskDispatcher(
      mockConfig,
      statePersistence,
      mockWorktreeManager,
      mockLogForwarder,
      mockWebhookClient,
      mockGitHubTokenService,
      mockLogger,
      mockIsolationConfig,
      singleAttemptCompletionControl
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockWorktreeManager.createWorktree).toHaveBeenCalled();
      expect(mockIsolationProvider.createWorker).toHaveBeenCalled();
      expect(mockTokenRefresher.registerTask).toHaveBeenCalledWith('test-task-1');
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
          linearIssueLabels: [],
          hasChildren: false,
        };
        await dispatcher.submitTask(request);
        await flushAsync();
      }

      // Try to submit one more
      const request: CreateTaskRequest = {
        taskId: 'task-5',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('at_capacity');
      }
      expect(dispatcher.getRunningCount()).toBe(5);
    });

    it('should handle worktree creation failure via webhook', async () => {
      vi.mocked(mockWorktreeManager.createWorktree).mockRejectedValueOnce(
        new Error('Failed to create worktree')
      );

      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(0);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'test-task',
            status: 'failed',
            error: { code: 'SETUP_FAILED', message: 'Failed to create worktree' },
          }),
        })
      );
    });

    it('should not pass jsonSchema in worker config', async () => {
      const request: CreateTaskRequest = {
        taskId: 'schema-test',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls[0];
      expect(createWorkerCall).toBeDefined();
      const config = createWorkerCall?.[0];
      expect(config?.continueSession).toBe(false);
      expect('jsonSchema' in (config ?? {})).toBe(false);
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

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
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

      const result = await dispatcher.cancelTask('test-task');

      expect(result.ok).toBe(true);
      expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('test-task');
      expect(mockLogForwarder.flushAndStop).toHaveBeenCalledWith('test-task');
      expect(mockTokenRefresher.unregisterTask).toHaveBeenCalledWith('test-task');
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
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

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
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

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
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

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
      // For timeout tests, worker should always appear running (until killed)
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      timeoutStatePersistence = createStatePersistence();
      timeoutDispatcher = new TaskDispatcher(
        mockConfig,
        timeoutStatePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
    });

    it('should log warning at 1h 55m', async () => {
      const request: CreateTaskRequest = {
        taskId: 'timeout-test',
        workerType: 'auto',
        prompt: 'Test timeout',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Advance to 1h 55m (115 minutes)
      await vi.advanceTimersByTimeAsync(115 * 60 * 1000);

      expect(timeoutDispatcher.getRunningCount()).toBe(1);
    });

    it('should kill container at 2h timeout', async () => {
      const request: CreateTaskRequest = {
        taskId: 'timeout-kill-test',
        workerType: 'auto',
        prompt: 'Test timeout kill',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.clearAllMocks();

      // Advance to 2h (120 minutes)
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000);

      expect(mockIsolationProvider.destroyWorker).toHaveBeenCalled();
    });

    it('should log timeout warning for running task', async () => {
      const warnSpy = vi.spyOn(mockLogger, 'warn');
      const request: CreateTaskRequest = {
        taskId: 'warning-test',
        workerType: 'auto',
        prompt: 'Test warning',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

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
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.clearAllMocks();

      // Advance past 2h timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      expect(mockIsolationProvider.destroyWorker).toHaveBeenCalledWith('kill-webhook-test');
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Advance past 2h timeout
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      const task = await timeoutDispatcher.getTask('interrupted-test');
      expect(task?.status).toBe('interrupted');
      expect(task?.completedAt).toBeDefined();
    });

    it('prevents race condition when timeout fires before container completes', async () => {
      const request: CreateTaskRequest = {
        taskId: 'race-test',
        workerType: 'auto',
        prompt: 'Test race condition',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Manually mark task as completed to simulate container finishing
      const state = await timeoutStatePersistence.load();
      const task = state.tasks['race-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await timeoutStatePersistence.save(state);

      // Clear mocks to see what gets called
      vi.clearAllMocks();

      // Advance past 2h timeout - should NOT send interruption webhook since task is already completed
      await vi.advanceTimersByTimeAsync(120 * 60 * 1000 + 1000);

      // Task should still be completed (not interrupted)
      const finalTask = await timeoutDispatcher.getTask('race-test');
      expect(finalTask?.status).toBe('completed');

      // No interruption webhook should be sent
      expect(mockWebhookClient.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ status: 'interrupted' }),
        })
      );
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
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect task completion when container stops', async () => {
      const request: CreateTaskRequest = {
        taskId: 'completion-test',
        workerType: 'auto',
        prompt: 'Test completion',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await monitorDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Initially container is running
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      expect(monitorDispatcher.getRunningCount()).toBe(1);

      // Container stops
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      await monitorDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Manually mark as completed
      const state = await monitorStatePersistence.load();
      const task = state.tasks['already-stopped-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await monitorStatePersistence.save(state);

      // Advance time - should not try to handle completion again
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockClear();
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockIsolationProvider.isWorkerRunning).not.toHaveBeenCalled();
    });

    it('should handle completion monitoring errors gracefully', async () => {
      const errorSpy = vi.spyOn(mockLogger, 'error');
      const request: CreateTaskRequest = {
        taskId: 'monitor-error-test',
        workerType: 'auto',
        prompt: 'Test monitor error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await monitorDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

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
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect task completion when container stops', async () => {
      const request: CreateTaskRequest = {
        taskId: 'completion-detect-test',
        workerType: 'auto',
        prompt: 'Test completion detection',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resultDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Initially container is running
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(30 * 1000);
      expect(resultDispatcher.getRunningCount()).toBe(1);

      // Container stops - task should be marked completed
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resultDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Stop the container to trigger completion
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

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
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

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
    it('should handle generic error during async setup via webhook', async () => {
      const request: CreateTaskRequest = {
        taskId: 'generic-error-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const errorDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      vi.spyOn(statePersistence, 'save').mockRejectedValueOnce(new Error('DB error'));

      const result = await errorDispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(errorDispatcher.getRunningCount()).toBe(0);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'generic-error-test',
            status: 'failed',
            error: { code: 'SETUP_FAILED', message: 'Failed to start task' },
          }),
        })
      );
    });

    it('should cleanup worktree when container creation fails', async () => {
      const cleanupWorktreeManager = {
        ...mockWorktreeManager,
        removeWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
      } as unknown as WorktreeManager;

      const failingIsolationProvider: IsolationProvider = {
        ...mockIsolationProvider,
        createWorker: vi.fn().mockRejectedValueOnce(new Error('Failed to create container')),
      };
      const failingIsolationConfig: IsolationConfig = {
        ...mockIsolationConfig,
        provider: failingIsolationProvider,
      };

      const errorDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        cleanupWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        failingIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'cleanup-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await errorDispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(cleanupWorktreeManager.removeWorktree).toHaveBeenCalledWith('cleanup-test');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'cleanup-test',
            status: 'failed',
            error: { code: 'SETUP_FAILED', message: 'Failed to start worker container' },
          }),
        })
      );
    });

    it('should handle webhook failure during setup error gracefully', async () => {
      vi.mocked(mockWorktreeManager.createWorktree).mockRejectedValueOnce(
        new Error('Failed to create worktree')
      );
      vi.mocked(mockWebhookClient.send).mockRejectedValueOnce(new Error('Webhook failed'));
      const errorSpy = vi.spyOn(mockLogger, 'error');

      const request: CreateTaskRequest = {
        taskId: 'webhook-fail-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      expect(dispatcher.getRunningCount()).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        { taskId: 'webhook-fail-test', webhookError: expect.any(Error) },
        'Failed to send setup failure webhook'
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
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

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
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'no-pr-test',
        workerType: 'auto',
        prompt: 'Test with no PR',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resultDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Manually mark task as completed
      const state = await statePersistence.load();
      const task = state.tasks['no-pr-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'running';
      await statePersistence.save(state);

      // Mock gh pr list to return empty array
      const execSpy = vi
        .spyOn({ exec }, 'exec')
        .mockImplementation((_command: string, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
          cb(null, '[]', '');
          return createMockChildProcess();
        });

      // Stop the container to trigger completion check
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Verify no error was thrown
      const finalTask = await resultDispatcher.getTask('no-pr-test');
      expect(finalTask?.status).not.toBe('running');

      execSpy.mockRestore();

      vi.useRealTimers();
    });

    it('should handle gh command JSON parse failure gracefully', async () => {
      vi.useFakeTimers();
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        phase1FinalAssistantLog('unclear', 'no')
      );

      const resultDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'json-error-test',
        workerType: 'auto',
        prompt: 'Test with JSON error',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resultDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Manually mark task as completed
      const state = await statePersistence.load();
      const task = state.tasks['json-error-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'running';
      await statePersistence.save(state);

      // Mock gh pr list to return invalid JSON
      const execSpy = vi
        .spyOn({ exec }, 'exec')
        .mockImplementation((_command: string, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null, stdout: string, stderr: string) => void;
          cb(null, 'invalid json {{{', '');
          return createMockChildProcess();
        });

      // Mock isWorkerRunning to return false
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Verify task completed (no code-task label = Phase 1, PR not required)
      const finalTask = await resultDispatcher.getTask('json-error-test');
      expect(finalTask?.status).toBe('completed');

      execSpy.mockRestore();

      vi.useRealTimers();
    });

    it('should not kill task if status changed between warning and kill timeout', async () => {
      vi.useFakeTimers();

      const timeoutDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'status-change-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await timeoutDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

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

  describe('phase-aware completion', () => {
    let phaseDispatcher: TaskDispatcher;

    beforeEach(() => {
      vi.useFakeTimers();
      phaseDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should mark Phase 1 task as completed without PR', async () => {
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        phase1FinalAssistantLog('unclear', 'no')
      );
      const request: CreateTaskRequest = {
        taskId: 'phase1-no-pr',
        workerType: 'auto',
        prompt: 'Design task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await phaseDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await phaseDispatcher.getTask('phase1-no-pr');
      expect(task?.status).toBe('completed');
    });

    it('should mark Phase 2 task as failed without PR', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        confidence: 1,
        reasons: ['No PR URL found in task result'],
        missingCriteria: ['PR URL created from branch'],
        resumeInstruction: 'Create a PR and rerun CI.',
        usedLlm: false,
      });
      const internal = phaseDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<unknown>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue(undefined);
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        phase2FinalAssistantLog()
      );
      const request: CreateTaskRequest = {
        taskId: 'phase2-no-pr',
        workerType: 'auto',
        prompt: 'Code task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await phaseDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await phaseDispatcher.getTask('phase2-no-pr');
      expect(task?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: expect.stringContaining('No PR URL found in task result'),
            }),
          }),
        })
      );
    });

    it('should mark task as failed when Claude reports is_error in stream result', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockImplementationOnce(
        async (input: unknown) => {
          const claudeError =
            typeof input === 'object' && input !== null && 'claudeError' in input
              ? (input as { claudeError?: string }).claudeError
              : undefined;
          if (typeof claudeError === 'string' && claudeError !== '') {
            return {
              passed: false,
              confidence: 1,
              reasons: ['Claude stream reported an explicit error'],
              missingCriteria: [`Claude error: ${claudeError}`],
              resumeInstruction: 'Resolve the Claude stream error and continue.',
              usedLlm: false,
            };
          }
          return {
            passed: true,
            confidence: 1,
            reasons: ['verification passed'],
            missingCriteria: [],
            resumeInstruction: 'No further action required.',
            usedLlm: false,
          };
        }
      );
      const request: CreateTaskRequest = {
        taskId: 'claude-error-test',
        workerType: 'auto',
        prompt: 'Test claude error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await phaseDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Grab onLog callback from createWorker call
      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      // Simulate Claude stream with error result
      onLog?.(
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Working..."}]}}\n'
      );
      onLog?.(
        '{"type":"result","is_error":true,"result":"Task failed: StructuredOutput validation error"}\n'
      );

      // Trigger completion monitor
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await phaseDispatcher.getTask('claude-error-test');
      expect(task?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: expect.stringContaining('Claude stream reported an explicit error'),
            }),
          }),
        })
      );
    });

    it('should store linearIssueLabels on the task', async () => {
      const request: CreateTaskRequest = {
        taskId: 'labels-stored',
        workerType: 'auto',
        prompt: 'Test labels',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['bug', 'code-task', 'high-priority'],
        hasChildren: false,
      };

      await phaseDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const task = await phaseDispatcher.getTask('labels-stored');
      expect(task?.linearIssueLabels).toEqual(['bug', 'code-task', 'high-priority']);
    });
  });

  describe('getRunningTaskIds', () => {
    it('should return empty array when no tasks are running', () => {
      const ids = dispatcher.getRunningTaskIds();
      expect(ids).toEqual([]);
    });

    it('should return task IDs for active tasks', async () => {
      const request1: CreateTaskRequest = {
        taskId: 'heartbeat-test-1',
        workerType: 'auto',
        prompt: 'Test task 1',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const request2: CreateTaskRequest = {
        taskId: 'heartbeat-test-2',
        workerType: 'auto',
        prompt: 'Test task 2',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request1);
      await flushAsync();
      await dispatcher.submitTask(request2);
      await flushAsync();

      const ids = dispatcher.getRunningTaskIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('heartbeat-test-1');
      expect(ids).toContain('heartbeat-test-2');
    });

    it('should extract task IDs from activeTasks keys', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const ids = dispatcher.getRunningTaskIds();
      // activeTasks contains keys like 'test-task-monitor', 'test-task-warning', 'test-task-kill'
      // getRunningTaskIds filters for '-monitor' suffix and removes it
      expect(ids).toContain('test-task');
    });
  });

  describe('retriedFrom handling', () => {
    it('should store retriedFrom when provided in payload', async () => {
      const request: CreateTaskRequest = {
        taskId: 'retry-task-1',
        workerType: 'auto',
        prompt: 'Retry test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        retriedFrom: 'original-task-abc',
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      const task = await dispatcher.getTask('retry-task-1');
      expect(task).not.toBeNull();
      expect(task?.retriedFrom).toBe('original-task-abc');
    });

    it('should handle missing retriedFrom gracefully', async () => {
      const request: CreateTaskRequest = {
        taskId: 'normal-task-1',
        workerType: 'auto',
        prompt: 'Normal task prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      const task = await dispatcher.getTask('normal-task-1');
      expect(task).not.toBeNull();
      expect(task?.retriedFrom).toBeUndefined();
    });
  });

  describe('detectClaudeError with Docker headers', () => {
    let headerDispatcher: TaskDispatcher;

    beforeEach(() => {
      vi.useFakeTimers();
      headerDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should detect Claude error in chunk with Docker header prefix', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockImplementationOnce(
        async (input: unknown) => {
          const claudeError =
            typeof input === 'object' && input !== null && 'claudeError' in input
              ? (input as { claudeError?: string }).claudeError
              : undefined;
          if (typeof claudeError === 'string' && claudeError !== '') {
            return {
              passed: false,
              confidence: 1,
              reasons: ['Claude stream reported an explicit error'],
              missingCriteria: [`Claude error: ${claudeError}`],
              resumeInstruction: 'Resolve the Claude stream error and continue.',
              usedLlm: false,
            };
          }
          return {
            passed: true,
            confidence: 1,
            reasons: ['verification passed'],
            missingCriteria: [],
            resumeInstruction: 'No further action required.',
            usedLlm: false,
          };
        }
      );
      const request: CreateTaskRequest = {
        taskId: 'docker-header-error',
        workerType: 'auto',
        prompt: 'Test docker header',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await headerDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      // Simulate Docker multiplexed header (stream type 1 = stdout, followed by 4-byte size)
      const jsonLine =
        '{"type":"result","is_error":true,"result":"error_max_structured_output_retries"}\n';
      const header = String.fromCharCode(1, 0, 0, 0, 0, 0, 0, jsonLine.length);
      onLog?.(header + jsonLine);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await headerDispatcher.getTask('docker-header-error');
      expect(task?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: expect.stringContaining('Claude stream reported an explicit error'),
            }),
          }),
        })
      );
    });

    it('should detect Claude error when result JSON is split across log chunks', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockImplementationOnce(
        async (input: unknown) => {
          const claudeError =
            typeof input === 'object' && input !== null && 'claudeError' in input
              ? (input as { claudeError?: string }).claudeError
              : undefined;
          if (typeof claudeError === 'string' && claudeError !== '') {
            return {
              passed: false,
              confidence: 1,
              reasons: ['Claude stream reported an explicit error'],
              missingCriteria: [`Claude error: ${claudeError}`],
              resumeInstruction: 'Resolve the Claude stream error and continue.',
              usedLlm: false,
            };
          }
          return {
            passed: true,
            confidence: 1,
            reasons: ['verification passed'],
            missingCriteria: [],
            resumeInstruction: 'No further action required.',
            usedLlm: false,
          };
        }
      );
      const request: CreateTaskRequest = {
        taskId: 'split-json-error',
        workerType: 'auto',
        prompt: 'Test split json',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await headerDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onLog).toBeDefined();
      expect(onComplete).toBeDefined();

      onLog?.('{"type":"result","is_error":true,');
      onLog?.('"result":"split_error_detected"}');
      onComplete?.(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await headerDispatcher.getTask('split-json-error');
      expect(task?.status).toBe('failed');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: expect.stringContaining('Claude stream reported an explicit error'),
            }),
          }),
        })
      );
    });

    it('should complete task when attempt finishes even if container stays running', async () => {
      const request: CreateTaskRequest = {
        taskId: 'attempt-signal-complete',
        workerType: 'auto',
        prompt: 'Test managed mode completion signal',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await headerDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onComplete).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      onComplete?.(0);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await headerDispatcher.getTask('attempt-signal-complete');
      expect(task?.status).toBe('completed');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
          }),
        })
      );
    });
  });

  describe('completion loop behavior', () => {
    it('applies completion control maxAttempts to created tasks', async () => {
      const defaultControlDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'default-control-task',
        workerType: 'auto',
        prompt: 'Default control task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await defaultControlDispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      const task = await defaultControlDispatcher.getTask('default-control-task');
      expect(task?.maxAttempts).toBe(singleAttemptCompletionControl.maxAttempts);
      expect(task?.attemptCount).toBe(1);
    });

    it('resumes on first failed verification and completes on second attempt', async () => {
      vi.useFakeTimers();
      const resumeState = createStatePersistence();
      const verify = vi
        .fn()
        .mockResolvedValueOnce({
          passed: false,
          confidence: 0.4,
          reasons: ['missing phase evidence'],
          missingCriteria: ['phase final block missing'],
          resumeInstruction: 'Finish with required final block',
          usedLlm: false,
        })
        .mockResolvedValueOnce({
          passed: true,
          confidence: 0.95,
          reasons: ['criteria met'],
          missingCriteria: [],
          resumeInstruction: 'No action required',
          usedLlm: false,
        });

      const resumeDispatcher = new TaskDispatcher(
        mockConfig,
        resumeState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        {
          maxAttempts: 2,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: false }),
          },
        }
      );

      const resumeDispatcherInternal = resumeDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          ciFailed: boolean;
          prUrl: string;
        }>;
      };
      vi.spyOn(resumeDispatcherInternal, 'checkForResult').mockResolvedValue({
        branch: 'resume-branch',
        commits: 2,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
      });

      const request: CreateTaskRequest = {
        taskId: 'resume-success-task',
        workerType: 'auto',
        prompt: 'Implement fix and report',
        linearIssueId: 'INT-999',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await resumeDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const resumeStateSnapshot = await resumeState.load();
      const resumeTask = resumeStateSnapshot.tasks['resume-success-task'];
      if (!resumeTask) throw new Error('Task not found');
      delete resumeTask.hasChildren;
      await resumeState.save(resumeStateSnapshot);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const afterFirstAttempt = await resumeDispatcher.getTask('resume-success-task');
      expect(afterFirstAttempt?.status).toBe('running');
      expect(afterFirstAttempt?.attemptCount).toBe(2);
      expect(verify).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2,
          linearIssueId: 'INT-999',
          taskResult: expect.objectContaining({
            prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
          }),
        })
      );

      const secondCreateWorkerCall = vi
        .mocked(mockIsolationProvider.createWorker)
        .mock.calls.at(-1);
      expect(secondCreateWorkerCall?.[0]?.continueSession).toBe(true);
      expect(secondCreateWorkerCall?.[0]?.prompt).toContain('[AUTO-CONTINUE ATTEMPT]');

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumeDispatcher.getTask('resume-success-task');
      expect(finalTask?.status).toBe('completed');
      expect(finalTask?.verificationHistory).toHaveLength(2);
      expect(finalTask?.verificationHistory?.[0]?.passed).toBe(false);
      expect(finalTask?.verificationHistory?.[1]?.passed).toBe(true);
      vi.useRealTimers();
    });

    it('fails fast when resumed attempt cannot start', async () => {
      vi.useFakeTimers();
      const resumeFailState = createStatePersistence();
      const createWorker = vi
        .fn()
        .mockResolvedValueOnce({
          taskId: 'resume-fail-task',
          containerId: 'container-resume-fail-1',
          status: 'running',
          startedAt: new Date(),
        })
        .mockRejectedValueOnce(new Error('resume start failed'));

      const localIsolationProvider: IsolationProvider = {
        ...mockIsolationProvider,
        createWorker,
      };
      const localIsolation: IsolationConfig = {
        ...mockIsolationConfig,
        provider: localIsolationProvider,
      };

      const verify = vi.fn().mockResolvedValue({
        passed: false,
        confidence: 0.2,
        reasons: ['still missing'],
        missingCriteria: [],
        resumeInstruction: 'Try again',
        usedLlm: false,
      });

      const resumeFailDispatcher = new TaskDispatcher(
        mockConfig,
        resumeFailState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        localIsolation,
        {
          maxAttempts: 2,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: false }),
          },
        }
      );

      const internal = resumeFailDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          ciFailed: boolean;
          prUrl: string;
        }>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'resume-fail-branch',
        commits: 1,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1000',
      });

      const request: CreateTaskRequest = {
        taskId: 'resume-fail-task',
        workerType: 'auto',
        prompt: 'Resume should fail to start',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumeFailDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await resumeFailDispatcher.getTask('resume-fail-task');
      expect(task?.status).toBe('failed');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            result: expect.objectContaining({
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/1000',
            }),
            error: expect.objectContaining({
              code: 'RESUME_ATTEMPT_FAILED',
            }),
          }),
        })
      );
      vi.useRealTimers();
    });

    it('uses fallback attempt metadata when persisted task is missing fields', async () => {
      vi.useFakeTimers();
      const fallbackState = createStatePersistence();
      const verify = vi.fn().mockResolvedValue({
        passed: false,
        confidence: 0.6,
        reasons: ['not enough'],
        missingCriteria: ['criterion-a'],
        resumeInstruction: 'Add missing criterion',
        usedLlm: false,
      });

      const fallbackDispatcher = new TaskDispatcher(
        mockConfig,
        fallbackState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        {
          maxAttempts: 1,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: false }),
          },
        }
      );

      const request: CreateTaskRequest = {
        taskId: 'fallback-metadata-task',
        workerType: 'auto',
        prompt: 'Fallback metadata',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await fallbackDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const state = await fallbackState.load();
      const task = state.tasks['fallback-metadata-task'];
      if (!task) throw new Error('Task not found');
      delete task.attemptCount;
      delete task.maxAttempts;
      delete task.verificationHistory;
      delete task.hasChildren;
      await fallbackState.save(state);

      const fallbackInternal = fallbackDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          ciFailed: boolean;
          prUrl: string;
        }>;
      };
      vi.spyOn(fallbackInternal, 'checkForResult').mockResolvedValue({
        branch: 'fallback-branch',
        commits: 1,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1001',
      });

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(verify).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 1,
        })
      );

      const finalTask = await fallbackDispatcher.getTask('fallback-metadata-task');
      expect(finalTask?.status).toBe('failed');
      expect(finalTask?.verificationHistory).toHaveLength(1);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            result: expect.objectContaining({
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/1001',
            }),
          }),
        })
      );
      vi.useRealTimers();
    });

    it('skips duplicate completion handling when completion is already in progress', async () => {
      vi.useFakeTimers();
      const duplicateState = createStatePersistence();
      const duplicateDispatcher = new TaskDispatcher(
        mockConfig,
        duplicateState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'duplicate-guard-task',
        workerType: 'auto',
        prompt: 'Duplicate guard',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await duplicateDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = duplicateDispatcher as unknown as {
        completionInProgress: Set<string>;
      };
      internal.completionInProgress.add('duplicate-guard-task');
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await duplicateDispatcher.getTask('duplicate-guard-task');
      expect(task?.status).toBe('running');
      expect(mockWebhookClient.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('API key validation', () => {
    it('should fail non-GLM task when Anthropic API key is invalid', async () => {
      const invalidValidator = {
        validate: vi.fn(async () => ({ valid: false, errorMessage: 'HTTP 401 Unauthorized' })),
      } as unknown as ApiKeyValidator;

      const invalidIsolationConfig: IsolationConfig = {
        ...mockIsolationConfig,
        apiKeyValidator: invalidValidator,
      };

      const validationDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        invalidIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'invalid-key-test',
        workerType: 'auto',
        prompt: 'Test invalid key',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await validationDispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(validationDispatcher.getRunningCount()).toBe(0);
      expect(invalidValidator.validate).toHaveBeenCalledWith('anthropic');
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'invalid-key-test',
            status: 'failed',
            error: expect.objectContaining({
              code: 'SETUP_FAILED',
              message: 'Anthropic API key is invalid: HTTP 401 Unauthorized',
            }),
          }),
        })
      );
    });

    it('should use fallback message when errorMessage is undefined', async () => {
      const noMsgValidator = {
        validate: vi.fn(async () => ({ valid: false })),
      } as unknown as ApiKeyValidator;

      const noMsgIsolationConfig: IsolationConfig = {
        ...mockIsolationConfig,
        apiKeyValidator: noMsgValidator,
      };

      const noMsgDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        noMsgIsolationConfig,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'no-msg-key-test',
        workerType: 'opus',
        prompt: 'Test no message',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await noMsgDispatcher.submitTask(request);
      await flushAsync();

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              message: 'Anthropic API key is invalid: authentication failed',
            }),
          }),
        })
      );
    });

    it('should skip API key validation for GLM tasks', async () => {
      const request: CreateTaskRequest = {
        taskId: 'glm-skip-validation',
        workerType: 'glm',
        prompt: 'Test GLM task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockApiKeyValidator.validate).not.toHaveBeenCalled();
    });

    it('should proceed when Anthropic API key is valid', async () => {
      const request: CreateTaskRequest = {
        taskId: 'valid-key-test',
        workerType: 'opus',
        prompt: 'Test valid key',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockApiKeyValidator.validate).toHaveBeenCalledWith('anthropic');
    });
  });
});
