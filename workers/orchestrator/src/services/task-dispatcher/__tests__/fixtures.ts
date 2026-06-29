import { vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { Task } from '../../../types/task.js';
import type { DispatcherContext } from '../dispatcher-context.js';
import type { ActivityTimeoutManager } from '../../activity-timeout-manager.js';

export function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'debug',
  } as unknown as Logger;
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    prompt: 'do thing',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    workerType: 'sonnet',
    worktreePath: '/tmp/worktrees/task-1',
    webhookUrl: 'http://code-agent/internal/webhook',
    webhookSecret: 'secret',
    status: 'running',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    attemptCount: 1,
    maxAttempts: 5,
    inactivityRestartCount: 0,
    linearIssueLabels: [],
    ...overrides,
  } as Task;
}

export interface ContextHarness {
  ctx: DispatcherContext;
  logger: Logger;
  tasks: Map<string, Task>;
  // accessor helpers
  runningCount: { value: number };
  appendOrchestratorTaskLog: ReturnType<typeof vi.fn>;
  appendTaggedTaskLog: ReturnType<typeof vi.fn>;
  flushTaskLogs: ReturnType<typeof vi.fn>;
  handleTaskCompletion: ReturnType<typeof vi.fn>;
  checkForResult: ReturnType<typeof vi.fn>;
  saveTask: ReturnType<typeof vi.fn>;
  destroyWorker: ReturnType<typeof vi.fn>;
  isWorkerRunning: ReturnType<typeof vi.fn>;
  pullImage: ReturnType<typeof vi.fn>;
  createWorker: ReturnType<typeof vi.fn>;
  cleanupTaskSession: ReturnType<typeof vi.fn>;
  webhookSend: ReturnType<typeof vi.fn>;
  logForwarderFlushAndStop: ReturnType<typeof vi.fn>;
  logForwarderUnregister: ReturnType<typeof vi.fn>;
  activityTimeoutManager: ActivityTimeoutManager;
}

export function makeContextHarness(initialTasks: Task[] = []): ContextHarness {
  const logger = makeLogger();
  const tasks = new Map<string, Task>();
  for (const t of initialTasks) tasks.set(t.taskId, t);

  const runningCount = { value: 0 };
  const appendOrchestratorTaskLog = vi.fn();
  const appendTaggedTaskLog = vi.fn();
  const flushTaskLogs = vi.fn().mockResolvedValue(undefined);
  const handleTaskCompletion = vi.fn().mockResolvedValue(undefined);
  const checkForResult = vi.fn().mockResolvedValue(undefined);
  const saveTask = vi.fn(async (task: Task) => {
    tasks.set(task.taskId, task);
  });
  const destroyWorker = vi.fn().mockResolvedValue(undefined);
  const isWorkerRunning = vi.fn().mockResolvedValue(true);
  const pullImage = vi.fn().mockResolvedValue('pulled-image');
  const createWorker = vi.fn().mockResolvedValue({ containerId: 'cont-abc' });
  const cleanupTaskSession = vi.fn().mockResolvedValue(undefined);
  const webhookSend = vi.fn().mockResolvedValue(undefined);
  const logForwarderFlushAndStop = vi.fn().mockResolvedValue(undefined);
  const logForwarderUnregister = vi.fn();

  const registerTask = vi.fn().mockResolvedValue(undefined);
  const unregisterTask = vi.fn();

  const activityTimeoutManager = {
    start: vi.fn(),
    stop: vi.fn(),
    touch: vi.fn(),
    recordRestart: vi.fn().mockReturnValue(true),
    getRestartCount: vi.fn().mockReturnValue(0),
  } as unknown as ActivityTimeoutManager;

  const ctx: DispatcherContext = {
    logger,
    config: { capacity: 5, logBasePath: '/tmp/orchestrator-test/logs' } as never,
    isolation: {
      provider: {
        isHealthy: vi.fn().mockReturnValue(true),
        destroyWorker,
        isWorkerRunning,
        pullImage,
        createWorker,
        cleanupTaskSession,
        getWorkerLogs: vi.fn().mockResolvedValue(''),
        getImageInfo: vi.fn().mockReturnValue({ configuredRef: 'image:tag' }),
        statsSnapshot: vi.fn().mockResolvedValue({}),
        copyOut: vi.fn().mockResolvedValue(undefined),
      },
      tokenRefresher: { registerTask, unregisterTask } as never,
      apiKeyValidator: {} as never,
      workerAuthRegistry: { getState: vi.fn() } as never,
      getSecrets: vi.fn().mockReturnValue({
        ANTHROPIC_API_KEY: 'a',
        LINEAR_API_KEY: 'l',
        SENTRY_AUTH_TOKEN: 's',
        MINIMAX_API_KEY: 'm',
        MIMO_API_KEY: 'mi',
        DASHSCOPE_API_KEY: 'd',
        KIMI_API_KEY: 'k',
        OPENROUTER_API_KEY: 'o',
      }),
      gcpSaKeyPath: '/tmp/gcp.key',
      githubAppKeyPath: '/tmp/gh.key',
    } as never,
    logForwarder: {
      appendChunk: vi.fn(),
      appendRawChunk: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      flushAndStop: logForwarderFlushAndStop,
      close: vi.fn(),
      unregisterTask: logForwarderUnregister,
      registerTask: vi.fn(),
    } as never,
    webhookClient: {
      send: webhookSend,
    } as never,
    statusUpdateClient: {} as never,
    statePersistence: {} as never,
    worktreeManager: {} as never,
    metrics: { increment: vi.fn(), record: vi.fn() } as never,
    activityTimeoutManager,
    turnMetricsCollector: undefined,
    agentComplianceValidator: undefined,
    completionMaxAttempts: 5,
    extractResumeSummaryFn: vi.fn().mockResolvedValue(undefined),
    verifyOverride: undefined,
    preserveWorkerContainers: false,
    activeTasks: new Map(),
    claudeErrors: new Map(),
    taskExitCodes: new Map(),
    attemptStartedAt: new Map(),
    attemptCompletionSignals: new Set(),
    completionInProgress: new Set(),
    inactivityRestartInProgress: new Set(),
    pendingMessages: new Map(),
    lastOutputAt: new Map(),
    inFlightHandlers: new Set(),
    shutdownSignal: undefined,
    trackInFlight: <T>(promise: Promise<T>): Promise<T> => promise,
    releaseSlot: () => {
      if (runningCount.value > 0) runningCount.value--;
    },
    appendOrchestratorTaskLog,
    appendTaggedTaskLog,
    flushTaskLogs,
    handleTaskCompletion,
    checkForResult,
    saveTask,
    getTask: async (taskId: string) => tasks.get(taskId) ?? null,
    startWorkerAttempt: vi.fn().mockResolvedValue({ ok: true, containerId: 'cont-abc' }),
    finalizeTask: vi.fn().mockResolvedValue(undefined),
    teardownAttempt: vi.fn().mockResolvedValue(undefined),
    clearTaskTimers: vi.fn(),
    scheduleTimeoutWarning: vi.fn(),
    scheduleTimeoutKill: vi.fn(),
    startCompletionMonitoring: vi.fn(),
    failAcceptedResume: vi.fn().mockResolvedValue(undefined),
    getRuntimeDisplayName: vi.fn().mockReturnValue('claude'),
    incrementRunningCount: () => {
      runningCount.value++;
    },
    tryAcquireCapacitySlot: async () => {
      runningCount.value++;
      return { ok: true, value: undefined };
    },
    getDefaultRepository: () => 'pbuchman/intexuraos',
    buildResumePreamble: () => '',
  };

  return {
    ctx,
    logger,
    tasks,
    runningCount,
    appendOrchestratorTaskLog,
    appendTaggedTaskLog,
    flushTaskLogs,
    handleTaskCompletion,
    checkForResult,
    saveTask,
    destroyWorker,
    isWorkerRunning,
    pullImage,
    createWorker,
    cleanupTaskSession,
    webhookSend,
    logForwarderFlushAndStop,
    logForwarderUnregister,
    activityTimeoutManager,
  };
}
