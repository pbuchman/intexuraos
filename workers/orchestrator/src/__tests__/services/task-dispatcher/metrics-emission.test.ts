/**
 * Tests for INT-1565 §S5: code_tasks_* metric emission inside finalizeTask.
 *
 * The dispatcher constructor accepts an optional `metrics` client; we inject
 * a fake to assert the contract:
 *   • `code_tasks_completed{status}` increments on every terminal transition.
 *   • `code_tasks_failed{reason}` increments only for non-success terminal states.
 *   • `code_tasks_duration{status}` records wall-clock duration in ms.
 *
 * Tests reach into `finalizeTask` via `as unknown as { finalizeTask }` to
 * bypass the orchestration pipeline and invoke the metric emission path
 * deterministically, mirroring the existing finalizeTask suite above.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TaskDispatcher,
  type IsolationConfig,
  computeTaskDurationMs,
} from '../../../services/task-dispatcher.js';
import type { OrchestratorConfig } from '../../../types/config.js';
import type { Task } from '../../../types/task.js';
import type { OrchestratorState } from '../../../types/state.js';
import type { StatePersistence } from '../../../services/state-persistence.js';
import type { WorktreeManager } from '../../../services/worktree-manager.js';
import type { LogForwarder } from '../../../services/log-forwarder.js';
import type { WebhookClient } from '../../../services/webhook-client.js';
import type { StatusUpdateClient } from '../../../services/status-update-client.js';
import type { GitHubTokenService } from '../../../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';
import type { IsolationProvider, WorkerHandle } from '../../../services/isolation/types.js';
import type { TokenRefresher } from '../../../services/isolation/token-refresher.js';
import type { ApiKeyValidator } from '../../../services/api-key-validator.js';
import type { WorkerAuthRegistry } from '../../../services/worker-auth/index.js';
import { CODE_TASK_METRICS, type MetricsClient } from '../../../metrics.js';

/**
 * Fake `MetricsClient` whose methods are vitest spies. Cast through `unknown`
 * because vi.fn()'s type signature is too loose to satisfy the generic
 * `<L extends MetricLabel>` shape on `MetricsClient.increment` / `.record`.
 */
interface FakeMetricsClient {
  increment: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}

function createFakeMetrics(): FakeMetricsClient {
  return {
    increment: vi.fn(),
    record: vi.fn(),
    flush: vi.fn(async () => undefined),
  };
}

function asClient(fake: FakeMetricsClient): MetricsClient {
  return fake as unknown as MetricsClient;
}

const baseConfig: OrchestratorConfig = {
  port: 8100,
  capacity: 5,
  taskTimeoutMs: 10800000,
  stateFilePath: '/tmp/state.json',
  worktreeBasePath: '/tmp/worktrees',
  logBasePath: '/tmp/logs',
  codeAgentUrl: 'http://localhost:8080',
  githubAppId: 'a',
  githubAppPrivateKeyPath: '/tmp/key.pem',
  githubInstallationId: 'i',
  orchestratorSecret: 's',
  secretsBasePath: '/tmp/secrets',
  internalAuthToken: 't',
};

function createStatePersistence(initialTasks: Record<string, Task> = {}): StatePersistence {
  const state: OrchestratorState = {
    tasks: { ...initialTasks },
    githubToken: null,
    pendingWebhooks: [],
  };
  return {
    load: vi.fn(async () => JSON.parse(JSON.stringify(state)) as OrchestratorState),
    save: vi.fn(async (next: OrchestratorState) => {
      Object.assign(state, next);
    }),
    saveAtomic: vi.fn(async (next: OrchestratorState) => {
      Object.assign(state, next);
    }),
    modify: vi.fn(async (fn: (s: OrchestratorState) => void | Promise<void>) => {
      const current: OrchestratorState = JSON.parse(JSON.stringify(state));
      await fn(current);
      Object.assign(state, current);
    }),
    detectOrphanWorktrees: vi.fn(async () => []),
    emptyState: () => ({ tasks: {}, githubToken: null, pendingWebhooks: [] }),
  } as unknown as StatePersistence;
}

const isolationProvider: IsolationProvider = {
  createWorker: vi.fn(
    async (cfg): Promise<WorkerHandle> => ({
      taskId: cfg.taskId,
      containerId: `c-${cfg.taskId}`,
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
  copyOut: vi.fn(async () => undefined),
  statsSnapshot: vi.fn(async () => ({ cpuTotalUsage: 0, memoryUsage: 0, pidsCurrent: 0 })),
  listWorkers: vi.fn(async () => []),
  cleanupTaskSession: vi.fn(async () => undefined),
  isResumeAvailable: vi.fn(async () => true),
  isHealthy: vi.fn(() => true),
  pullImage: vi.fn(async () => 'image@sha256:test'),
};

const isolationConfig: IsolationConfig = {
  provider: isolationProvider,
  tokenRefresher: {
    registerTask: vi.fn(),
    unregisterTask: vi.fn(),
    stop: vi.fn(),
  } as unknown as TokenRefresher,
  apiKeyValidator: { validate: vi.fn(async () => ({ valid: true })) } as unknown as ApiKeyValidator,
  workerAuthRegistry: {
    getState: vi.fn(),
  } as unknown as WorkerAuthRegistry,
  getSecrets: () => ({
    ANTHROPIC_API_KEY: '',
    LINEAR_API_KEY: '',
    ERROR_HUB_HOST: 'home-dev.example.ts.net:8443',
    MINIMAX_API_KEY: '',
    MIMO_API_KEY: '',
    DASHSCOPE_API_KEY: '',
    KIMI_API_KEY: '',
    OPENROUTER_API_KEY: '',
  }),
  gcpSaKeyPath: '/tmp/gcp-sa.json',
  githubAppKeyPath: '/tmp/github-app.pem',
};

const logForwarder = {
  startForwarding: vi.fn(),
  stopForwarding: vi.fn(async () => undefined),
  flushAndStop: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
  close: vi.fn(),
  getDroppedChunkCount: vi.fn(() => 0),
  registerTask: vi.fn(),
  unregisterTask: vi.fn(),
  appendChunk: vi.fn(),
  appendRawChunk: vi.fn(),
} as unknown as LogForwarder;

const webhookClient = {
  send: vi.fn(async () => ({ ok: true, value: undefined })),
  retryPending: vi.fn(async () => undefined),
  getPendingCount: vi.fn(async () => 0),
} as unknown as WebhookClient;

const statusUpdateClient = {
  commit: vi.fn(async () => ({ ok: true as const })),
} as unknown as StatusUpdateClient;

const tokenService = {
  getToken: vi.fn(async () => ({ token: 't', expiresAt: '' })),
} as unknown as GitHubTokenService;

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const worktreeManager = {
  createWorktree: vi.fn(async () => '/tmp/worktrees/x'),
  deleteWorktree: vi.fn(async () => ({ ok: true, value: undefined })),
  worktreeExists: vi.fn(async () => true),
  isWorktreeRegistered: vi.fn(async () => true),
  repairWorktree: vi.fn(async () => undefined),
} as unknown as WorktreeManager;

const completionControl = {
  maxAttempts: 1,
  activityTimeout: { timeoutMs: 6 * 60 * 60 * 1000, maxRestarts: 3 },
  verifier: {
    verify: vi.fn(),
    extractResumeSummary: vi.fn().mockResolvedValue(undefined),
  },
};

interface DispatcherInternals {
  finalizeTask: (
    task: Task,
    status: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: unknown; error?: unknown },
    keepLogOpen?: boolean
  ) => Promise<void>;
}

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 't-1',
    workerType: 'auto',
    prompt: 'p',
    webhookUrl: 'https://example.com/webhook',
    webhookSecret: 's',
    status: 'running',
    startedAt: '2026-04-25T00:00:00.000Z',
    attempts: 1,
    linearIssueLabels: [],
    hasChildren: false,
    ...overrides,
  } as Task;
}

function buildDispatcherWithMetrics(metrics: MetricsClient): TaskDispatcher {
  return new TaskDispatcher(
    baseConfig,
    createStatePersistence(),
    worktreeManager,
    logForwarder,
    webhookClient,
    statusUpdateClient,
    tokenService,
    logger,
    isolationConfig,
    completionControl,
    undefined,
    undefined,
    metrics
  );
}

describe('finalizeTask metric emission (INT-1565 §S5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments code_tasks_completed{status="success"} on completed transition', async () => {
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const task = buildTask();

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'completed', {});

    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.COMPLETED, {
      status: 'success',
    });
    // No `code_tasks_failed` on success.
    const failedCalls = metrics.increment.mock.calls.filter(
      (call) => call[0] === CODE_TASK_METRICS.FAILED
    );
    expect(failedCalls).toEqual([]);
  });

  it('increments code_tasks_completed{status="failed"} AND code_tasks_failed{reason="failed"} on failed transition', async () => {
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const task = buildTask({ taskId: 't-failed' });

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'failed', {});

    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.COMPLETED, {
      status: 'failed',
    });
    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.FAILED, { reason: 'failed' });
  });

  it('treats interrupted transition as failed for the code_tasks_completed label', async () => {
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const task = buildTask({ taskId: 't-interrupted' });

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'interrupted', {});

    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.COMPLETED, {
      status: 'failed',
    });
    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.FAILED, {
      reason: 'interrupted',
    });
  });

  it('treats cancelled transition as failed for the code_tasks_completed label', async () => {
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const task = buildTask({ taskId: 't-cancelled' });

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'cancelled', {});

    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.COMPLETED, {
      status: 'failed',
    });
    expect(metrics.increment).toHaveBeenCalledWith(CODE_TASK_METRICS.FAILED, {
      reason: 'cancelled',
    });
  });

  it('records a non-negative duration sample tagged with the metric status', async () => {
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const task = buildTask({ startedAt: new Date(Date.now() - 5000).toISOString() });

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'completed', {});

    expect(metrics.record).toHaveBeenCalledTimes(1);
    const [metric, labels, value] = metrics.record.mock.calls[0] as [
      unknown,
      Record<string, string>,
      number,
    ];
    expect(metric).toBe(CODE_TASK_METRICS.DURATION);
    expect(labels).toEqual({ status: 'success' });
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it('records a clamped 0 duration when the wired finalize path sees a future startedAt', async () => {
    // Wired-path coverage for the `delta > 0 ? delta : 0` branch in
    // computeTaskDurationMs: this is exercised in isolation by the unit test
    // below, but we also want to confirm the dispatcher pipeline plumbs the
    // clamped value through to `metrics.record` without rounding or sign
    // errors. Set startedAt 1 hour in the future so finalizeTask's
    // `task.completedAt = new Date().toISOString()` produces a negative delta.
    const metrics = createFakeMetrics();
    const dispatcher = buildDispatcherWithMetrics(asClient(metrics));
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const task = buildTask({ taskId: 't-future-start', startedAt: future });

    await (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'completed', {});

    expect(metrics.record).toHaveBeenCalledTimes(1);
    const [, , value] = metrics.record.mock.calls[0] as [unknown, unknown, number];
    expect(value).toBe(0);
  });

  it('logs a warning and continues finalization when MetricsClient.increment throws', async () => {
    // INT-1565 review: emitTerminalMetrics is wrapped in try/catch so a
    // hand-rolled metrics client that throws cannot crash the finalize hot
    // path. Use a metrics client whose increment is hard-throwing (not just
    // recording) and assert finalize (a) completes and (b) emits the
    // documented warn line — without the warn assertion, a future regression
    // that swaps `logger.warn` for a silent swallow would not be caught.
    const warnSpy = vi.fn();
    const throwingMetrics: MetricsClient = {
      increment: () => {
        throw new Error('metrics outage');
      },
      record: vi.fn(),
      flush: vi.fn(async () => undefined),
    };
    const dispatcher = new TaskDispatcher(
      baseConfig,
      createStatePersistence(),
      worktreeManager,
      logForwarder,
      webhookClient,
      statusUpdateClient,
      tokenService,
      { ...logger, warn: warnSpy } as unknown as Logger,
      isolationConfig,
      completionControl,
      undefined,
      undefined,
      throwingMetrics
    );
    const task = buildTask({ taskId: 't-metrics-throw' });

    await expect(
      (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'completed', {})
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't-metrics-throw', error: expect.any(Error) }),
      'metrics emission failed during finalize; continuing'
    );
  });

  it('falls back to a no-op metrics client when none is injected (no throws)', async () => {
    // Constructing without the metrics arg means the no-op default kicks in.
    const dispatcher = new TaskDispatcher(
      baseConfig,
      createStatePersistence(),
      worktreeManager,
      logForwarder,
      webhookClient,
      statusUpdateClient,
      tokenService,
      logger,
      isolationConfig,
      completionControl
    );
    const task = buildTask({ taskId: 't-noop' });

    await expect(
      (dispatcher as unknown as DispatcherInternals).finalizeTask(task, 'completed', {})
    ).resolves.toBeUndefined();
  });
});

describe('computeTaskDurationMs', () => {
  it('returns the positive elapsed time when both timestamps are valid', () => {
    const task = buildTask({
      startedAt: '2026-04-25T00:00:00.000Z',
      completedAt: '2026-04-25T00:00:05.000Z',
    });
    expect(computeTaskDurationMs(task)).toBe(5000);
  });

  it('returns 0 when completedAt is missing', () => {
    const task = buildTask();
    expect(computeTaskDurationMs(task)).toBe(0);
  });

  it('returns 0 when startedAt is unparseable', () => {
    const task = buildTask({
      startedAt: 'not-a-date',
      completedAt: '2026-04-25T00:00:05.000Z',
    });
    expect(computeTaskDurationMs(task)).toBe(0);
  });

  it('returns 0 when completedAt is unparseable', () => {
    const task = buildTask({
      startedAt: '2026-04-25T00:00:00.000Z',
      completedAt: 'not-a-date',
    });
    expect(computeTaskDurationMs(task)).toBe(0);
  });

  it('clamps negative deltas (clock skew) to 0', () => {
    const task = buildTask({
      startedAt: '2026-04-25T00:00:10.000Z',
      completedAt: '2026-04-25T00:00:05.000Z',
    });
    expect(computeTaskDurationMs(task)).toBe(0);
  });
});
