import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec, type ChildProcess } from 'node:child_process';
import { TaskDispatcher, type IsolationConfig, parsePrUrl } from '../services/task-dispatcher.js';
import type { OrchestratorConfig } from '../types/config.js';
import type { StatePersistence } from '../services/state-persistence.js';
import type { WorktreeManager } from '../services/worktree-manager.js';
import type { LogForwarder } from '../services/log-forwarder.js';
import type { WebhookClient } from '../services/webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';
import type { CreateTaskRequest } from '../types/api.js';
import type { Task, TaskResult } from '../types/task.js';
import type { OrchestratorState } from '../types/state.js';
import type { IsolationProvider, WorkerHandle } from '../services/isolation/types.js';
import type { TokenRefresher } from '../services/isolation/token-refresher.js';
import type { ApiKeyValidator } from '../services/api-key-validator.js';
import type { TurnMetricsCollector } from '../services/turn-metrics-collector.js';
import type { CompletionVerifierVerdict } from '../services/completion-verifier.js';
import type { ExecutionDeepValidator } from '../services/execution-deep-validator.js';
import type { SessionJsonlEntry } from '../services/transcript-formatter.js';

vi.mock('../services/transcript-reader.js', () => ({
  readSessionTranscript: vi.fn(),
}));

vi.mock('../services/deep-validator-helpers.js', () => ({
  extractPrNumber: vi.fn(),
  fetchLinearIssueContext: vi.fn(),
  readPlanReferencedInLinearIssue: vi.fn(),
}));

import { readSessionTranscript } from '../services/transcript-reader.js';
import {
  extractPrNumber,
  fetchLinearIssueContext,
  readPlanReferencedInLinearIssue,
} from '../services/deep-validator-helpers.js';

const mockReadSessionTranscript = vi.mocked(readSessionTranscript);
const mockExtractPrNumber = vi.mocked(extractPrNumber);
const mockFetchLinearIssueContext = vi.mocked(fetchLinearIssueContext);
const mockReadPlanReferencedInLinearIssue = vi.mocked(readPlanReferencedInLinearIssue);

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

const planningFinalAssistantLog = (outcome: 'planned' | 'unclear'): string =>
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
- Child issues: ${outcome === 'planned' ? '1' : '0'}
- Plan doc:
- Planning PR: 
- Clarification message: ${outcome === 'unclear' ? 'Need API contract details from user' : ''}
- Summary: Planning completed`,
        },
      ],
    },
  });

const executionFinalAssistantLog = (): string =>
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
- Summary: Execution completed`,
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
    secretsBasePath: '/tmp/secrets',
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
    createWorktree: vi.fn(async () => '/tmp/worktrees/test-task'),
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
    cleanupTaskSession: vi.fn(async () => undefined),
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
      DASHSCOPE_API_KEY: 'test-dashscope-key',
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
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  type VerifierMockResult = CompletionVerifierVerdict;
  const dummyTrace = { transcript: '', prompt: '', response: '' };

  const singleAttemptCompletionControl = {
    maxAttempts: 1,
    verifier: {
      verify: vi.fn(
        async (_input: unknown): Promise<VerifierMockResult> => ({
          passed: true,
          missingFields: [],
          verifierFailure: false,
          trace: dummyTrace,
          agentData: {
            agentType: 'planning' as const,
            outcome: 'planned',
            superpowers_writing_plans: 'used',
            linear_url: '',
            is_complex: '0',
            subtask_urls: '',
            pr_url: '',
            summary: 'Task completed',
            unclear_clarification: '',
          },
        })
      ),
      describe: (): { enabled: boolean; provider: string; model: string } => ({
        enabled: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
      extractResumeSummary: vi.fn().mockResolvedValue(undefined),
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

  describe('planning branch merge on execution tasks', () => {
    it('should merge planning branch for execution tasks with planningPrBranch', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-merge-plan',
        workerType: 'auto',
        prompt: 'Implement the plan',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
        planningPrBranch: 'plan/my-feature',
        planningPrUrl: 'https://github.com/org/repo/pull/42',
      };

      const mergeSpy = vi.fn(async () => ({ ok: true as const, value: undefined }));
      (mockWorktreeManager as unknown as Record<string, unknown>)['mergePlanningBranch'] = mergeSpy;

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(mergeSpy).toHaveBeenCalledWith('/tmp/worktrees/test-task', 'plan/my-feature');
    });

    it('should skip merge for tasks without planningPrBranch', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-no-merge',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
      };

      const mergeSpy = vi.fn(async () => ({ ok: true as const, value: undefined }));
      (mockWorktreeManager as unknown as Record<string, unknown>)['mergePlanningBranch'] = mergeSpy;

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('should proceed even when merge fails', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-merge-fail',
        workerType: 'auto',
        prompt: 'Implement the plan',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
        planningPrBranch: 'plan/conflicting',
      };

      const mergeSpy = vi.fn(async () => ({
        ok: false as const,
        error: 'CONFLICT (content): Merge conflict in file.ts',
      }));
      (mockWorktreeManager as unknown as Record<string, unknown>)['mergePlanningBranch'] = mergeSpy;

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      expect(mergeSpy).toHaveBeenCalled();
    });
  });

  describe('closePlanningPr via finalizeTaskWithResult', () => {
    it('should skip closing when task has no planningPrUrl', async () => {
      const task =
        (await dispatcher.getTask('test-task')) ??
        ({
          taskId: 'close-pr-test-1',
          workerType: 'auto',
          prompt: 'Test',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          status: 'running',
          startedAt: new Date().toISOString(),
          attemptCount: 1,
          maxAttempts: 1,
          verificationHistory: [],
          linearIssueLabels: [],
          hasChildren: false,
          agentType: 'execution',
          repository: 'test/repo',
          baseBranch: 'development',
          worktreePath: '/tmp/worktrees/close-pr-test-1',
          containerId: 'container-close-pr-test-1',
        } as Task);

      const internal = dispatcher as unknown as {
        finalizeTaskWithResult: (t: Task, agentType: string, result: TaskResult) => Promise<void>;
      };

      await internal.finalizeTaskWithResult(task, 'execution', {});

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ prUrl: expect.any(String) }),
        expect.stringContaining('Planning PR closed')
      );
    });

    it('should skip closing for non-execution agent type', async () => {
      const task: Task = {
        taskId: 'close-pr-test-2',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running',
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: 1,
        verificationHistory: [],
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'planning',
        planningPrUrl: 'https://github.com/org/repo/pull/99',
        repository: 'test/repo',
        baseBranch: 'development',
        worktreePath: '/tmp/worktrees/close-pr-test-2',
        containerId: 'container-close-pr-test-2',
      };

      const internal = dispatcher as unknown as {
        finalizeTaskWithResult: (t: Task, agentType: string, result: TaskResult) => Promise<void>;
      };

      await internal.finalizeTaskWithResult(task, 'planning', {});

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ prUrl: expect.any(String) }),
        expect.stringContaining('Planning PR closed')
      );
    });

    it('should attempt to close planning PR for execution agent with planningPrUrl', async () => {
      const task: Task = {
        taskId: 'close-pr-test-3',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running',
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: 1,
        verificationHistory: [],
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
        planningPrUrl: 'https://github.com/org/repo/pull/42',
        repository: 'test/repo',
        baseBranch: 'development',
        worktreePath: '/tmp/worktrees/close-pr-test-3',
        containerId: 'container-close-pr-test-3',
      };

      const internal = dispatcher as unknown as {
        finalizeTaskWithResult: (t: Task, agentType: string, result: TaskResult) => Promise<void>;
      };

      await internal.finalizeTaskWithResult(task, 'execution', {});

      // closePlanningPr was called — gh CLI will fail in test env, so we expect
      // the best-effort warning log with the parsed PR URL and task ID
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          prUrl: 'https://github.com/org/repo/pull/42',
          taskId: 'close-pr-test-3',
        }),
        expect.stringContaining('Failed to close planning PR')
      );
    });

    it('should log warning when planningPrUrl is not a valid PR URL', async () => {
      const task: Task = {
        taskId: 'close-pr-test-4',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        status: 'running',
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: 1,
        verificationHistory: [],
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'execution',
        planningPrUrl: 'https://example.com/not-a-pr',
        repository: 'test/repo',
        baseBranch: 'development',
        worktreePath: '/tmp/worktrees/close-pr-test-4',
        containerId: 'container-close-pr-test-4',
      };

      const internal = dispatcher as unknown as {
        finalizeTaskWithResult: (t: Task, agentType: string, result: TaskResult) => Promise<void>;
      };

      await internal.finalizeTaskWithResult(task, 'execution', {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          prUrl: 'https://example.com/not-a-pr',
          taskId: 'close-pr-test-4',
        }),
        'Could not parse planning PR URL'
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

    it('should persist trackingCommentId when provided', async () => {
      const request: CreateTaskRequest = {
        taskId: 'test-task-tracking-comment',
        workerType: 'auto',
        prompt: 'Test prompt with tracking comment',
        trackingCommentId: '12345',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['pr-comment'],
        hasChildren: false,
      };

      const result = await dispatcher.submitTask(request);
      await flushAsync();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const task = await dispatcher.getTask('test-task-tracking-comment');
      expect(task).not.toBeNull();
      expect(task?.trackingCommentId).toBe('12345');
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
        planningFinalAssistantLog('unclear')
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

      // Verify task completed (no code-task label = planning agent, PR not required)
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

  describe('agent-type-aware completion', () => {
    let agentDispatcher: TaskDispatcher;

    beforeEach(() => {
      vi.useFakeTimers();
      agentDispatcher = new TaskDispatcher(
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

    it('should mark planning-agent task as completed without PR', async () => {
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        planningFinalAssistantLog('unclear')
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

      await agentDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await agentDispatcher.getTask('phase1-no-pr');
      expect(task?.status).toBe('completed');
    });

    it('should mark execution-agent task as failed without PR', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        missingFields: ['gh_pr_url'],
        verifierFailure: false,
        trace: dummyTrace,
      });
      const internal = agentDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<unknown>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue(undefined);
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        executionFinalAssistantLog()
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

      await agentDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await agentDispatcher.getTask('phase2-no-pr');
      expect(task?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: expect.stringContaining('gh_pr_url'),
            }),
          }),
        })
      );
    });

    it('maps verifier executionMetadata to execution_* webhook fields for execution-agent tasks', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: true,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
        agentData: {
          agentType: 'execution',
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'used',
          gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/900',
          summary: 'Execution completed successfully',
        },
      });
      const internal = agentDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'feat/execution-task',
        commits: 2,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/900',
      });
      vi.mocked(mockIsolationProvider.getWorkerLogs).mockResolvedValueOnce(
        executionFinalAssistantLog()
      );
      const request: CreateTaskRequest = {
        taskId: 'exec-metadata-task',
        workerType: 'auto',
        prompt: 'Execute task',
        linearIssueId: 'INT-123',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        agentType: 'execution',
      };

      await agentDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            result: expect.objectContaining({
              execution_outcome_label: 'implemented',
              execution_superpowers_executing_plans_used: '1',
              execution_superpowers_requesting_code_review_used: '1',
              execution_linear_issue_url: 'https://linear.app/intexuraos/issue/INT-123',
            }),
          }),
        })
      );
    });

    it('should mark task as failed when Claude reports is_error in stream result', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
      });
      const request: CreateTaskRequest = {
        taskId: 'claude-error-test',
        workerType: 'auto',
        prompt: 'Test claude error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await agentDispatcher.submitTask(request);
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

      const task = await agentDispatcher.getTask('claude-error-test');
      expect(task?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({
              code: 'TASK_COMPLETION_VERIFICATION_FAILED',
              message: 'Completion verification failed',
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

      await agentDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const task = await agentDispatcher.getTask('labels-stored');
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

    it('uses agentType=pull_request over missing pr-comment label', async () => {
      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      const request: CreateTaskRequest = {
        taskId: 'pull-request-phase-override-task',
        workerType: 'auto',
        prompt: 'Test pull request phase override',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['bug'],
        hasChildren: false,
        agentType: 'pull_request',
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const log = getInstructionsLog();
      expect(log).toBeDefined();
      expect(log).toContain('Pull Request Agent');
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
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
      });
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
              message: 'Completion verification failed',
            }),
          }),
        })
      );
    });

    it('should detect Claude error when result JSON is split across log chunks', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
      });
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
              message: 'Completion verification failed',
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

  describe('stream result completion signal', () => {
    let streamDispatcher: TaskDispatcher;

    beforeEach(() => {
      vi.useFakeTimers();
      streamDispatcher = new TaskDispatcher(
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

    it('successful type:result triggers completion when onComplete never fires', async () => {
      const request: CreateTaskRequest = {
        taskId: 'stream-result-success',
        workerType: 'auto',
        prompt: 'Test stream result success',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await streamDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      onLog?.('{"type":"result","is_error":false,"result":"done"}\n');

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await streamDispatcher.getTask('stream-result-success');
      expect(task?.status).toBe('completed');
    });

    it('error type:result triggers completion when onComplete never fires', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.verify).mockResolvedValueOnce({
        passed: false,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
      });
      const request: CreateTaskRequest = {
        taskId: 'stream-result-error',
        workerType: 'auto',
        prompt: 'Test stream result error',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await streamDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      onLog?.('{"type":"result","is_error":true,"result":"Task failed"}\n');

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await streamDispatcher.getTask('stream-result-error');
      expect(task?.status).toBe('failed');
    });

    it('type:result with no trailing newline triggers eager remainder parsing', async () => {
      const request: CreateTaskRequest = {
        taskId: 'stream-result-no-newline',
        workerType: 'auto',
        prompt: 'Test stream result no newline',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await streamDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      expect(onLog).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(true);
      // Send without trailing newline — stays in remainder buffer
      onLog?.('{"type":"result","is_error":false,"result":"done"}');

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await streamDispatcher.getTask('stream-result-no-newline');
      expect(task?.status).toBe('completed');
    });

    it('normal flow: onComplete fires before monitor tick, task completes with real exit code', async () => {
      const request: CreateTaskRequest = {
        taskId: 'stream-result-with-oncomplete',
        workerType: 'auto',
        prompt: 'Test stream result with onComplete',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await streamDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onLog).toBeDefined();
      expect(onComplete).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      onLog?.('{"type":"result","is_error":false,"result":"done"}\n');
      onComplete?.(0);

      await vi.advanceTimersByTimeAsync(30 * 1000);

      const task = await streamDispatcher.getTask('stream-result-with-oncomplete');
      expect(task?.status).toBe('completed');
    });

    it('guard: onComplete fires first, then type:result arrives, real exit code is retained', async () => {
      const request: CreateTaskRequest = {
        taskId: 'stream-result-oncomplete-first',
        workerType: 'auto',
        prompt: 'Test onComplete before type:result',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await streamDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onLog = createWorkerCall?.[0]?.onLog;
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onLog).toBeDefined();
      expect(onComplete).toBeDefined();

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      // onComplete fires first with real exit code 0
      onComplete?.(0);
      // Then type:result arrives — should NOT overwrite exit code
      onLog?.('{"type":"result","is_error":true,"result":"Task failed"}\n');

      await vi.advanceTimersByTimeAsync(30 * 1000);

      // Task should complete (exit code 0 from onComplete wins, verifier passes)
      const task = await streamDispatcher.getTask('stream-result-oncomplete-first');
      expect(task?.status).toBe('completed');
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
          missingFields: ['agent_final_block'],
          verifierFailure: false,
          trace: dummyTrace,
        })
        .mockResolvedValueOnce({
          passed: true,
          missingFields: [],
          verifierFailure: false,
          trace: dummyTrace,
          agentData: {
            agentType: 'execution',
            superpowers_executing_plans: 'used',
            superpowers_requesting_code_review: 'used',
            gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
            summary: 'Completed successfully',
          },
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
          },
        }
      );

      const resumeDispatcherInternal = resumeDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          prUrl: string;
        }>;
      };
      vi.spyOn(resumeDispatcherInternal, 'checkForResult').mockResolvedValue({
        branch: 'resume-branch',
        commits: 2,
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
          agentType: 'execution',
          taskId: 'resume-success-task',
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
        missingFields: [],
        verifierFailure: true,
        trace: dummyTrace,
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
          },
        }
      );

      const verifierFailureInternal = verifierFailureDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          prUrl: string;
        }>;
      };
      vi.spyOn(verifierFailureInternal, 'checkForResult').mockResolvedValue({
        branch: 'verifier-failure-branch',
        commits: 2,
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
      // attemptCount is 2 because verifier retries Gemini once (attempt + 1)
      expect(task?.attemptCount).toBe(2);
      expect(task?.verificationHistory?.[0]?.verifierFailure).toBe(true);
      // Gemini retry also recorded
      expect(task?.verificationHistory?.[1]?.verifierFailure).toBe(true);
      // createWorker called once (only task worker, not the Gemini retry)
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
        missingFields: ['some_field'],
        verifierFailure: false,
        trace: dummyTrace,
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
          },
        }
      );

      const internal = resumeFailDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<{
          branch: string;
          commits: number;
          prUrl: string;
        }>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'resume-fail-branch',
        commits: 1,
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
        missingFields: ['criteria_a'],
        verifierFailure: false,
        trace: dummyTrace,
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
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
              missingFields: [],
              verifierFailure: false,
              trace: dummyTrace,
            }),
            describe: (): { enabled: boolean } => ({ enabled: true }),
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
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
        missingFields: [],
        verifierFailure: true,
        trace: dummyTrace,
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
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
          prUrl: string;
        }>;
      };
      vi.spyOn(fallbackInternal, 'checkForResult').mockResolvedValue({
        branch: 'fallback-branch',
        commits: 1,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1001',
      });

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      // First call: attempt defaults to 1, maxAttempts defaults to 5 (fallback)
      expect(verify).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 5,
          taskId: 'fallback-metadata-task',
        })
      );
      // Second call: Gemini retry at attempt 2
      expect(verify).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 2,
          maxAttempts: 5,
          taskId: 'fallback-metadata-task',
        })
      );

      const finalTask = await fallbackDispatcher.getTask('fallback-metadata-task');
      expect(finalTask?.status).toBe('failed');
      // 2 records: initial verifier failure + one Gemini retry (also failed)
      expect(finalTask?.verificationHistory).toHaveLength(2);
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
              missingFields: [],
              verifierFailure: false,
              trace: dummyTrace,
            }),
            describe: (): { enabled: boolean } => ({ enabled: true }),
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
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

    it('should format rate_limit_event as compact line', async () => {
      const onLog = await submitAndGetOnLog();
      const rateLimitJson = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          resetsAt: 1772240400,
          rateLimitType: 'five_hour',
          overageStatus: 'rejected',
          overageDisabledReason: 'org_level_disabled',
          isUsingOverage: false,
        },
        uuid: '717e3be4-79f5-4c35-ba20-d781d36b8103',
        session_id: 'e0a48ae3-4f90-422e-ae42-5accb61ee3fc',
      });

      onLog(rateLimitJson + '\n');

      const formatted = findFormattedChunk('[rate-limit]');
      expect(formatted).toContain('[rate-limit] status=allowed type=five_hour resets=');
      expect(formatted).toContain('overage=rejected');
      expect(formatted).toContain('reason=org_level_disabled');
      expect(formatted).not.toContain('uuid');
      expect(formatted).not.toContain('session_id');
    });

    it('should format rate_limit_event with missing fields gracefully', async () => {
      const onLog = await submitAndGetOnLog();
      const rateLimitJson = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed' },
      });

      onLog(rateLimitJson + '\n');

      const formatted = findFormattedChunk('[rate-limit]');
      expect(formatted).toContain('[rate-limit] status=allowed');
      expect(formatted).not.toContain('type=');
      expect(formatted).not.toContain('overage=');
      expect(formatted).not.toContain('reason=');
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

  describe('deep validation (prepareDeepValidationInput + executeDeepValidation)', () => {
    type PrepareDeepValidationInput = (
      task: Task,
      finalResult: TaskResult,
      verification: CompletionVerifierVerdict
    ) => Promise<import('../services/execution-deep-validator.js').DeepValidationInput | undefined>;

    type ExecuteDeepValidation = (
      taskId: string,
      input: import('../services/execution-deep-validator.js').DeepValidationInput
    ) => Promise<void>;

    const executionVerification: CompletionVerifierVerdict = {
      passed: true,
      missingFields: [],
      verifierFailure: false,
      trace: dummyTrace,
      agentData: {
        agentType: 'execution' as const,
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/123',
        summary: 'Done.',
      },
    };

    const mockTranscriptEntry: SessionJsonlEntry = {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    };

    const mockTask = {
      taskId: 'deep-val-test',
      repository: 'pbuchman/intexuraos',
      worktreePath: '/tmp/worktrees/deep-val-test',
      linearIssueLabels: [],
    } as unknown as Task;

    const mockFinalResult = {
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
    } as TaskResult;

    it('prepareDeepValidationInput returns correct input shape', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      mockExtractPrNumber.mockReturnValue(123);
      mockReadSessionTranscript.mockResolvedValue([mockTranscriptEntry]);
      mockFetchLinearIssueContext.mockResolvedValue(undefined);
      mockReadPlanReferencedInLinearIssue.mockResolvedValue('# Plan');

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const input = await internal.prepareDeepValidationInput(
        mockTask,
        mockFinalResult,
        executionVerification
      );

      expect(input).toBeDefined();
      expect(input?.taskId).toBe('deep-val-test');
      expect(input?.prNumber).toBe(123);
      expect(input?.repository).toBe('pbuchman/intexuraos');
      expect(input?.agentClaims.superpowers_executing_plans).toBe('used');
      expect(mockReadSessionTranscript).toHaveBeenCalled();
      expect(mockReadPlanReferencedInLinearIssue).not.toHaveBeenCalled();
    });

    it('prepareDeepValidationInput enriches linearIssueBody with description when available', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      mockExtractPrNumber.mockReturnValue(123);
      mockReadSessionTranscript.mockResolvedValue([mockTranscriptEntry]);
      mockFetchLinearIssueContext.mockResolvedValue({
        description: '## Requirements\n1. Fix bug',
        comments: [],
      });
      mockReadPlanReferencedInLinearIssue.mockResolvedValue(undefined);

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const taskWithIssue = {
        ...mockTask,
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Fix the thing',
        linearIssueLabels: ['bug'],
      } as unknown as Task;

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const input = await internal.prepareDeepValidationInput(
        taskWithIssue,
        mockFinalResult,
        executionVerification
      );

      expect(input).toBeDefined();
      expect(mockFetchLinearIssueContext).toHaveBeenCalledWith(
        'INT-999',
        expect.any(String),
        expect.anything()
      );
      expect(input?.linearIssueBody).toContain('Linear Issue: INT-999');
      expect(input?.linearIssueBody).toContain('Description:\n## Requirements\n1. Fix bug');
      expect(mockReadPlanReferencedInLinearIssue).toHaveBeenCalledWith(
        '/tmp/worktrees/deep-val-test',
        {
          description: '## Requirements\n1. Fix bug',
          comments: [],
        },
        expect.anything()
      );
    });

    it('executeDeepValidation calls validate with onProgress and logs comment posted', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi
          .fn()
          .mockImplementation(
            async (
              _input: import('../services/execution-deep-validator.js').DeepValidationInput,
              onProgress?: (message: string) => void
            ) => {
              onProgress?.('calling Gemini for analysis...');
              onProgress?.('validation response received');
              onProgress?.('posting PR comment...');
              onProgress?.('PR comment posted');
              return true;
            }
          ),
      };

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        executeDeepValidation: ExecuteDeepValidation;
      };
      const testInput = {
        taskId: 'deep-val-test',
        prNumber: 123,
        repository: 'pbuchman/intexuraos',
        formattedTranscript: '[MSG-001] test',
        agentClaims: {
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'used',
          gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/123',
          summary: 'Done.',
        },
        linearIssueBody: 'Fix bug',
        planContent: undefined,
      } as import('../services/execution-deep-validator.js').DeepValidationInput;

      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      await internal.executeDeepValidation('deep-val-test', testInput);

      expect(mockValidator.validate).toHaveBeenCalledWith(testInput, expect.any(Function));
      // Progress messages should flow through appendChunk
      const appendCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((c) => c[0] === 'deep-val-test')
        .map((c) => c[1]);
      expect(appendCalls.some((c) => c.includes('Deep validation starting'))).toBe(true);
      expect(appendCalls.some((c) => c.includes('calling Gemini for analysis...'))).toBe(true);
      expect(appendCalls.some((c) => c.includes('Deep validation comment posted'))).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { taskId: 'deep-val-test' },
        'Deep validation completed with comment posted'
      );
    });

    it('executeDeepValidation logs coarse status when validate returns false', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        executeDeepValidation: ExecuteDeepValidation;
      };
      const testInput = {
        taskId: 'undef-val-test',
        prNumber: 123,
        repository: 'pbuchman/intexuraos',
        formattedTranscript: '[MSG-001] test',
        agentClaims: {
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'used',
          gh_pr_url: '',
          summary: 'Done.',
        },
        linearIssueBody: 'Fix bug',
        planContent: undefined,
      } as import('../services/execution-deep-validator.js').DeepValidationInput;

      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      await internal.executeDeepValidation('undef-val-test', testInput);

      const appendCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((c) => c[0] === 'undef-val-test')
        .map((c) => c[1]);
      expect(appendCalls.some((c) => c.includes('Deep validation starting'))).toBe(true);
      expect(appendCalls.some((c) => c.includes('Deep validation completed without comment'))).toBe(
        true
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { taskId: 'undef-val-test' },
        'Deep validation completed without comment'
      );
    });

    it('prepareDeepValidationInput returns undefined when validator not provided', async () => {
      // Default dispatcher (from beforeEach) has no validator
      const internal = dispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const result = await internal.prepareDeepValidationInput(
        mockTask,
        mockFinalResult,
        executionVerification
      );

      expect(result).toBeUndefined();
      expect(mockReadSessionTranscript).not.toHaveBeenCalled();
    });

    it('prepareDeepValidationInput returns undefined for non-execution agent types', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const planningVerification: CompletionVerifierVerdict = {
        passed: true,
        missingFields: [],
        verifierFailure: false,
        trace: dummyTrace,
        agentData: {
          agentType: 'planning' as const,
          outcome: 'planned',
          superpowers_writing_plans: 'used',
          linear_url: '',
          is_complex: '0',
          subtask_urls: '',
          pr_url: '',
          summary: 'Planned',
          unclear_clarification: '',
        },
      };

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const result = await internal.prepareDeepValidationInput(
        mockTask,
        mockFinalResult,
        planningVerification
      );

      expect(result).toBeUndefined();
      expect(mockValidator.validate).not.toHaveBeenCalled();
    });

    it('prepareDeepValidationInput skips and logs warning when no PR number', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      mockExtractPrNumber.mockReturnValue(undefined);

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const result = await internal.prepareDeepValidationInput(
        { ...mockTask, taskId: 'no-pr-test' } as Task,
        mockFinalResult,
        executionVerification
      );

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'no-pr-test' }),
        'Deep validation skipped: no PR number'
      );
    });

    it('prepareDeepValidationInput skips and logs warning when transcript is empty', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      mockExtractPrNumber.mockReturnValue(123);
      mockReadSessionTranscript.mockResolvedValue([]);

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const result = await internal.prepareDeepValidationInput(
        { ...mockTask, taskId: 'empty-transcript' } as Task,
        mockFinalResult,
        executionVerification
      );

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'empty-transcript' }),
        'Deep validation skipped: no transcript entries'
      );
    });

    it('prepareDeepValidationInput failure does not block finalization', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockResolvedValue(false),
      };

      mockExtractPrNumber.mockReturnValue(123);
      mockReadSessionTranscript.mockRejectedValue(new Error('I/O failure'));

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        prepareDeepValidationInput: PrepareDeepValidationInput;
      };
      const result = await internal.prepareDeepValidationInput(
        mockTask,
        mockFinalResult,
        executionVerification
      );

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'deep-val-test' }),
        'Deep validation preparation failed (non-fatal, skipping deep validation)'
      );
    });

    it('executeDeepValidation handles validation error gracefully and logs via appendChunk', async () => {
      const mockValidator: ExecutionDeepValidator = {
        validate: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      };

      const deepValDispatcher = new TaskDispatcher(
        mockConfig,
        statePersistence,
        mockWorktreeManager,
        mockLogForwarder,
        mockWebhookClient,
        mockGitHubTokenService,
        mockLogger,
        mockIsolationConfig,
        singleAttemptCompletionControl,
        undefined,
        mockValidator
      );

      const internal = deepValDispatcher as unknown as {
        executeDeepValidation: ExecuteDeepValidation;
      };
      const testInput = {
        taskId: 'error-val-test',
        prNumber: 123,
        repository: 'pbuchman/intexuraos',
        formattedTranscript: '[MSG-001] test',
        agentClaims: {
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'used',
          gh_pr_url: '',
          summary: 'Done.',
        },
        linearIssueBody: 'Fix bug',
        planContent: undefined,
      } as import('../services/execution-deep-validator.js').DeepValidationInput;

      vi.mocked(mockLogForwarder.appendChunk).mockClear();

      await internal.executeDeepValidation('error-val-test', testInput);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'error-val-test', error: 'LLM timeout' }),
        'Deep validation failed (non-fatal, task finalization continues)'
      );
      // Error should also flow through appendChunk for visibility in web app
      const appendCalls = vi
        .mocked(mockLogForwarder.appendChunk)
        .mock.calls.filter((c) => c[0] === 'error-val-test')
        .map((c) => c[1]);
      expect(appendCalls.some((c) => c.includes('Deep validation error: LLM timeout'))).toBe(true);
    });
  });

  describe('finalizeTask keepLogForwarderOpen', () => {
    const testTask = {
      taskId: 'finalize-test',
      repository: 'pbuchman/intexuraos',
      worktreePath: '/tmp/worktrees/finalize-test',
      linearIssueLabels: [],
    } as unknown as Task;

    it('skips logForwarder.close when keepLogForwarderOpen is true', async () => {
      const internal = dispatcher as unknown as {
        finalizeTask: (
          task: Task,
          status: string,
          payload: { result?: unknown; error?: unknown },
          keepLogForwarderOpen?: boolean
        ) => Promise<void>;
      };

      vi.mocked(mockLogForwarder.close).mockClear();
      vi.mocked(mockLogForwarder.flush).mockClear();

      await internal.finalizeTask(testTask, 'completed', { result: {} }, true);

      expect(mockLogForwarder.flush).toHaveBeenCalledWith(testTask.taskId);
      expect(mockLogForwarder.close).not.toHaveBeenCalledWith(testTask.taskId);
    });

    it('calls logForwarder.close when keepLogForwarderOpen is false', async () => {
      const internal = dispatcher as unknown as {
        finalizeTask: (
          task: Task,
          status: string,
          payload: { result?: unknown; error?: unknown },
          keepLogForwarderOpen?: boolean
        ) => Promise<void>;
      };

      vi.mocked(mockLogForwarder.close).mockClear();

      await internal.finalizeTask(testTask, 'completed', { result: {} }, false);

      expect(mockLogForwarder.close).toHaveBeenCalledWith(testTask.taskId);
    });

    it('calls logForwarder.close when keepLogForwarderOpen is omitted (default)', async () => {
      const internal = dispatcher as unknown as {
        finalizeTask: (
          task: Task,
          status: string,
          payload: { result?: unknown; error?: unknown },
          keepLogForwarderOpen?: boolean
        ) => Promise<void>;
      };

      vi.mocked(mockLogForwarder.close).mockClear();

      await internal.finalizeTask(testTask, 'completed', { result: {} });

      expect(mockLogForwarder.close).toHaveBeenCalledWith(testTask.taskId);
    });
  });

  describe('flushAndCloseLogForwarder', () => {
    it('flushes and closes log forwarder for a task', async () => {
      const internal = dispatcher as unknown as {
        flushAndCloseLogForwarder: (taskId: string) => Promise<void>;
      };

      vi.mocked(mockLogForwarder.flush).mockClear();
      vi.mocked(mockLogForwarder.close).mockClear();

      await internal.flushAndCloseLogForwarder('flush-close-test');

      expect(mockLogForwarder.flush).toHaveBeenCalledWith('flush-close-test');
      expect(mockLogForwarder.close).toHaveBeenCalledWith('flush-close-test');
    });
  });

  describe('buildLinearIssueSummary', () => {
    it('returns both fields when both present', () => {
      const internal = dispatcher as unknown as {
        buildLinearIssueSummary: (task: Task) => string;
      };
      const result = internal.buildLinearIssueSummary({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
      } as unknown as Task);
      expect(result).toContain('Linear Issue: INT-123');
      expect(result).toContain('Title: Fix the bug');
    });

    it('returns only linearIssueId when title absent', () => {
      const internal = dispatcher as unknown as {
        buildLinearIssueSummary: (task: Task) => string;
      };
      const result = internal.buildLinearIssueSummary({
        linearIssueId: 'INT-123',
        linearIssueLabels: [],
      } as unknown as Task);
      expect(result).toContain('Linear Issue: INT-123');
      expect(result).not.toContain('Title:');
    });

    it('returns no-issue message when neither present', () => {
      const internal = dispatcher as unknown as {
        buildLinearIssueSummary: (task: Task) => string;
      };
      const result = internal.buildLinearIssueSummary({
        linearIssueLabels: [],
      } as unknown as Task);
      expect(result).toBe('No Linear issue linked');
    });

    it('includes labels when linearIssueLabels is non-empty', () => {
      const internal = dispatcher as unknown as {
        buildLinearIssueSummary: (task: Task) => string;
      };
      const result = internal.buildLinearIssueSummary({
        linearIssueId: 'INT-456',
        linearIssueTitle: 'Add feature',
        linearIssueLabels: ['bug', 'code-task'],
      } as unknown as Task);
      expect(result).toContain('Linear Issue: INT-456');
      expect(result).toContain('Title: Add feature');
      expect(result).toContain('Labels: bug, code-task');
    });

    it('omits labels line when linearIssueLabels is empty', () => {
      const internal = dispatcher as unknown as {
        buildLinearIssueSummary: (task: Task) => string;
      };
      const result = internal.buildLinearIssueSummary({
        linearIssueId: 'INT-789',
        linearIssueLabels: [],
      } as unknown as Task);
      expect(result).toContain('Linear Issue: INT-789');
      expect(result).not.toContain('Labels:');
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
      expect(finalTask?.verificationHistory?.[0]?.passed).toBe(true);
      expect(finalTask?.verificationHistory?.[0]?.missingFields).toEqual([]);
      expect(finalTask?.verificationHistory?.[0]?.verifierFailure).toBe(false);
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

    it('enriches result with execution_linear_issue_url for execution tasks', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-execution-enrich-test',
        workerType: 'auto',
        prompt: 'Test execution enrichment on resumed task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        linearIssueId: 'INT-677',
        agentType: 'execution',
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'feature/int-677',
        commits: 3,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/967',
        summary: 'Execution completed',
      });

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-execution-enrich-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-execution-enrich-test');
      expect(finalTask?.status).toBe('completed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            result: expect.objectContaining({
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/967',
              execution_linear_issue_url: 'https://linear.app/intexuraos/issue/INT-677',
            }),
          }),
        })
      );
    });

    it('sends resumedCompletion: true in webhook payload on success', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-completion-flag-test',
        workerType: 'auto',
        prompt: 'Test resumed completion flag in webhook',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-completion-flag-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            resumedCompletion: true,
          }),
        })
      );
    });

    it('calls extractResumeSummary and attaches summary to result on success', async () => {
      vi.mocked(singleAttemptCompletionControl.verifier.extractResumeSummary).mockResolvedValueOnce(
        'Claude updated the token refresh logic and CI passed.'
      );

      const request: CreateTaskRequest = {
        taskId: 'resumed-gemini-summary-test',
        workerType: 'auto',
        prompt: 'Test Gemini summary on resumed task',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'fix/token-refresh',
        commits: 2,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/988',
        summary: 'Original PR summary',
      });

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-gemini-summary-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(singleAttemptCompletionControl.verifier.extractResumeSummary).toHaveBeenCalledWith(
        'resumed-gemini-summary-test',
        expect.any(String)
      );

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            resumedCompletion: true,
            result: expect.objectContaining({
              summary: 'Claude updated the token refresh logic and CI passed.',
            }),
          }),
        })
      );
    });

    it('falls back to lastSuccessResult when checkForResult returns undefined', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-fallback-result-test',
        workerType: 'auto',
        prompt: 'Test fallback to lastSuccessResult',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'planning',
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue(undefined);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-fallback-result-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      task.lastSuccessResult = {
        planning_outcome_label: 'planned',
        planning_linear_url: 'https://linear.app/intexuraos/issue/INT-818',
      };
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-fallback-result-test');
      expect(finalTask?.status).toBe('completed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            result: expect.objectContaining({
              planning_outcome_label: 'planned',
              planning_linear_url: 'https://linear.app/intexuraos/issue/INT-818',
            }),
          }),
        })
      );
    });

    it('checkForResult PR result takes priority over lastSuccessResult', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-pr-priority-test',
        workerType: 'auto',
        prompt: 'Test PR result priority',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'fix/something',
        commits: 1,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
      });

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-pr-priority-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      task.lastSuccessResult = {
        planning_outcome_label: 'planned',
      };
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'completed',
            result: expect.objectContaining({
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
            }),
          }),
        })
      );

      const webhookCall = vi.mocked(mockWebhookClient.send).mock.calls.at(-1);
      expect(webhookCall?.[0]?.payload).not.toHaveProperty('result.planning_outcome_label');
    });

    it('lastSuccessResult is stored on successful completion', async () => {
      const request: CreateTaskRequest = {
        taskId: 'store-success-result-test',
        workerType: 'auto',
        prompt: 'Test storing lastSuccessResult',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue({
        branch: 'fix/store-test',
        commits: 1,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/1000',
      });

      const state = await resumedStatePersistence.load();
      const task = state.tasks['store-success-result-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('store-success-result-test');
      expect(finalTask?.status).toBe('completed');
      expect(finalTask?.lastSuccessResult).toBeDefined();
      expect(finalTask?.lastSuccessResult?.prUrl).toBe(
        'https://github.com/pbuchman/intexuraos/pull/1000'
      );
    });

    it('falls back to lastSuccessResult in failure webhook when checkForResult returns undefined', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-fallback-error-test',
        workerType: 'auto',
        prompt: 'Test fallback to lastSuccessResult on error path',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'planning',
      };

      await resumedDispatcher.submitTask(request);
      await vi.advanceTimersByTimeAsync(0);

      const internal = resumedDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(internal, 'checkForResult').mockResolvedValue(undefined);

      const createWorkerCall = vi.mocked(mockIsolationProvider.createWorker).mock.calls.at(-1);
      const onComplete = createWorkerCall?.[0]?.onComplete;
      expect(onComplete).toBeDefined();
      onComplete?.(1);

      const state = await resumedStatePersistence.load();
      const task = state.tasks['resumed-fallback-error-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      task.lastSuccessResult = {
        planning_outcome_label: 'planned',
        planning_linear_url: 'https://linear.app/intexuraos/issue/INT-818',
      };
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('resumed-fallback-error-test');
      expect(finalTask?.status).toBe('failed');

      expect(mockWebhookClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            result: expect.objectContaining({
              planning_outcome_label: 'planned',
              planning_linear_url: 'https://linear.app/intexuraos/issue/INT-818',
            }),
            error: expect.objectContaining({
              code: 'TASK_RESUMED_HARD_ERROR',
            }),
          }),
        })
      );
    });

    it('lastSuccessResult is cleared on failure', async () => {
      const request: CreateTaskRequest = {
        taskId: 'clear-result-on-fail-test',
        workerType: 'auto',
        prompt: 'Test clearing lastSuccessResult on failure',
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

      // Pre-set lastSuccessResult and resumedAfterSuccess
      const state = await resumedStatePersistence.load();
      const task = state.tasks['clear-result-on-fail-test'];
      if (!task) throw new Error('Task not found');
      task.lastSuccessResult = { planning_outcome_label: 'planned' };
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const finalTask = await resumedDispatcher.getTask('clear-result-on-fail-test');
      expect(finalTask?.status).toBe('failed');
      expect(finalTask?.lastSuccessResult).toBeUndefined();
    });

    it('does not send resumedCompletion in webhook payload on failure', async () => {
      const request: CreateTaskRequest = {
        taskId: 'resumed-failure-no-flag-test',
        workerType: 'auto',
        prompt: 'Test no resumedCompletion flag on failure',
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
      const task = state.tasks['resumed-failure-no-flag-test'];
      if (!task) throw new Error('Task not found');
      task.resumedAfterSuccess = true;
      await resumedStatePersistence.save(state);

      vi.mocked(mockIsolationProvider.isWorkerRunning).mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const webhookCall = vi.mocked(mockWebhookClient.send).mock.calls.at(-1);
      expect(webhookCall?.[0]?.payload).not.toHaveProperty('resumedCompletion');
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

    it('logs system prompt built with agent type and lengths', async () => {
      const infoSpy = vi.spyOn(mockLogger, 'info');

      const request: CreateTaskRequest = {
        taskId: 'sys-prompt-log-test',
        workerType: 'auto',
        prompt: 'Test prompt for logging',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

      const promptLogCall = infoSpy.mock.calls.find((call) => call[1] === 'System prompt built');
      expect(promptLogCall).toBeDefined();

      const logData = promptLogCall?.[0] as Record<string, unknown>;
      expect(logData['taskId']).toBe('sys-prompt-log-test');
      expect(logData['agentType']).toBe('default');
      expect(typeof logData['systemPromptLength']).toBe('number');
      expect(typeof logData['userPromptLength']).toBe('number');
      expect(logData['userPromptLength']).toBe('Test prompt for logging'.length);
    });

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
      expect(resultLog).toContain('ciFailed=unknown');
      vi.useRealTimers();
    });

    it('logs truncated resume prompt when retrying', async () => {
      vi.useFakeTimers();
      const promptState = createStatePersistence();
      const verify = vi
        .fn()
        .mockResolvedValueOnce({
          passed: false,
          missingFields: ['final_block'],
          verifierFailure: false,
          trace: dummyTrace,
        })
        .mockResolvedValueOnce({
          passed: true,
          missingFields: [],
          verifierFailure: false,
          trace: dummyTrace,
          agentData: {
            agentType: 'execution',
            superpowers_executing_plans: 'used',
            superpowers_requesting_code_review: 'used',
            gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/900',
            summary: 'Done',
          },
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
            extractResumeSummary: vi.fn().mockResolvedValue(undefined),
          },
        }
      );

      const promptInternal = promptDispatcher as unknown as {
        checkForResult: (task: unknown) => Promise<TaskResult | undefined>;
      };
      vi.spyOn(promptInternal, 'checkForResult').mockResolvedValue({
        branch: 'feat/prompt-test',
        commits: 1,
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

  describe('adoptTask', () => {
    const createTask = (overrides?: Partial<Task>): Task => ({
      taskId: 'adopt-task-1',
      workerType: 'auto',
      prompt: 'Test prompt for adoption',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret-123',
      status: 'running',
      worktreePath: '/tmp/worktrees/adopt-task-1',
      containerId: 'container-adopt-task-1',
      startedAt: new Date().toISOString(),
      attemptCount: 1,
      maxAttempts: 3,
      verificationHistory: [],
      linearIssueLabels: [],
      hasChildren: false,
      ...overrides,
    });

    it('should adopt a task: increments runningCount, calls createWorker with continueSession: true', async () => {
      const task = createTask();

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(true);
      expect(dispatcher.getRunningCount()).toBe(1);
      expect(mockLogForwarder.registerTask).toHaveBeenCalledWith('adopt-task-1', 'secret-123');
      expect(mockIsolationProvider.createWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'adopt-task-1',
          continueSession: true,
        })
      );
      expect(statePersistence.modify).toHaveBeenCalled();
    });

    it('should reject when task is at maxAttempts', async () => {
      const task = createTask({ attemptCount: 3, maxAttempts: 3 });

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_status');
        expect(result.error.message).toBe('Task at max attempts');
      }
      expect(dispatcher.getRunningCount()).toBe(0);
      expect(mockIsolationProvider.createWorker).not.toHaveBeenCalled();
    });

    it('should reject when at capacity', async () => {
      // Fill capacity first
      for (let i = 0; i < 5; i++) {
        const request: CreateTaskRequest = {
          taskId: `fill-task-${String(i)}`,
          workerType: 'auto',
          prompt: 'Fill',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
          linearIssueLabels: [],
          hasChildren: false,
        };
        await dispatcher.submitTask(request);
        await flushAsync();
      }

      const task = createTask({ taskId: 'adopt-overflow' });

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('at_capacity');
      }
      expect(dispatcher.getRunningCount()).toBe(5);
    });

    it('should decrement runningCount on startWorkerAttempt failure', async () => {
      vi.mocked(mockIsolationProvider.createWorker).mockRejectedValueOnce(
        new Error('Container creation failed')
      );

      const task = createTask();

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('service_error');
      }
      expect(dispatcher.getRunningCount()).toBe(0);
      expect(mockTokenRefresher.unregisterTask).toHaveBeenCalledWith('adopt-task-1');
      expect(mockLogForwarder.unregisterTask).toHaveBeenCalledWith('adopt-task-1');
      expect(mockIsolationProvider.cleanupTaskSession).toHaveBeenCalledWith('adopt-task-1');
    });

    it('should increment attemptCount by 1', async () => {
      const task = createTask({ attemptCount: 2, maxAttempts: 3 });

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(true);
      expect(task.attemptCount).toBe(3);
    });

    it('should use fallback defaults when attemptCount, maxAttempts, and hasChildren are undefined', async () => {
      const task = createTask();
      delete task.attemptCount;
      delete task.maxAttempts;
      delete task.hasChildren;

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(true);
      // attemptCount defaults to 0 via ??, then incremented to 1
      expect(task.attemptCount).toBe(1);
      expect(dispatcher.getRunningCount()).toBe(1);
      // hasChildren defaults to false via ??
      expect(mockIsolationProvider.createWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.taskId,
          continueSession: true,
        })
      );
      expect(statePersistence.modify).toHaveBeenCalled();
    });

    it('should reject with fallback maxAttempts when attemptCount exceeds completionMaxAttempts default', async () => {
      const task = createTask();
      // completionMaxAttempts is 1 in test config
      // attemptCount defaults to 0 via ??, but we set it to 1 to match the default maxAttempts
      delete task.maxAttempts;
      task.attemptCount = 1;

      const result = await dispatcher.adoptTask(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invalid_status');
        expect(result.error.message).toBe('Task at max attempts');
      }
      expect(dispatcher.getRunningCount()).toBe(0);
    });
  });

  describe('prompt truncation in task log', () => {
    it('should truncate prompt longer than 500 characters in the log', async () => {
      const longPrompt = 'A'.repeat(600);
      const request: CreateTaskRequest = {
        taskId: 'truncate-long-prompt',
        workerType: 'auto',
        prompt: longPrompt,
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const appendCalls = vi.mocked(mockLogForwarder.appendChunk).mock.calls;
      const promptLogCall = appendCalls.find(
        ([id, msg]) =>
          id === 'truncate-long-prompt' && typeof msg === 'string' && msg.includes('[prompt]')
      );
      expect(promptLogCall).toBeDefined();
      const promptLogMessage = promptLogCall?.[1] ?? '';
      // Should contain exactly 500 A's followed by ellipsis, NOT the full 600
      expect(promptLogMessage).toContain('A'.repeat(500) + '\u2026');
      expect(promptLogMessage).not.toContain('A'.repeat(501));
    });

    it('should use full prompt when 500 characters or shorter in the log', async () => {
      const shortPrompt = 'B'.repeat(500);
      const request: CreateTaskRequest = {
        taskId: 'truncate-short-prompt',
        workerType: 'auto',
        prompt: shortPrompt,
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      const appendCalls = vi.mocked(mockLogForwarder.appendChunk).mock.calls;
      const promptLogCall = appendCalls.find(
        ([id, msg]) =>
          id === 'truncate-short-prompt' && typeof msg === 'string' && msg.includes('[prompt]')
      );
      expect(promptLogCall).toBeDefined();
      const promptLogMessage = promptLogCall?.[1] ?? '';
      // Should contain the full 500-char prompt without ellipsis
      expect(promptLogMessage).toContain(shortPrompt);
      expect(promptLogMessage).not.toContain('\u2026');
    });
  });

  describe('createWorker failure error logging', () => {
    it('should log error with Error message when createWorker rejects with Error', async () => {
      vi.mocked(mockIsolationProvider.createWorker).mockRejectedValueOnce(
        new Error('Docker daemon not responding')
      );

      const request: CreateTaskRequest = {
        taskId: 'worker-fail-error',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'worker-fail-error',
          errorMessage: 'Docker daemon not responding',
        }),
        'Failed to create worker container'
      );
      expect(dispatcher.getRunningCount()).toBe(0);
    });

    it('should log error with stringified message when createWorker rejects with non-Error', async () => {
      vi.mocked(mockIsolationProvider.createWorker).mockRejectedValueOnce('raw string rejection');

      const request: CreateTaskRequest = {
        taskId: 'worker-fail-string',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };

      await dispatcher.submitTask(request);
      await flushAsync();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'worker-fail-string',
          errorMessage: 'raw string rejection',
        }),
        'Failed to create worker container'
      );
      expect(dispatcher.getRunningCount()).toBe(0);
    });
  });

  describe('clearTaskTimers', () => {
    it('should handle clearing timers when no timers are registered for the task', async () => {
      // Submit a task so it's in state, then cancel it (which calls clearTaskTimers internally)
      const request: CreateTaskRequest = {
        taskId: 'clear-timers-test',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
      };
      await dispatcher.submitTask(request);
      await flushAsync();

      // Cancel calls clearTaskTimers internally — first cancel clears timers
      const result1 = await dispatcher.cancelTask('clear-timers-test');
      expect(result1.ok).toBe(true);

      // Access the private activeTasks map to verify keys were removed
      const internal = dispatcher as unknown as { activeTasks: Map<string, NodeJS.Timeout> };
      expect(internal.activeTasks.has('clear-timers-test-warning')).toBe(false);
      expect(internal.activeTasks.has('clear-timers-test-kill')).toBe(false);
      expect(internal.activeTasks.has('clear-timers-test-monitor')).toBe(false);
    });

    it('should not throw when activeTasks.get returns undefined for timer keys', async () => {
      // Directly call clearTaskTimers on a task that was never started (no timers registered)
      const internal = dispatcher as unknown as {
        clearTaskTimers: (taskId: string) => void;
        activeTasks: Map<string, NodeJS.Timeout>;
      };

      // Ensure no timers exist for this task
      expect(internal.activeTasks.has('nonexistent-task-warning')).toBe(false);
      expect(internal.activeTasks.has('nonexistent-task-kill')).toBe(false);
      expect(internal.activeTasks.has('nonexistent-task-monitor')).toBe(false);

      // Should not throw
      expect(() => {
        internal.clearTaskTimers('nonexistent-task');
      }).not.toThrow();
    });
  });
});

describe('parsePrUrl', () => {
  it('should parse a standard GitHub PR URL', () => {
    const result = parsePrUrl('https://github.com/pbuchman/intexuraos/pull/123');
    expect(result).toEqual({ owner: 'pbuchman', repo: 'intexuraos', number: 123 });
  });

  it('should parse a GitHub API-style PR URL', () => {
    const result = parsePrUrl('/repos/pbuchman/intexuraos/pull/456');
    expect(result).toEqual({ owner: 'pbuchman', repo: 'intexuraos', number: 456 });
  });

  it('should return undefined for invalid URLs', () => {
    expect(parsePrUrl('https://example.com/not-a-pr')).toBeUndefined();
    expect(parsePrUrl('')).toBeUndefined();
    expect(parsePrUrl('random string')).toBeUndefined();
  });
});
