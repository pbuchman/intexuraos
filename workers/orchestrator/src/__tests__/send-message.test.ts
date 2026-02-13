import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('TaskDispatcher.sendMessage', () => {
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

  let capturedOnComplete: ((exitCode: number) => void) | undefined;

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

  const mockWorktreeManager = {
    createWorktree: vi.fn(async () => '/tmp/worktrees/test-task'),
    deleteWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
    removeWorktree: vi.fn(async () => undefined),
  } as unknown as WorktreeManager;

  const mockIsolationProvider: IsolationProvider = {
    createWorker: vi.fn(async (config): Promise<WorkerHandle> => {
      if (config.onComplete !== undefined) {
        capturedOnComplete = config.onComplete;
      }
      return {
        taskId: config.taskId,
        containerId: `container-${config.taskId}`,
        status: 'running',
        startedAt: new Date(),
      };
    }),
    destroyWorker: vi.fn(async () => undefined),
    isWorkerRunning: vi.fn(async () => true),
    getWorkerLogs: vi.fn(async () => ''),
    streamLogs: vi.fn(async () => undefined),
    waitForCompletion: vi.fn(async () => 0),
    getResourceUsage: vi.fn(async () => ({ cpuPercent: 0, memoryUsedMB: 0, memoryLimitMB: 0 })),
    listWorkers: vi.fn(async () => []),
    interruptAttempt: vi.fn(async () => true),
  };

  const mockTokenRefresher = {
    registerTask: vi.fn(async () => undefined),
    unregisterTask: vi.fn(),
    stop: vi.fn(),
  } as unknown as TokenRefresher;

  const mockApiKeyValidator = {
    validate: vi.fn(async () => ({ valid: true })),
  } as unknown as ApiKeyValidator;

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

  const mockLogForwarder = {
    startForwarding: vi.fn(),
    stopForwarding: vi.fn(async () => undefined),
    flushAndStop: vi.fn(async () => undefined),
    getDroppedChunkCount: vi.fn(() => 0),
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    appendChunk: vi.fn(),
  } as unknown as LogForwarder;

  const mockWebhookClient = {
    send: vi.fn(async () => ({ ok: true, value: undefined })),
    retryPending: vi.fn(async () => undefined),
    getPendingCount: vi.fn(async () => 0),
  } as unknown as WebhookClient;

  const mockGitHubTokenService = {
    getToken: vi.fn(async () => ({ token: 'test-token', expiresAt: '2025-01-26T00:00:00Z' })),
  } as unknown as GitHubTokenService;

  /* eslint-disable @typescript-eslint/no-empty-function */
  const mockLogger: Logger = {
    info(): void {},
    warn(): void {},
    error(): void {},
    debug(): void {},
  };

  const singleAttemptCompletionControl = {
    maxAttempts: 1,
    verifier: {
      verify: vi.fn(async () => ({
        passed: true,
        confidence: 1,
        reasons: ['verification passed'],
        missingCriteria: [],
        resumeInstruction: 'No further action required.',
        usedLlm: true,
      })),
      describe: (): { enabled: boolean; provider: string; model: string } => ({
        enabled: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      }),
    },
  };

  let statePersistence: StatePersistence;
  let dispatcher: TaskDispatcher;

  const submitAndFlush = async (taskId: string): Promise<void> => {
    const request: CreateTaskRequest = {
      taskId,
      workerType: 'auto',
      prompt: 'Test prompt for messaging',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: [],
      hasChildren: false,
    };

    await dispatcher.submitTask(request);
    await flushAsync();
  };

  beforeEach(() => {
    capturedOnComplete = undefined;
    vi.clearAllMocks();
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

  it('should return not_found for unknown task', async () => {
    const result = await dispatcher.sendMessage('nonexistent-task', 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('not_found');
    }
  });

  it('should return not_running for completed task', async () => {
    // Directly save a completed task into state persistence
    const state = await statePersistence.load();
    state.tasks['task-done'] = {
      taskId: 'task-done',
      workerType: 'auto',
      prompt: 'Test',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      status: 'completed',
      worktreePath: '/tmp/worktrees/task-done',
      containerId: 'container-task-done',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      linearIssueLabels: [],
      hasChildren: false,
      attemptCount: 1,
      maxAttempts: 1,
      verificationHistory: [],
    };
    await statePersistence.save(state);

    const result = await dispatcher.sendMessage('task-done', 'Hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('not_running');
    }
  });

  it('should interrupt running task and resume with user message', async () => {
    await submitAndFlush('task-msg-1');

    // Simulate the interrupt: when sendMessage calls interruptAttempt,
    // the exec completes and onComplete fires
    (mockIsolationProvider.interruptAttempt as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        // Simulate the exec ending after interrupt
        if (capturedOnComplete !== undefined) {
          capturedOnComplete(143); // SIGTERM exit code
        }
        return true;
      }
    );

    const result = await dispatcher.sendMessage('task-msg-1', 'Please also add tests');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe('interrupted');
    }

    // Verify interruptAttempt was called
    expect(mockIsolationProvider.interruptAttempt).toHaveBeenCalledWith('task-msg-1');

    // Verify createWorker was called again with continueSession: true
    const createWorkerCalls = (mockIsolationProvider.createWorker as ReturnType<typeof vi.fn>).mock
      .calls;
    const lastCall = createWorkerCalls[createWorkerCalls.length - 1];
    expect(lastCall).toBeDefined();
    const workerConfig = lastCall?.[0];
    expect(workerConfig?.continueSession).toBe(true);
    expect(workerConfig?.prompt).toContain('[USER MESSAGE]');
    expect(workerConfig?.prompt).toContain('Please also add tests');
  });

  it('should return concurrent_message when message already in progress', async () => {
    await submitAndFlush('task-concurrent');

    // Make interruptAttempt hang so the first sendMessage doesn't complete
    let resolveInterrupt: (() => void) | undefined;
    (mockIsolationProvider.interruptAttempt as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveInterrupt = (): void => {
            if (capturedOnComplete !== undefined) {
              capturedOnComplete(143);
            }
            resolve(true);
          };
        })
    );

    // Start first message (won't complete because interruptAttempt hangs)
    const firstMessagePromise = dispatcher.sendMessage('task-concurrent', 'First message');

    // Wait for the first message to start processing
    await flushAsync();

    // Try second message while first is in progress
    const secondResult = await dispatcher.sendMessage('task-concurrent', 'Second message');

    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) {
      expect(secondResult.error.type).toBe('concurrent_message');
    }

    // Clean up: resolve the first interrupt
    resolveInterrupt?.();
    await firstMessagePromise;
  });

  it('should include original prompt in resumed message prompt', async () => {
    await submitAndFlush('task-prompt');

    (mockIsolationProvider.interruptAttempt as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        if (capturedOnComplete !== undefined) {
          capturedOnComplete(143);
        }
        return true;
      }
    );

    await dispatcher.sendMessage('task-prompt', 'Fix the bug in auth');

    const createWorkerCalls = (mockIsolationProvider.createWorker as ReturnType<typeof vi.fn>).mock
      .calls;
    const lastCall = createWorkerCalls[createWorkerCalls.length - 1];
    const workerConfig = lastCall?.[0];

    expect(workerConfig?.prompt).toContain('Test prompt for messaging');
    expect(workerConfig?.prompt).toContain('Fix the bug in auth');
    expect(workerConfig?.prompt).toContain('[USER MESSAGE]');
  });
});
