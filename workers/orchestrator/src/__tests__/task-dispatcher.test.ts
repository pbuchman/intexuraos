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
import type { TaskResult } from '../types/task.js';
import type { OrchestratorState } from '../types/state.js';
import type { IsolationProvider, WorkerHandle } from '../services/isolation/types.js';
import type { TokenRefresher } from '../services/isolation/token-refresher.js';
import type { ApiKeyValidator } from '../services/api-key-validator.js';
import type { TurnMetricsCollector } from '../services/turn-metrics-collector.js';
import type { CompletionAgentType } from '../services/completion-verifier.js';

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

const phase1FinalAssistantLog = (outcome: 'planned' | 'unclear'): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: `PLANNING_AGENT_FINAL:
- Outcome: ${outcome}
- superpowers_writing_plans_used: 1
- Original issue: https://linear.app/intexuraos/issue/INT-123
- Planning issue: ${outcome === 'planned' ? 'https://linear.app/intexuraos/issue/INT-456' : ''}
- Trivial task: ${outcome === 'planned' ? '1' : ''}
- Parallel breakdown proof: 
- Plan doc: 
- Planning PR: 
- Clarification message: ${outcome === 'unclear' ? 'Need API contract details from user' : ''}
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
          text: `EXECUTION_AGENT_FINAL:
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
    getSecrets: () => ({
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      LINEAR_API_KEY: 'test-linear-key',
      SENTRY_AUTH_TOKEN: 'test-sentry-token',
      ZAI_API_KEY: 'test-zai-key',
      MINIMAX_API_KEY: 'test-minimax-key',
    }),
    gcpSaKeyPath: '/tmp/gcp-sa.json',
    githubAppKeyPath: '/tmp/github-app.pem',
  };

  // Mock LogForwarder
  const mockLogForwarder = {
    startForwarding: vi.fn(),
    stopForwarding: vi.fn(async () => undefined),
    flushAndStop: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    close: vi.fn(),
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
    verifierFailure?: boolean;
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

    it('should use default baseBranch when not provided', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-default-branch',
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
      expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith(
        'test-task-default-branch',
        'development'
      );
    });

    it('should store baseBranch on Task object', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-branch-stored',
        workerType: 'auto',
        prompt: 'Test prompt',
        baseBranch: 'custom-branch',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      const task = await dispatcher.getTask('test-task-branch-stored');
      expect(task).not.toBeNull();
      expect(task?.baseBranch).toBe('custom-branch');
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

      vi.spyOn(statePersistence, 'modify').mockRejectedValueOnce(new Error('DB error'));

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
        phase1FinalAssistantLog('unclear')
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
        phase1FinalAssistantLog('unclear')
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

  describe('agentType priority', () => {
    const getInstructionsLog = (): string | undefined =>
      vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.find(
          (call) => typeof call[1] === 'string' && call[1].includes('[instructions]')
        )?.[1] as string | undefined;

    it('uses agentType=execution over missing code-task label', async () => {
      const request: CreateTaskRequest = {
        taskId: 'exec-phase-override-task',
        workerType: 'auto',
        prompt: 'Test execution phase override',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['bug'],
        hasChildren: false,
        agentType: 'execution',
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const log = getInstructionsLog();
      expect(log).toBeDefined();
      expect(log).toContain('Execution Agent');
    });

    it('uses agentType=planning over present code-task label', async () => {
      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      const request: CreateTaskRequest = {
        taskId: 'design-phase-override-task',
        workerType: 'auto',
        prompt: 'Test design phase override',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        agentType: 'planning',
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const log = getInstructionsLog();
      expect(log).toBeDefined();
      expect(log).toContain('Planning Agent');
    });

    it('falls back to label detection when agentType is absent', async () => {
      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      const request: CreateTaskRequest = {
        taskId: 'label-fallback-task',
        workerType: 'auto',
        prompt: 'Test label fallback',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const log = getInstructionsLog();
      expect(log).toBeDefined();
      expect(log).toContain('Execution Agent');
    });

    it('stores agentType on the task', async () => {
      const request: CreateTaskRequest = {
        taskId: 'exec-phase-stored-task',
        workerType: 'auto',
        prompt: 'Test phase storage',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const task = await dispatcher.getTask('exec-phase-stored-task');
      expect(task?.agentType).toBe('execution');
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

    it('fails immediately when verifier reports Gemini failure', async () => {
      vi.useFakeTimers();
      const verifierFailureState = createStatePersistence();
      const verify = vi.fn().mockResolvedValue({
        passed: false,
        confidence: 0,
        reasons: ['Gemini verifier unavailable: rate limited'],
        missingCriteria: ['Gemini verifier response'],
        resumeInstruction: 'Retry once verifier is healthy.',
        usedLlm: true,
        verifierFailure: true,
      });

      const verifierFailureDispatcher = new TaskDispatcher(
        mockConfig,
        verifierFailureState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        {
          maxAttempts: 3,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: true }),
          },
        }
      );

      const verifierFailureInternal = verifierFailureDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          ciFailed: boolean;
          prUrl: string;
        }>;
      };
      vi.spyOn(verifierFailureInternal, 'checkForResult').mockResolvedValue({
        branch: 'verifier-failure-branch',
        commits: 2,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1234',
      });

      const request: CreateTaskRequest = {
        taskId: 'verifier-failure-task',
        workerType: 'auto',
        prompt: 'Verifier failure should fail task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await verifierFailureDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await verifierFailureDispatcher.getTask('verifier-failure-task');
      expect(task?.status).toBe('failed');
      expect(task?.attemptCount).toBe(1);
      expect(task?.verificationHistory?.[0]?.verifierFailure).toBe(true);
      expect(mockIsolationProvider.createWorker).toHaveBeenCalledTimes(1);
      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            result: expect.objectContaining({
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/1234',
            }),
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFIER_FAILED',
              message: expect.stringContaining('Gemini verifier unavailable'),
            }),
          }),
        })
      );
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

    it('logs verifier summary fallback placeholders when reasons are empty', async () => {
      vi.useFakeTimers();
      const fallbackSummaryState = createStatePersistence();
      const verify = vi.fn().mockResolvedValue({
        passed: true,
        confidence: 1,
        reasons: [],
        missingCriteria: [],
        resumeInstruction: 'done',
        usedLlm: true,
      });

      const fallbackSummaryDispatcher = new TaskDispatcher(
        mockConfig,
        fallbackSummaryState,
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
            describe: (): { enabled: boolean } => ({ enabled: true }),
          },
        }
      );

      const request: CreateTaskRequest = {
        taskId: 'empty-verifier-reasons-task',
        workerType: 'auto',
        prompt: 'Verifier fallback placeholders',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await fallbackSummaryDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await fallbackSummaryDispatcher.getTask('empty-verifier-reasons-task');
      expect(task?.status).toBe('completed');
      expect(mockLogForwarder.appendChunk).toHaveBeenCalledWith(
        'empty-verifier-reasons-task',
        expect.stringContaining('Passed: true | Confidence: 1.00')
      );
      expect(mockLogForwarder.appendChunk).toHaveBeenCalledWith(
        'empty-verifier-reasons-task',
        expect.stringContaining('Resume: done')
      );
      vi.useRealTimers();
    });

    it('logs non-Error worker start failures and fails setup webhook', async () => {
      const createWorker = vi.fn().mockRejectedValue('opaque-start-error');
      const localIsolationProvider: IsolationProvider = {
        ...mockIsolationProvider,
        createWorker,
      };
      const localWorktreeManager = {
        ...mockWorktreeManager,
        removeWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
      } as unknown as WorktreeManager;
      const localIsolation: IsolationConfig = {
        ...mockIsolationConfig,
        provider: localIsolationProvider,
      };

      const localDispatcher = new TaskDispatcher(
        mockConfig,
        createStatePersistence(),
        localWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        localIsolation,
        singleAttemptCompletionControl
      );

      const request: CreateTaskRequest = {
        taskId: 'non-error-worker-start',
        workerType: 'auto',
        prompt: 'Worker start failure branch',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await localDispatcher.submitTask(request);
      await flushAsync();

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            taskId: 'non-error-worker-start',
            status: 'failed',
            error: expect.objectContaining({ code: 'SETUP_FAILED' }),
          }),
        })
      );
      expect(mockLogForwarder.appendChunk).toHaveBeenCalledWith(
        'non-error-worker-start',
        expect.stringContaining('Worker start failed: opaque-start-error')
      );
    });

    it('preserves failed worker container when preserveFailedContainers is enabled', async () => {
      vi.useFakeTimers();
      const preserveState = createStatePersistence();
      const localDestroyWorker = vi.fn(async () => undefined);
      const localPreserveWorker = vi.fn(async () => undefined);
      const localIsolationProvider: IsolationProvider = {
        ...mockIsolationProvider,
        destroyWorker: localDestroyWorker,
        isWorkerRunning: vi.fn(async () => false),
        preserveWorker: localPreserveWorker,
      };
      const localIsolation: IsolationConfig = {
        ...mockIsolationConfig,
        provider: localIsolationProvider,
      };
      const verify = vi.fn().mockResolvedValue({
        passed: false,
        confidence: 0.25,
        reasons: ['missing completion criteria'],
        missingCriteria: ['criteria A'],
        resumeInstruction: 'Fix and retry',
        usedLlm: true,
      });

      const preserveDispatcher = new TaskDispatcher(
        mockConfig,
        preserveState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        localIsolation,
        {
          maxAttempts: 1,
          preserveFailedContainers: true,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: true }),
          },
        }
      );

      const request: CreateTaskRequest = {
        taskId: 'preserve-failed-container-task',
        workerType: 'auto',
        prompt: 'Fail and preserve container',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await preserveDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await preserveDispatcher.getTask('preserve-failed-container-task');
      expect(task?.status).toBe('failed');
      expect(localDestroyWorker).not.toHaveBeenCalled();
      expect(localPreserveWorker).toHaveBeenCalledWith('preserve-failed-container-task');
      expect(mockLogForwarder.appendChunk).toHaveBeenCalledWith(
        'preserve-failed-container-task',
        expect.stringContaining('Preserving worker container for debugging')
      );
      vi.useRealTimers();
    });

    it('preserves container when interrupted finalization is invoked with preserve flag', async () => {
      const preserveState = createStatePersistence();
      const localDestroyWorker = vi.fn(async () => undefined);
      const localPreserveWorker = vi.fn(async () => undefined);
      const localIsolationProvider: IsolationProvider = {
        ...mockIsolationProvider,
        destroyWorker: localDestroyWorker,
        preserveWorker: localPreserveWorker,
      };
      const localIsolation: IsolationConfig = {
        ...mockIsolationConfig,
        provider: localIsolationProvider,
      };

      const preserveDispatcher = new TaskDispatcher(
        mockConfig,
        preserveState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        localIsolation,
        {
          maxAttempts: 1,
          preserveFailedContainers: true,
          verifier: {
            verify: vi.fn().mockResolvedValue({
              passed: true,
              confidence: 1,
              reasons: ['ok'],
              missingCriteria: [],
              resumeInstruction: 'done',
              usedLlm: true,
            }),
            describe: (): { enabled: boolean } => ({ enabled: true }),
          },
        }
      );

      const taskId = 'preserve-interrupted-branch';
      await preserveDispatcher.submitTask({
        taskId,
        workerType: 'auto',
        prompt: 'Finalize interrupted branch',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      });
      await flushAsync();

      const task = await preserveDispatcher.getTask(taskId);
      if (task === null) {
        throw new Error('Task not found');
      }

      const preserveInternal = preserveDispatcher as unknown as {
        finalizeTask: (
          taskArg: Record<string, unknown>,
          finalStatus: 'interrupted',
          payload: { result?: unknown; error?: unknown }
        ) => Promise<void>;
      };
      await preserveInternal.finalizeTask(
        task as unknown as Record<string, unknown>,
        'interrupted',
        {}
      );

      expect(localDestroyWorker).not.toHaveBeenCalled();
      expect(localPreserveWorker).toHaveBeenCalledWith(taskId);
      expect(mockLogForwarder.appendChunk).toHaveBeenCalledWith(
        taskId,
        expect.stringContaining('Preserving worker container for debugging')
      );
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

  describe('log flush in finalizeTask', () => {
    it('calls flush and close before terminal webhook', async () => {
      const drainState = createStatePersistence();
      const drainLogForwarder = {
        ...mockLogForwarder,
        flush: vi.fn(async () => undefined),
        close: vi.fn(),
      } as unknown as LogForwarder;

      const drainDispatcher = new TaskDispatcher(
        mockConfig,
        drainState,
        mockWorktreeManager,
        drainLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        {
          maxAttempts: 1,
          verifier: {
            verify: vi.fn().mockResolvedValue({
              passed: true,
              confidence: 1,
              reasons: ['ok'],
              missingCriteria: [],
              resumeInstruction: 'done',
              usedLlm: true,
            }),
            describe: (): { enabled: boolean } => ({ enabled: true }),
          },
        }
      );

      await drainDispatcher.submitTask({
        taskId: 'drain-test',
        workerType: 'auto',
        prompt: 'Drain test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      });
      await flushAsync();

      const task = await drainDispatcher.getTask('drain-test');
      if (task === null) throw new Error('Task not found');

      const internal = drainDispatcher as unknown as {
        finalizeTask: (
          t: Record<string, unknown>,
          s: string,
          p: { result?: unknown; error?: unknown }
        ) => Promise<void>;
      };
      await internal.finalizeTask(task as unknown as Record<string, unknown>, 'completed', {});

      expect(drainLogForwarder.flush).toHaveBeenCalledWith('drain-test');
      expect(drainLogForwarder.close).toHaveBeenCalledWith('drain-test');

      const webhookCalls = vi.mocked(mockWebhookClient.send).mock.calls;
      const terminalCall = webhookCalls.find(
        (c) => (c[0] as { payload: { taskId: string } }).payload.taskId === 'drain-test'
      );
      expect(terminalCall).toBeDefined();
    });
  });

  describe('formatClaudeSystemMessages via onLog', () => {
    const submitAndGetOnLog = async (): Promise<(chunk: string) => void> => {
      vi.useFakeTimers();
      const request: CreateTaskRequest = {
        taskId: 'format-test',
        workerType: 'auto',
        prompt: 'Test formatting',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      const call = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = call?.[0]?.onLog;
      if (onLog === undefined) throw new Error('Expected onLog callback');
      vi.useRealTimers();
      return onLog;
    };

    const findFormattedChunk = (marker: string): string => {
      const appendCall = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.find((c) => typeof c[1] === 'string' && c[1].includes(marker));
      if (appendCall === undefined)
        throw new Error(`Expected appendChunk call containing "${marker}"`);
      return appendCall[1] as string;
    };

    it('should format system init messages', async () => {
      const onLog = await submitAndGetOnLog();
      const initJson = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-5-20250929',
        tools: ['Task', 'Bash', 'Glob'],
        mcp_servers: [
          { name: 'linear', status: 'connected' },
          { name: 'sentry', status: 'failed' },
        ],
        permissionMode: 'bypassPermissions',
        version: '2.1.41',
        session_id: 'abc123',
        cwd: '/repo',
      });

      onLog(initJson + '\n');

      const formatted = findFormattedChunk('[claude] Session init');
      expect(formatted).toContain('model=claude-sonnet-4-5-20250929');
      expect(formatted).toContain('tools=3');
      expect(formatted).toContain('mcp=[linear:ok, sentry:fail]');
      expect(formatted).toContain('mode=bypassPermissions');
      expect(formatted).toContain('v2.1.41');
    });

    it('should format init message without mcp_servers', async () => {
      const onLog = await submitAndGetOnLog();
      const initJson = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-5-20250929',
        tools: [],
        permissionMode: 'plan',
        version: '2.0.0',
      });

      onLog(initJson + '\n');

      const formatted = findFormattedChunk('[claude] Session init');
      expect(formatted).toContain('tools=0');
      expect(formatted).not.toContain('mcp=');
      expect(formatted).toContain('mode=plan');
    });

    it('should pass through assistant JSON unchanged', async () => {
      const onLog = await submitAndGetOnLog();
      const assistantJson = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg-1',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });

      onLog(assistantJson + '\n');

      const formatted = findFormattedChunk('"type":"assistant"');
      expect(formatted).toContain(assistantJson);
    });

    it('should pass through result JSON unchanged', async () => {
      const onLog = await submitAndGetOnLog();
      const resultJson = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        num_turns: 3,
        duration_ms: 204353,
        total_cost_usd: 0.15,
        result: 'API Error: 429 rate limited',
      });

      onLog(resultJson + '\n');

      const formatted = findFormattedChunk('"type":"result"');
      expect(formatted).toContain(resultJson);
    });

    it('should pass through non-JSON lines unchanged', async () => {
      const onLog = await submitAndGetOnLog();

      onLog('Plain text log line\n');

      const formatted = findFormattedChunk('Plain text log line');
      expect(formatted).toBe('Plain text log line\n');
    });

    it('should pass through unknown JSON types unchanged', async () => {
      const onLog = await submitAndGetOnLog();
      const unknownJson = JSON.stringify({ type: 'unknown', data: 'something' });

      onLog(unknownJson + '\n');

      findFormattedChunk('"type":"unknown"');
    });

    it('should pass through assistant tool_use JSON unchanged', async () => {
      const onLog = await submitAndGetOnLog();
      const assistantJson = JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg-3',
          content: [{ type: 'tool_use', name: 'Bash' }],
        },
      });

      onLog(assistantJson + '\n');

      const formatted = findFormattedChunk('"type":"assistant"');
      expect(formatted).toContain(assistantJson);
    });

    it('should format init message with missing optional fields', async () => {
      const onLog = await submitAndGetOnLog();
      const initJson = JSON.stringify({
        type: 'system',
        subtype: 'init',
      });

      onLog(initJson + '\n');

      const formatted = findFormattedChunk('[claude] Session init');
      expect(formatted).toContain('model=unknown');
      expect(formatted).toContain('tools=0');
      expect(formatted).toContain('mode=unknown');
      expect(formatted).toContain('v?');
    });

    it('should strip tool_use_result from user messages', async () => {
      const onLog = await submitAndGetOnLog();
      const userJson = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              tool_use_id: 'call_123',
              type: 'tool_result',
              content: 'The file /repo/src/index.ts has been updated successfully.',
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
        tool_use_result: {
          filePath: '/repo/src/index.ts',
          oldString: 'a'.repeat(30000),
          newString: 'b'.repeat(30000),
        },
      });

      onLog(userJson + '\n');

      const formatted = findFormattedChunk('tool_result');
      expect(formatted).toContain(
        '"content":"The file /repo/src/index.ts has been updated successfully."'
      );
      expect(formatted).not.toContain('tool_use_result');
      expect(formatted).not.toContain('aaa');
    });
  });

  describe('turn metrics collection', () => {
    it('calls collectAndPublish on task completion', async () => {
      vi.useFakeTimers();

      const mockCollector: TurnMetricsCollector = {
        collectAndPublish: vi.fn().mockResolvedValue(undefined),
      } as unknown as TurnMetricsCollector;

      const metricsDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        mockCollector
      );

      const request: CreateTaskRequest = {
        taskId: 'metrics-test',
        workerType: 'auto',
        prompt: 'Test metrics collection',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await metricsDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      // Simulate container stop
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockCollector.collectAndPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'metrics-test',
          attempt: 1,
          containerId: expect.any(String),
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        })
      );

      vi.useRealTimers();
    });

    it('does not call collectAndPublish when collector is not provided', async () => {
      vi.useFakeTimers();

      // dispatcher (from beforeEach) has no turnMetricsCollector
      const request: CreateTaskRequest = {
        taskId: 'no-metrics-test',
        workerType: 'auto',
        prompt: 'Test without metrics',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      // No error thrown, task completes normally without metrics
      const task = await dispatcher.getTask('no-metrics-test');
      expect(task?.status).toBe('completed');

      vi.useRealTimers();
    });
  });

  describe('buildResumePreamble', () => {
    it('returns preamble with PR state check instructions', () => {
      const internal = dispatcher as unknown as {
        buildResumePreamble: () => string;
      };
      const preamble = internal.buildResumePreamble();

      expect(preamble).toContain('[RESUME PRE-FLIGHT');
      expect(preamble).toContain('gh pr view --json state,merged,number');
      expect(preamble).toContain('MERGED or CLOSED or NO_PR');
      expect(preamble).toContain('git checkout -b followup/');
      expect(preamble).toContain('If PR is OPEN:');
      expect(preamble).toContain('unaddressed PR comments');
      expect(preamble).toContain('---');
      expect(preamble.endsWith('\n')).toBe(true);
    });
  });

  describe('buildActiveGoalSection', () => {
    it('strips resume preamble and wraps user message', () => {
      const internal = dispatcher as unknown as {
        buildActiveGoalSection: (prompt: string) => string;
        buildResumePreamble: () => string;
      };
      const preamble = internal.buildResumePreamble();
      const userMessage =
        '[PR Comment] New comment on PR #849\nFrom: @pbuchman\nThe commenter said:\nFix the bug';
      const combined = preamble + userMessage;

      const result = internal.buildActiveGoalSection(combined);

      expect(result).toContain('[ACTIVE GOAL');
      expect(result).toContain('[PR Comment] New comment on PR #849');
      expect(result).toContain('Fix the bug');
      expect(result).not.toContain('[RESUME PRE-FLIGHT');
    });

    it('handles prompt without preamble', () => {
      const internal = dispatcher as unknown as {
        buildActiveGoalSection: (prompt: string) => string;
      };
      const result = internal.buildActiveGoalSection('Just a plain message');

      expect(result).toContain('[ACTIVE GOAL');
      expect(result).toContain('Just a plain message');
    });
  });

  describe('active goal in systemPrompt (integration)', () => {
    it('includes active goal in system prompt when resuming completed task', async () => {
      const request: CreateTaskRequest = {
        taskId: 'active-goal-resume-test',
        workerType: 'auto',
        prompt: 'Original task prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

      // Mark task as completed so sendMessage triggers resume
      const state = await statePersistence.load();
      const task = state.tasks['active-goal-resume-test'];
      if (!task) throw new Error('Task not found');
      task.status = 'completed';
      await statePersistence.save(state);

      vi.mocked(mockIsolationProvider.createWorker).mockClear();

      const result = await dispatcher.sendMessage(
        'active-goal-resume-test',
        'User follow-up message'
      );
      await flushAsync();

      expect(result.ok).toBe(true);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls[0];
      expect(createWorkerCall).toBeDefined();
      const config = createWorkerCall?.[0];
      expect(config?.systemPrompt).toContain('[ACTIVE GOAL');
      expect(config?.systemPrompt).toContain('User follow-up message');
    });

    it('does not include active goal in system prompt for initial submission', async () => {
      vi.mocked(mockIsolationProvider.createWorker).mockClear();

      const request: CreateTaskRequest = {
        taskId: 'active-goal-initial-test',
        workerType: 'auto',
        prompt: 'Initial task prompt',
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
      expect(config?.systemPrompt).not.toContain('[ACTIVE GOAL');
    });
  });

  describe('resumedAfterSuccess', () => {
    let resumedDispatcher: TaskDispatcher;
    let resumedStatePersistence: StatePersistence;

    beforeEach(() => {
      vi.useFakeTimers();
      resumedStatePersistence = createStatePersistence();
      resumedDispatcher = new TaskDispatcher(
        mockConfig,
        resumedStatePersistence,
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

    it('uses loosened verification when resumedAfterSuccess is set', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-loosened-test',
        workerType: 'auto',
        prompt: 'Test resumed loosened verification',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-loosened-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockClear();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(singleAttemptCompletionControl.verifier.verify).not.toHaveBeenCalled();

      const finalTask = await resumedDispatcher.getTask('resumed-loosened-test');
      expect(finalTask?.status).toBe('completed');
      expect(finalTask?.verificationHistory).toHaveLength(1);
      expect(finalTask?.verificationHistory?.[0]?.usedLlm).toBe(false);
      expect(finalTask?.verificationHistory?.[0]?.passed).toBe(true);
      expect(finalTask?.verificationHistory?.[0]?.reasons).toContain(
        'Loosened verification passed (resumed after success)'
      );
    });

    it('fails on non-zero exit code with TASK_RESUMED_HARD_ERROR', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-exit-code-test',
        workerType: 'auto',
        prompt: 'Test resumed exit code failure',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onComplete).toBeDefined();
      onComplete?.(1);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-exit-code-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-exit-code-test');
      expect(finalTask?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_RESUMED_HARD_ERROR',
              message: expect.stringContaining('Non-zero exit code: 1'),
            }),
          }),
        })
      );
    });

    it('fails on Claude error with TASK_RESUMED_HARD_ERROR', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-claude-error-test',
        workerType: 'auto',
        prompt: 'Test resumed Claude error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();
      onLog?.('{"type":"result","is_error":true,"result":"Task failed: rate limited"}\n');

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-claude-error-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-claude-error-test');
      expect(finalTask?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_RESUMED_HARD_ERROR',
              message: expect.stringContaining('Claude error'),
            }),
          }),
        })
      );
    });

    it('delivers pending messages before finalizing', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-pending-msg-test',
        workerType: 'auto',
        prompt: 'Test resumed pending messages',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-pending-msg-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      const internal = resumedDispatcher as unknown as {
        pendingMessages: Map<string, string[]>;
      };
      internal.pendingMessages.set('resumed-pending-msg-test', ['Follow-up message']);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const afterDelivery = await resumedDispatcher.getTask('resumed-pending-msg-test');
      expect(afterDelivery?.status).toBe('running');

      expect(mockIsolationProvider.createWorker).toHaveBeenCalledTimes(2);
      const deliveryCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      expect(deliveryCall?.[0]?.prompt).toBe('Follow-up message');
    });

    it('clears resumedAfterSuccess after finalization', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-flag-clear-test',
        workerType: 'auto',
        prompt: 'Test resumed flag clearing',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-flag-clear-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-flag-clear-test');
      expect(finalTask?.status).toBe('completed');
      expect(finalTask?.resumedAfterSuccess).toBeUndefined();
    });
  });

  describe('activity heartbeat', () => {
    let heartbeatDispatcher: TaskDispatcher;
    let heartbeatStatePersistence: StatePersistence;

    beforeEach(() => {
      vi.useFakeTimers();
      heartbeatStatePersistence = createStatePersistence();
      heartbeatDispatcher = new TaskDispatcher(
        mockConfig,
        heartbeatStatePersistence,
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

    it('should emit heartbeat after 30s of silence', async () => {
      const request: CreateTaskRequest = {
        taskId: 'heartbeat-test',
        workerType: 'auto',
        prompt: 'Test heartbeat',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await heartbeatDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);

      // Advance 30s — triggers completion monitor, no output received
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const heartbeatCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('[system]'));
      expect(heartbeatCalls.length).toBe(1);
      expect(heartbeatCalls[0]?.[1]).toContain('Still processing...');
      expect(heartbeatCalls[0]?.[1]).toContain('no output for 30s');
    });

    it('should not emit heartbeat when output is flowing', async () => {
      const request: CreateTaskRequest = {
        taskId: 'heartbeat-active-test',
        workerType: 'auto',
        prompt: 'Test heartbeat active',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await heartbeatDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);

      // Grab onLog callback from createWorker
      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      // Simulate output at 15s — within the 30s window
      await vi.advanceTimersByTimeAsync(15 * 1000);
      onLog?.('Some output\n');

      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      // Advance another 15s to hit the 30s monitor tick — only 15s since last output
      await vi.advanceTimersByTimeAsync(15 * 1000);

      const heartbeatCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('[system]'));
      expect(heartbeatCalls.length).toBe(0);
    });

    it('should show correct elapsed time in heartbeat', async () => {
      const request: CreateTaskRequest = {
        taskId: 'heartbeat-elapsed-test',
        workerType: 'auto',
        prompt: 'Test heartbeat elapsed',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await heartbeatDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);

      // First tick at 30s
      await vi.advanceTimersByTimeAsync(30 * 1000);
      // Second tick at 60s
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const heartbeatCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('[system]'));
      expect(heartbeatCalls.length).toBe(2);
      expect(heartbeatCalls[0]?.[1]).toContain('no output for 30s');
      expect(heartbeatCalls[1]?.[1]).toContain('no output for 60s');
    });
  });

  describe('observability logging', () => {
    const getOrchestratorLogs = (): string[] =>
      vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter(
          (call) => typeof call[1] === 'string' && call[1].includes('[orchestrator]')
        )
        .map((call) => call[1] as string);

    const getPromptLogs = (): string[] =>
      vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('[prompt]'))
        .map((call) => call[1] as string);

    it('logs result details after checkForResult', async () => {
      vi.useFakeTimers();
      const obsState = createStatePersistence();
      const obsDispatcher = new TaskDispatcher(
        mockConfig,
        obsState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const obsInternal = obsDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(obsInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/obs-test',
        commits: 3,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/500',
      });

      const request: CreateTaskRequest = {
        taskId: 'obs-result-log-task',
        workerType: 'auto',
        prompt: 'Test result logging',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await obsDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const logs = getOrchestratorLogs();
      const resultLog = logs.find((l) => l.includes('Result: prUrl='));
      expect(resultLog).toBeDefined();
      expect(resultLog).toContain('prUrl=https://github.com/pbuchman/intexuraos/pull/500');
      expect(resultLog).toContain('branch=feat/obs-test');
      expect(resultLog).toContain('commits=3');
      expect(resultLog).toContain('ciFailed=false');
      vi.useRealTimers();
    });

    it('logs result diff when previous result exists and values changed', async () => {
      vi.useFakeTimers();
      const diffState = createStatePersistence();
      const verify = vi
        .fn()
        .mockResolvedValueOnce({
          passed: false,
          confidence: 0.4,
          reasons: ['incomplete'],
          missingCriteria: ['PR required'],
          resumeInstruction: 'Create PR',
          usedLlm: false,
        })
        .mockResolvedValueOnce({
          passed: false,
          confidence: 0.5,
          reasons: ['CI failing'],
          missingCriteria: ['CI pass'],
          resumeInstruction: 'Fix CI',
          usedLlm: false,
        })
        .mockResolvedValueOnce({
          passed: true,
          confidence: 0.95,
          reasons: ['all criteria met'],
          missingCriteria: [],
          resumeInstruction: 'No action required',
          usedLlm: false,
        });

      const diffDispatcher = new TaskDispatcher(
        mockConfig,
        diffState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        {
          maxAttempts: 3,
          verifier: {
            verify,
            describe: (): { enabled: boolean } => ({ enabled: false }),
          },
        }
      );

      const diffInternal = diffDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(diffInternal, 'checkForResult')
        .mockResolvedValueOnce({
          branch: 'feat/diff-test',
          commits: 1,
          ciFailed: true,
        })
        .mockResolvedValueOnce({
          branch: 'feat/diff-test',
          commits: 3,
          ciFailed: false,
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/600',
        })
        .mockResolvedValueOnce({
          branch: 'feat/diff-test',
          commits: 4,
          ciFailed: false,
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/600',
        });

      const request: CreateTaskRequest = {
        taskId: 'obs-diff-task',
        workerType: 'auto',
        prompt: 'Test result diff',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await diffDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      // First attempt completes, verification fails, retry starts
      await vi.advanceTimersByTimeAsync(30 * 1000);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      // Second attempt completes — previousResult now exists, diff should be logged
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const logs = getOrchestratorLogs();
      const diffLog = logs.find((l) => l.includes('Result diff:'));
      expect(diffLog).toBeDefined();
      expect(diffLog).toContain('commits 1→3');
      expect(diffLog).toContain('ciFailed true→false');
      expect(diffLog).toContain('prUrl (new)');
      vi.useRealTimers();
    });

    it('logs signal breakdown in adaptive retry task log', async () => {
      vi.useFakeTimers();
      const sigState = createStatePersistence();
      const verify = vi
        .fn()
        .mockResolvedValueOnce({
          passed: false,
          confidence: 0.4,
          reasons: ['incomplete'],
          missingCriteria: ['CI pass'],
          resumeInstruction: 'Run CI',
          usedLlm: false,
        })
        .mockResolvedValueOnce({
          passed: true,
          confidence: 0.95,
          reasons: ['done'],
          missingCriteria: [],
          resumeInstruction: 'No action required',
          usedLlm: false,
        });

      const sigDispatcher = new TaskDispatcher(
        mockConfig,
        sigState,
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

      const sigInternal = sigDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(sigInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/sig-test',
        commits: 2,
        ciFailed: true,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/700',
      });

      const request: CreateTaskRequest = {
        taskId: 'obs-signal-task',
        workerType: 'auto',
        prompt: 'Test signal breakdown',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await sigDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const logs = getOrchestratorLogs();
      const retryLog = logs.find((l) => l.includes('Adaptive retry:'));
      expect(retryLog).toBeDefined();
      expect(retryLog).toContain('resultProgress=');
      expect(retryLog).toContain('verificationTrend=');
      expect(retryLog).toContain('score=');
      expect(retryLog).toContain('effective=');
      vi.useRealTimers();
    });

    it('logs phase mismatch warning when Phase 1 task creates a PR', async () => {
      vi.useFakeTimers();
      const phaseState = createStatePersistence();
      const phaseDispatcher = new TaskDispatcher(
        mockConfig,
        phaseState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const phaseInternal = phaseDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(phaseInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/phase-mismatch',
        commits: 1,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/800',
      });

      const warnSpy = vi.spyOn(mockLogger, 'warn');

      const request: CreateTaskRequest = {
        taskId: 'obs-phase-mismatch-task',
        workerType: 'auto',
        prompt: 'Design-only task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await phaseDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const logs = getOrchestratorLogs();
      const mismatchLog = logs.find((l) => l.includes('[WARN] Agent mismatch'));
      expect(mismatchLog).toBeDefined();
      expect(mismatchLog).toContain('task ran as Planning Agent but worker created PR');
      expect(mismatchLog).toContain('https://github.com/pbuchman/intexuraos/pull/800');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'obs-phase-mismatch-task',
          agentType: 'planning',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/800',
        }),
        'Agent mismatch: Planning Agent task created a PR'
      );
      vi.useRealTimers();
    });

    it('does not log phase mismatch for Phase 2 tasks with PR', async () => {
      vi.useFakeTimers();
      const noMismatchState = createStatePersistence();
      const noMismatchDispatcher = new TaskDispatcher(
        mockConfig,
        noMismatchState,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl
      );

      const noMismatchInternal = noMismatchDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(noMismatchInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/no-mismatch',
        commits: 2,
        ciFailed: false,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/801',
      });

      const request: CreateTaskRequest = {
        taskId: 'obs-no-mismatch-task',
        workerType: 'auto',
        prompt: 'Code-task with PR',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await noMismatchDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const logs = getOrchestratorLogs();
      const mismatchLog = logs.find((l) => l.includes('[WARN] Phase mismatch'));
      expect(mismatchLog).toBeUndefined();
      vi.useRealTimers();
    });

    it('logs truncated resume prompt when retrying', async () => {
      vi.useFakeTimers();
      const promptState = createStatePersistence();
      const verify = vi
        .fn()
        .mockResolvedValueOnce({
          passed: false,
          confidence: 0.3,
          reasons: ['not complete'],
          missingCriteria: ['final block'],
          resumeInstruction: 'Complete the implementation',
          usedLlm: false,
        })
        .mockResolvedValueOnce({
          passed: true,
          confidence: 0.95,
          reasons: ['done'],
          missingCriteria: [],
          resumeInstruction: 'No action required',
          usedLlm: false,
        });

      const promptDispatcher = new TaskDispatcher(
        mockConfig,
        promptState,
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

      const promptInternal = promptDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(promptInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/prompt-test',
        commits: 1,
        ciFailed: true,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/900',
      });

      const request: CreateTaskRequest = {
        taskId: 'obs-resume-prompt-task',
        workerType: 'auto',
        prompt: 'Implement the feature',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };

      await promptDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(mockLogForwarder.appendChunk).mockClear();
      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const promptLogs = getPromptLogs();
      const resumeLog = promptLogs.find((l) => l.includes('Resume prompt:'));
      expect(resumeLog).toBeDefined();
      expect(resumeLog).toContain('[prompt]');
      expect(resumeLog).toContain('Resume prompt:');
      vi.useRealTimers();
    });
  });

  describe('buildAgentContractGuidance', () => {
    it('returns phase1 guidance for phase1', () => {
      const internal = dispatcher as unknown as {
        buildAgentContractGuidance: (phase: CompletionAgentType) => string;
      };
      const guidance = internal.buildAgentContractGuidance('planning');

      expect(guidance).toContain('`Outcome` line');
      expect(guidance).toContain('planned');
      expect(guidance).toContain('unclear');
      expect(guidance).toContain('Linear issue');
      expect(guidance).toContain('Linear URL');
    });

    it('returns phase2 guidance for phase2', () => {
      const internal = dispatcher as unknown as {
        buildAgentContractGuidance: (phase: CompletionAgentType) => string;
      };
      const guidance = internal.buildAgentContractGuidance('execution');

      expect(guidance).toContain('`PR` line');
      expect(guidance).toContain('CI evidence');
      expect(guidance).toContain('pnpm run ci:tracked successful');
      expect(guidance).toContain('Review iterations');
      expect(guidance).toContain('digits only');
    });

    it('returns pr-comment guidance for pr-comment', () => {
      const internal = dispatcher as unknown as {
        buildAgentContractGuidance: (phase: CompletionAgentType) => string;
      };
      const guidance = internal.buildAgentContractGuidance('pull_request');

      expect(guidance).toContain('`PR` line');
      expect(guidance).toContain('CI evidence');
      expect(guidance).toContain('pnpm run ci:tracked successful');
      expect(guidance).toContain('Comment replied');
      expect(guidance).toContain('`yes` or `no`');
    });
  });

  describe('buildAgentFinalTemplate', () => {
    it('returns phase1 template for phase1', () => {
      const internal = dispatcher as unknown as {
        buildAgentFinalTemplate: (phase: CompletionAgentType) => string;
      };
      const template = internal.buildAgentFinalTemplate('planning');

      expect(template).toContain('PLANNING_AGENT_FINAL:');
      expect(template).toContain('Outcome: planned');
      expect(template).toContain('superpowers_writing_plans_used: 1');
      expect(template).toContain('Original issue:');
    });

    it('returns phase2 template for phase2', () => {
      const internal = dispatcher as unknown as {
        buildAgentFinalTemplate: (phase: CompletionAgentType) => string;
      };
      const template = internal.buildAgentFinalTemplate('execution');

      expect(template).toContain('EXECUTION_AGENT_FINAL:');
      expect(template).toContain('PR: https://github.com/');
      expect(template).toContain('CI evidence: pnpm run ci:tracked successful');
      expect(template).toContain('Review iterations:');
      expect(template).toContain('Linear issue:');
      expect(template).toContain('linear.app');
    });

    it('returns pr-comment template for pr-comment', () => {
      const internal = dispatcher as unknown as {
        buildAgentFinalTemplate: (phase: CompletionAgentType) => string;
      };
      const template = internal.buildAgentFinalTemplate('pull_request');

      expect(template).toContain('PULL_REQUEST_AGENT_FINAL:');
      expect(template).toContain('PR: https://github.com/');
      expect(template).toContain('CI evidence: pnpm run ci:tracked successful');
      expect(template).toContain('Comment replied:');
      expect(template).toContain('Linear issue:');
    });
  });
});
