import { Mutex } from 'async-mutex';
import { type Result, type Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import type { Task, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
import type { SendMessageResult, SendMessageError } from '../types/schemas.js';
import type { StatePersistence } from './state-persistence.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { LogForwarder } from './log-forwarder.js';
import type { WebhookClient } from './webhook-client.js';
import type { StatusUpdateClient } from './status-update-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { IsolationProvider } from './isolation/types.js';
import { WORKER_TYPES } from './isolation/types.js';
import type { TokenRefresher } from './isolation/token-refresher.js';
import type { ApiKeyValidator } from './api-key-validator.js';
import type { WorkerAuthProvider, WorkerAuthRegistry } from './worker-auth/index.js';
import { ActivityTimeoutManager } from './activity-timeout-manager.js';
import {
  type CompletionAgentType,
  type CompletionVerifierVerdict,
  ResumeSummaryExtractor,
} from './completion-verifier.js';
import type { RuntimeEvent } from './runtime/index.js';
import type { TurnMetricsCollector } from './turn-metrics-collector.js';
import type {
  AgentComplianceValidator,
  ComplianceValidationInput,
} from './agent-compliance-validator.js';
import {
  buildMissingFieldsPrompt as buildMissingFieldsPromptFn,
  buildResumePreamble as buildResumePreambleFn,
  buildActiveGoalSection as buildActiveGoalSectionFn,
  parseRebaseResultOutput as parseRebaseResultOutputFn,
  parseContinuationPrOutput as parseContinuationPrOutputFn,
  getTaskEventUrl as getTaskEventUrlFn,
  hasFatalExitCodeField as hasFatalExitCodeFieldFn,
} from './task-dispatcher/prompts.js';
import {
  appendOrchestratorTaskLog as appendOrchestratorTaskLogFn,
  appendTaggedTaskLog as appendTaggedTaskLogFn,
  flushTaskLogs as flushTaskLogsFn,
} from './task-dispatcher/log-streaming.js';
import {
  checkForResult as checkForResultFn,
} from './task-dispatcher/webhook-callbacks.js';
import {
  getRuntimeDisplayName as getRuntimeDisplayNameFn,
} from './task-dispatcher/lifecycle.js';
import {
  INACTIVITY_TIMEOUT_MS,
  MAX_INACTIVITY_RESTARTS,
} from './task-dispatcher/retry-logic.js';
import type { DispatcherContext } from './task-dispatcher/dispatcher-context.js';
import { TaskRunner } from './task-dispatcher/task-runner.js';
import { TaskTimers } from './task-dispatcher/task-timers.js';
import { CompletionPipeline } from './task-dispatcher/completion-pipeline.js';
import { AttemptLifecycle } from './task-dispatcher/attempt-lifecycle.js';
// Re-export so external callers continue to import from the dispatcher barrel.
export { runVerification } from './task-dispatcher/completion-pipeline.js';
export type {
  LegacyVerdict,
  VerifierOverrideForTests,
} from './task-dispatcher/completion-pipeline.js';
export { computeTaskDurationMs } from './task-dispatcher/completion-pipeline.js';
import type { VerifierOverrideForTests } from './task-dispatcher/completion-pipeline.js';
import type { AttemptClassification } from './task-dispatcher/classify-attempt.js';
import { noopMetricsClient, type MetricsClient } from '../metrics.js';

// Re-export module-level helpers for backward compatibility with existing imports.
export const getTaskEventUrl = getTaskEventUrlFn;
export const hasFatalExitCodeField = hasFatalExitCodeFieldFn;
export const buildMissingFieldsPrompt = buildMissingFieldsPromptFn;

export interface DispatchError {
  type:
    | 'at_capacity'
    | 'docker_unavailable'
    | 'auth_unavailable'
    | 'invalid_request'
    | 'invalid_status'
    | 'service_error';
  message: string;
  originalError?: unknown;
}

export interface CancelError {
  type: 'not_found' | 'already_completed' | 'service_error';
  message: string;
  originalError?: unknown;
}

export interface IsolationConfig {
  provider: IsolationProvider;
  tokenRefresher: TokenRefresher;
  apiKeyValidator: ApiKeyValidator;
  workerAuthRegistry: WorkerAuthRegistry;
  getSecrets: () => {
    ANTHROPIC_API_KEY: string;
    LINEAR_API_KEY: string;
    SENTRY_AUTH_TOKEN: string;
    MINIMAX_API_KEY: string;
    MIMO_API_KEY: string;
    DASHSCOPE_API_KEY: string;
    OPENROUTER_API_KEY: string;
  };
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
}

export interface CompletionControlConfig {
  maxAttempts: number;
  /**
   * [INT-1470] The completion verifier is no longer an injected class — it's a
   * pure sync function (`verifyCompletion`) that the dispatcher calls directly.
   * Only the resume-summary helper (which is LLM-backed) remains injectable.
   *
   * `resumeSummaryExtractor` is required in production. Tests may pass
   * `verifier` instead as a legacy alias; it must expose `extractResumeSummary`
   * and (optionally) `verify` to override the deterministic pipeline.
   */
  resumeSummaryExtractor?: ResumeSummaryExtractor;
  /**
   * Test-only override. Production code must use `resumeSummaryExtractor` and
   * let `verifyCompletion` run as the verification pipeline. Tests pass
   * `verifier` to (optionally) stub the verify step; `adaptLegacyVerdictIfNeeded`
   * bridges the returned verdict into the canonical shape.
   *
   * @internal Test-only. Not part of the stable public API.
   */
  verifier?: VerifierOverrideForTests;
  preserveWorkerContainers?: boolean;
  /** Override inactivity timeout settings. Defaults: 10 min timeout, 3 max restarts. */
  activityTimeout?: {
    timeoutMs: number;
    maxRestarts: number;
  };
}

export class TaskDispatcher {
  private runningCount = 0;
  private readonly capacityMutex = new Mutex();
  private readonly activeTasks = new Map<string, NodeJS.Timeout>();
  private readonly claudeErrors = new Map<string, string>();
  private readonly taskExitCodes = new Map<string, number>();
  private readonly attemptStartedAt = new Map<string, number>();
  private readonly attemptCompletionSignals = new Set<string>();
  private readonly completionInProgress = new Set<string>();
  /** Task IDs whose handleInactivityRestart is currently mid-flight (after the
   *  old worker was killed, before the restart worker is up). The completion
   *  monitor skips these to avoid running verification on the stale transcript
   *  of the killed session. */
  private readonly inactivityRestartInProgress = new Set<string>();
  private readonly pendingMessages = new Map<string, string[]>();
  private readonly lastOutputAt = new Map<string, number>();
  private readonly completionMaxAttempts: number;
  /** Injectable resume-summary helper. In tests the override may instead
   * supply `verifier.extractResumeSummary` — we resolve to a uniform callable. */
  private readonly extractResumeSummaryFn: (
    taskId: string,
    rawLogs: string
  ) => Promise<string | undefined>;
  /** Optional test-only override for the verify() step (see VerifierOverrideForTests). */
  private readonly verifyOverride: VerifierOverrideForTests['verify'] | undefined; // @allow-undefined-type -- test-only hook; production leaves this unset to use verifyCompletion
  private readonly preserveWorkerContainers: boolean;
  private readonly activityTimeoutManager: ActivityTimeoutManager;
  /**
   * Custom-metrics client used to emit `code_tasks_*` on every task transition
   * (INT-1565 §S5). Defaults to a no-op so test fixtures that don't care about
   * metrics (and so the orchestrator running before S8 lands its
   * `@intexuraos/common-metrics` package) cannot crash on emission.
   */
  private readonly metrics: MetricsClient;

  /** INT-1551 §E.2: per-attempt execution module. */
  private readonly taskRunner: TaskRunner;
  /** INT-1551 §E.3: timer/monitor lifecycle module. */
  private readonly taskTimers: TaskTimers;
  /** INT-1551 §E.5: completion verifier + finalize pipeline module. */
  private readonly completionPipeline: CompletionPipeline;
  /** INT-1551 §E.4: attempt setup/recovery/inactivity-restart module. */
  private readonly attemptLifecycle: AttemptLifecycle;
  /** INT-1551 §10: shared state and dependency container for the sub-modules. */
  private readonly context: DispatcherContext;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly statePersistence: StatePersistence,
    private readonly worktreeManager: WorktreeManager,
    private readonly logForwarder: LogForwarder,
    private readonly webhookClient: WebhookClient,
    private readonly statusUpdateClient: StatusUpdateClient,
    _githubTokenService: GitHubTokenService,
    private readonly logger: Logger,
    private readonly isolation: IsolationConfig,
    completionControl: CompletionControlConfig,
    private readonly turnMetricsCollector?: TurnMetricsCollector,
    private readonly agentComplianceValidator?: AgentComplianceValidator,
    metrics?: MetricsClient
  ) {
    this.metrics = metrics ?? noopMetricsClient();
    this.completionMaxAttempts = completionControl.maxAttempts;
    // [INT-1470] Resolve which extractResumeSummary to use: prefer the
    // production-injected ResumeSummaryExtractor; fall back to the test-legacy
    // `verifier.extractResumeSummary`; last resort a no-op that returns undefined.
    const prodExtractor = completionControl.resumeSummaryExtractor;
    const testExtractor = completionControl.verifier?.extractResumeSummary;
    const noopExtractor = async (): Promise<string | undefined> => undefined;
    /* v8 ignore start -- ts-type: last-resort no-op fallback for the type-narrowed case where both `resumeSummaryExtractor` and `verifier.extractResumeSummary` are undefined; production wiring (service-wiring.ts) always supplies `resumeSummaryExtractor`, and every test constructs a verifier with `extractResumeSummary` — the bare-object CompletionControlConfig with neither arm is unreachable from both code paths @preserve */
    this.extractResumeSummaryFn = prodExtractor
      ? prodExtractor.extractResumeSummary.bind(prodExtractor)
      : (testExtractor ?? noopExtractor);
    /* v8 ignore stop @preserve */
    this.verifyOverride = completionControl.verifier?.verify;
    this.preserveWorkerContainers = completionControl.preserveWorkerContainers ?? false;
    /* v8 ignore start -- ts-type: defensive fallback for optional activityTimeout; TypeScript narrows via optional chaining + nullish coalescing @preserve */
    this.activityTimeoutManager = new ActivityTimeoutManager(
      {
        timeoutMs: completionControl.activityTimeout?.timeoutMs ?? INACTIVITY_TIMEOUT_MS,
        maxRestarts: completionControl.activityTimeout?.maxRestarts ?? MAX_INACTIVITY_RESTARTS,
        logger,
      },
      /* v8 ignore stop @preserve */
      (taskId) => {
        void this.handleInactivityRestart(taskId).catch((error: unknown) => {
          this.logger.error({ taskId, error }, 'Error in inactivity restart handler');
        });
      }
    );

    // INT-1551 §10: build the shared dispatcher context once and hand it to
    // the sub-modules. The dispatcher class still owns the per-task state
    // Maps/Sets physically; the context simply hands their references to
    // TaskRunner / TaskTimers so they can mutate in-place.
    this.context = {
      logger: this.logger,
      config: this.config,
      isolation: this.isolation,
      logForwarder: this.logForwarder,
      webhookClient: this.webhookClient,
      statusUpdateClient: this.statusUpdateClient,
      statePersistence: this.statePersistence,
      worktreeManager: this.worktreeManager,
      metrics: this.metrics,
      activityTimeoutManager: this.activityTimeoutManager,
      turnMetricsCollector: this.turnMetricsCollector,
      agentComplianceValidator: this.agentComplianceValidator,
      completionMaxAttempts: this.completionMaxAttempts,
      extractResumeSummaryFn: this.extractResumeSummaryFn,
      verifyOverride: this.verifyOverride,
      preserveWorkerContainers: this.preserveWorkerContainers,
      activeTasks: this.activeTasks,
      claudeErrors: this.claudeErrors,
      taskExitCodes: this.taskExitCodes,
      attemptStartedAt: this.attemptStartedAt,
      attemptCompletionSignals: this.attemptCompletionSignals,
      completionInProgress: this.completionInProgress,
      inactivityRestartInProgress: this.inactivityRestartInProgress,
      pendingMessages: this.pendingMessages,
      lastOutputAt: this.lastOutputAt,
      releaseSlot: (): void => {
        if (this.runningCount > 0) this.runningCount--;
      },
      appendOrchestratorTaskLog: (taskId: string, message: string): void => {
        this.appendOrchestratorTaskLog(taskId, message);
      },
      appendTaggedTaskLog: (taskId: string, tag: string, message: string): void => {
        this.appendTaggedTaskLog(taskId, tag, message);
      },
      flushTaskLogs: (taskId: string): Promise<void> => this.flushTaskLogs(taskId),
      handleTaskCompletion: (task: Task): Promise<void> => this.handleTaskCompletion(task),
      checkForResult: (task: Task): Promise<TaskResult | undefined> => this.checkForResult(task),
      saveTask: (task: Task): Promise<void> => this.saveTask(task),
      getTask: (taskId: string): Promise<Task | null> => this.getTask(taskId),
      // Cross-module orchestration callbacks. The bound dispatcher methods
      // (some of which delegate into the sub-modules instantiated below)
      // are wired immediately; the sub-modules can call them safely as
      // long as no module method runs synchronously inside the constructor.
      startWorkerAttempt: (
        task: Task,
        params: { prompt: string; continueSession: boolean; injectActiveGoal?: boolean }
      ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> =>
        this.startWorkerAttempt(task, params),
      finalizeTask: (
        task: Task,
        statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
        payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
        keepLogForwarderOpen?: boolean
      ): Promise<void> => this.finalizeTask(task, statusParam, payload, keepLogForwarderOpen),
      teardownAttempt: (taskId: string, keepSession: boolean): Promise<void> =>
        this.teardownAttempt(taskId, keepSession),
      clearTaskTimers: (taskId: string): void => {
        this.clearTaskTimers(taskId);
      },
      scheduleTimeoutWarning: (taskId: string): void => {
        this.scheduleTimeoutWarning(taskId);
      },
      scheduleTimeoutKill: (taskId: string): void => {
        this.scheduleTimeoutKill(taskId);
      },
      startCompletionMonitoring: (taskId: string): void => {
        this.startCompletionMonitoring(taskId);
      },
      failAcceptedResume: (task: Task, error: unknown): Promise<void> =>
        this.failAcceptedResume(task, error),
      getRuntimeDisplayName: (task: Task): string => this.getRuntimeDisplayName(task),
      incrementRunningCount: (): void => {
        this.runningCount++;
      },
    };

    this.taskRunner = new TaskRunner(this.context);
    this.taskTimers = new TaskTimers(this.context);
    this.completionPipeline = new CompletionPipeline(this.context);
    this.attemptLifecycle = new AttemptLifecycle(this.context);
  }

  private checkDockerAvailability(): Result<void, DispatchError> | null {
    if (this.isolation.provider.isHealthy?.() === false) {
      return {
        ok: false,
        error: { type: 'docker_unavailable', message: 'Docker daemon is not responding' },
      };
    }
    return null;
  }

  private getRequiredWorkerAuthProvider(
    workerType: CreateTaskRequest['workerType']
  ): WorkerAuthProvider | null {
    const workerTypeConfig = WORKER_TYPES[workerType];
    if (workerTypeConfig.runtime === 'codex') {
      return 'codex';
    }
    if (workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY') {
      return 'claude';
    }
    return null;
  }

  private checkWorkerAuthAvailability(
    workerType: CreateTaskRequest['workerType']
  ): Result<void, DispatchError> | null {
    const provider = this.getRequiredWorkerAuthProvider(workerType);
    if (provider === null) {
      return null;
    }

    const authState = this.isolation.workerAuthRegistry.getState(provider);
    const isReady =
      provider === 'codex'
        ? authState.status === 'active' ||
          (authState.status === 'expired' && authState.refreshSupported)
        : authState.status === 'active';

    if (isReady) {
      return null;
    }

    const providerName = provider === 'claude' ? 'Claude' : 'Codex';
    return {
      ok: false,
      error: {
        type: 'auth_unavailable',
        message: `${providerName} auth is not ready: ${authState.message ?? authState.status}`,
      },
    };
  }

  async submitTask(request: CreateTaskRequest): Promise<Result<void, DispatchError>> {
    const healthErr = this.checkDockerAvailability();
    if (healthErr !== null) return healthErr;

    const workerAuthErr = this.checkWorkerAuthAvailability(request.workerType);
    if (workerAuthErr !== null) return workerAuthErr;

    // Atomic capacity check
    const capacityCheck = await this.capacityMutex.runExclusive(() => {
      if (this.runningCount >= this.config.capacity) {
        return {
          ok: false as const,
          error: { type: 'at_capacity' as const, message: 'Service at capacity' },
        };
      }
      this.runningCount++;
      return { ok: true as const, value: undefined };
    });

    if (!capacityCheck.ok) {
      return capacityCheck;
    }

    this.executeTaskSetup(request).catch((error: unknown) => {
      this.logger.error({ taskId: request.taskId, error }, 'Unhandled error in async task setup');
    });

    return { ok: true, value: undefined };
  }

  /**
   * INT-1454: Ensure the git worktree metadata for an adopted task is present
   * before starting a new worker container. If the metadata directory is
   * missing but the worktree path exists on disk, delegate to
   * `WorktreeManager.repairWorktree` (canonical `git worktree repair`).
   *
   * Returns `null` on success. Returns a `DispatchError` wrapping a
   * terminal `WORKTREE_LOST` failure (and finalizes the task as failed) if
   * the worktree metadata is missing and cannot be repaired — running
   * additional attempts is pointless because every `git` command inside
   * the container would exit 128.
   */
  private async rehydrateWorktreeForAdoption(
    task: Task
  ): Promise<Result<void, DispatchError> | null> {
    return await this.attemptLifecycle.rehydrateWorktreeForAdoption(task);
  }

  async adoptTask(task: Task): Promise<Result<void, DispatchError>> {
    const healthErr = this.checkDockerAvailability();
    if (healthErr !== null) return healthErr;

    // Check if task is already at maxAttempts
    if ((task.attemptCount ?? 0) >= (task.maxAttempts ?? this.completionMaxAttempts)) {
      return {
        ok: false,
        error: { type: 'invalid_status', message: 'Task at max attempts' },
      };
    }

    // Atomic capacity check
    const capacityCheck = await this.capacityMutex.runExclusive(() => {
      if (this.runningCount >= this.config.capacity) {
        return {
          ok: false as const,
          error: { type: 'at_capacity' as const, message: 'Service at capacity' },
        };
      }
      this.runningCount++;
      return { ok: true as const, value: undefined };
    });

    if (!capacityCheck.ok) {
      return capacityCheck;
    }

    // INT-1454: Rehydrate worktree metadata before starting the container.
    // On orchestrator restart, `<repo>/.git/worktrees/<taskId>/` can disappear
    // while the bind-mounted worktree at `<base>/<taskId>/` survives. Without
    // repair, every `git` command inside the container fails with exit 128.
    const worktreeRehydrationError = await this.rehydrateWorktreeForAdoption(task);
    if (worktreeRehydrationError !== null) {
      return worktreeRehydrationError;
    }

    // Register with log forwarder
    this.logForwarder.registerTask(task.taskId, task.webhookSecret);

    // Start worker attempt with continueSession: true
    const startResult = await this.startWorkerAttempt(task, {
      prompt: task.prompt,
      continueSession: true,
    });

    if (!startResult.ok) {
      this.runningCount--;
      this.isolation.tokenRefresher.unregisterTask(task.taskId);
      this.logForwarder.unregisterTask(task.taskId);
      await this.isolation.provider.cleanupTaskSession?.(task.taskId);
      return {
        ok: false,
        error: {
          type: 'service_error',
          message: 'Failed to start worker for adopted task',
          originalError: startResult.error,
        },
      };
    }

    // Increment attempt count after successful start
    task.attemptCount = (task.attemptCount ?? 0) + 1;
    task.containerId = startResult.containerId;
    await this.saveTask(task);

    this.scheduleTimeoutWarning(task.taskId);
    this.scheduleTimeoutKill(task.taskId);
    this.startCompletionMonitoring(task.taskId);

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Task adopted after restart: attempt=${String(task.attemptCount)}/${String(task.maxAttempts ?? this.completionMaxAttempts)} containerId=${task.containerId}`
    );

    this.logger.info(
      {
        taskId: task.taskId,
        attemptCount: task.attemptCount,
        containerId: startResult.containerId,
      },
      `Task adopted: id=${task.taskId} attempt=${String(task.attemptCount)}/${String(task.maxAttempts ?? this.completionMaxAttempts)}`
    );

    return { ok: true, value: undefined };
  }

  private async executeTaskSetup(request: CreateTaskRequest): Promise<void> {
    await this.attemptLifecycle.executeTaskSetup(request, (req) =>
      this.getDefaultRepository(req)
    );
  }


  async cancelTask(taskId: string): Promise<Result<void, CancelError>> {
    const state = await this.statePersistence.load();
    const task = state.tasks[taskId];

    if (task === undefined) {
      return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
    }

    if (task.status !== 'running') {
      return { ok: false, error: { type: 'already_completed', message: 'Task already completed' } };
    }

    try {
      // Kill Docker container - destroyWorker handles graceful + force kill
      await this.isolation.provider.destroyWorker(taskId);

      try {
        await this.logForwarder.flushAndStop(taskId);
      } catch (flushError: unknown) {
        this.logger.error(
          { taskId, error: flushError },
          'Failed to flush logs during cancellation'
        );
      }
      this.logForwarder.unregisterTask(taskId);
      this.isolation.tokenRefresher.unregisterTask(taskId);
      this.claudeErrors.delete(taskId);
      this.taskExitCodes.delete(taskId);
      this.attemptStartedAt.delete(taskId);
      this.attemptCompletionSignals.delete(taskId);
      this.completionInProgress.delete(taskId);
      this.pendingMessages.delete(taskId);
      this.lastOutputAt.delete(taskId);
      await this.isolation.provider.cleanupTaskSession?.(taskId);

      // Update task status
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
      await this.saveTask(task);

      // Decrease running count
      if (this.runningCount > 0) this.runningCount--;
      this.clearTaskTimers(taskId);

      // Send webhook
      await this.webhookClient.send({
        url: task.webhookUrl,
        secret: task.webhookSecret,
        payload: {
          taskId,
          status: 'cancelled',
          duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
        },
        taskId,
      });

      this.logger.info({ taskId }, 'Task cancelled');

      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: { type: 'service_error', message: 'Failed to cancel task', originalError: error },
      };
    }
  }

  async sendMessage(
    taskId: string,
    message: string
  ): Promise<Result<SendMessageResult, SendMessageError>> {
    const loadResult = await this.statePersistence.load().catch((error: unknown) => {
      this.logger.error({ taskId, error }, 'Failed to load state persistence');
      return null;
    });
    if (loadResult === null) {
      return { ok: false, error: { type: 'service_error', message: 'Failed to load task state' } };
    }
    const task = loadResult.tasks[taskId];

    if (task === undefined) {
      const recovered = await this.tryRecoverMissingTask(taskId, message);
      if (recovered !== null) {
        return recovered;
      }

      return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
    }

    if (task.agentType === 'review' || task.agentType === 'remediation') {
      return {
        ok: false,
        error: {
          type: 'invalid_agent_type' as const,
          message: 'Cannot send messages to review/remediation tasks',
        },
      };
    }

    if (task.status === 'running') {
      const queue = this.pendingMessages.get(taskId) ?? [];
      queue.push(message);
      this.pendingMessages.set(taskId, queue);
      /* v8 ignore start -- source-map: ternary inside template literal misattributed by v8; truncation branch covered by test but not tracked by coverage @preserve */
      this.appendOrchestratorTaskLog(
        taskId,
        `Message queued (${String(queue.length)} pending): ${message.length > 200 ? message.slice(0, 200) + '\u2026' : message}`
      );
      /* v8 ignore stop @preserve */
      this.logger.info({ taskId }, 'Message queued for running task');
      return { ok: true, value: { action: 'queued', pendingMessages: [...queue] } };
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') {
      // Check if the worktree exists — a container can be recreated, but a worktree cannot.
      // If the container is gone but worktree exists, createWorker(continueSession=true) will
      // create a fresh container. If the worktree is also gone, reject — user must retry.
      const hasWorktree = await this.worktreeManager.worktreeExists(taskId);
      if (!hasWorktree) {
        return {
          ok: false,
          error: {
            type: 'not_found',
            message: 'Worker container and worktree no longer available for resume',
          },
        };
      }

      // Check if the container (or its session) is still available for resume.
      // If only the worktree survives but the container is gone, --continue will
      // start a fresh session with no context — worse than rejecting outright.
      // Use optional chaining + ?? true for fail-open on providers that don't implement this method.
      const canResume = (await this.isolation.provider.isResumeAvailable?.(taskId)) ?? true;
      if (!canResume) {
        return {
          ok: false,
          error: {
            type: 'session_expired',
            message:
              'Session has expired — the worker container was cleaned up. Please start a new session.',
          },
        };
      }

      const wasCompleted = task.status === 'completed';
      await this.teardownAttempt(taskId, true);

      // Register secret BEFORE any appendOrchestratorTaskLog calls, because
      // appendChunk creates a ForwardingState that captures the webhook secret
      // at creation time and never refreshes it.
      this.logForwarder.registerTask(taskId, task.webhookSecret);

      this.appendOrchestratorTaskLog(taskId, 'Resuming task with user message');
      /* v8 ignore start -- source-map: ternary inside function argument misattributed by v8; truncation branch covered by test but not tracked by coverage @preserve */
      this.appendTaggedTaskLog(
        taskId,
        'prompt',
        message.length > 200 ? message.slice(0, 200) + '\u2026' : message
      );
      /* v8 ignore stop @preserve */

      const prompt =
        task.agentType === 'ask_agent' ? message : this.buildResumePreamble(task) + message;
      task.status = 'running';
      task.containerId = '';
      task.startedAt = new Date().toISOString();
      task.attemptCount = 1;
      task.verificationHistory = [];
      // INT-1455: `taskInfraFailureHistory` is intentionally NOT reset on resume.
      // When a user resumes a failed task that died on infra (e.g. image pull),
      // and the resume fails the SAME way, the classifier's repeat-sub-reason
      // check at finalizeAttemptAsInfraFailure flips the remediation copy to
      // contact_support so log/UI triage clearly shows this isn't a flaky
      // first-time failure. `verificationHistory`, by contrast, describes the
      // old attempt's verifier verdict and is no longer relevant.
      task.pendingResumeStart = {
        prompt,
        acceptedAt: new Date().toISOString(),
      };
      delete task.completedAt;
      if (wasCompleted) {
        task.resumedAfterSuccess = true;
      } else {
        delete task.resumedAfterSuccess;
      }
      await this.saveTask(task);

      this.runningCount++;
      void this.resumeTaskWithUserMessage(task).catch((error: unknown) => {
        void this.failAcceptedResume(task, error);
      });
      this.logger.info({ taskId }, 'Task resume accepted with user message');
      return { ok: true, value: { action: 'resumed' } };
    }

    return {
      ok: false,
      error: {
        type: 'invalid_status',
        message: `Cannot send message to task with status "${task.status}"`,
      },
    };
  }

  async getTask(taskId: string): Promise<Task | null> {
    const state = await this.statePersistence.load();
    return state.tasks[taskId] ?? null;
  }

  async recoverPendingResumeTask(task: Task): Promise<Result<void, DispatchError>> {
    if (task.status !== 'running' || task.pendingResumeStart === undefined) {
      return {
        ok: false,
        error: {
          type: 'invalid_status',
          message: 'Task does not have an accepted resume pending startup',
        },
      };
    }

    this.logForwarder.registerTask(task.taskId, task.webhookSecret);
    this.runningCount++;
    // `ok: true` here means startup recovery took ownership of the accepted resume.
    // Worker startup may still fail, in which case resumeTaskWithUserMessage finalizes the task.
    this.logger.info({ taskId: task.taskId }, 'Recovering pending accepted resume after restart');
    await this.resumeTaskWithUserMessage(task);

    return { ok: true, value: undefined };
  }

  getRunningCount(): number {
    return this.runningCount;
  }

  getCapacity(): number {
    return this.config.capacity;
  }

  getRunningTaskIds(): string[] {
    return Array.from(this.activeTasks.keys())
      .filter((key) => key.endsWith('-monitor'))
      .map((key) => key.replace('-monitor', ''));
  }

  private getDefaultRepository(_request: CreateTaskRequest): string {
    // TODO: Implement GitHub API call to get default repository
    // For now, use a default
    return 'pbuchman/intexuraos';
  }

  private getRuntimeDisplayName(task: Task): string {
    return getRuntimeDisplayNameFn(task);
  }

  private async saveTask(task: Task): Promise<void> {
    await this.statePersistence.modify((state) => {
      state.tasks[task.taskId] = task;
    });
  }

  private async tryRecoverMissingTask(
    taskId: string,
    message: string
  ): Promise<Result<SendMessageResult, SendMessageError> | null> {
    return await this.attemptLifecycle.tryRecoverMissingTask(taskId, message);
  }


  private async resumeTaskWithUserMessage(task: Task): Promise<void> {
    await this.attemptLifecycle.resumeTaskWithUserMessage(task);
  }

  private scheduleTimeoutWarning(taskId: string): void {
    this.taskTimers.scheduleTimeoutWarning(taskId);
  }

  private scheduleTimeoutKill(taskId: string): void {
    this.taskTimers.scheduleTimeoutKill(taskId);
  }

  private async handleInactivityRestart(taskId: string): Promise<void> {
    await this.attemptLifecycle.handleInactivityRestart(taskId);
  }


  private startCompletionMonitoring(taskId: string): void {
    this.taskTimers.startCompletionMonitoring(taskId);
  }

  private async handleTaskCompletion(task: Task): Promise<void> {
    await this.completionPipeline.handleTaskCompletion(task);
  }

  /**
   * INT-1455: Finalize an attempt classified as `infra_failed`. Skips the
   * verifier entirely and writes a `WORKER_INFRA_FAILURE` TaskError. If the
   * same sub-reason was observed on the previous attempt, mark the remediation
   * action as contact_support so the code-agent classifier stops looping.
   */
  async finalizeAttemptAsInfraFailure(
    task: Task,
    attempt: number,
    classification: Extract<AttemptClassification, { outcome: 'infra_failed' }>,
    result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
  ): Promise<void> {
    await this.completionPipeline.finalizeAttemptAsInfraFailure(
      task,
      attempt,
      classification,
      result
    );
  }

  buildResultFromVerification(
    task: Task,
    gitResult: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
    verification: CompletionVerifierVerdict,
    agentType: CompletionAgentType
  ): TaskResult {
    return this.completionPipeline.buildResultFromVerification(task, gitResult, verification, agentType);
  }



  private buildResumePreamble(task?: Task): string {
    return buildResumePreambleFn(task);
  }

  /**
   * @internal
   * Preserved on the class so existing unit tests that spy via
   * `internal.buildActiveGoalSection(...)` continue to work after the
   * implementation moved to `task-dispatcher/prompts.ts` and the only
   * production caller (`startWorkerAttempt`) moved to `TaskRunner`.
   */
  buildActiveGoalSection(task: Task | undefined, prompt: string): string {
    return buildActiveGoalSectionFn(task, prompt);
  }

  /**
   * @internal
   * Preserved on the class so existing unit tests that spy via
   * `dispatcher.handleRuntimeEvents(...)` continue to work after the
   * implementation moved to `TaskRunner`.
   */
  async handleRuntimeEvents(task: Task, events: RuntimeEvent[]): Promise<void> {
    await this.taskRunner.handleRuntimeEvents(task, events);
  }

  /**
   * @internal
   * Preserved on the class so existing unit tests that spy via
   * `getInternal().parseRebaseResultOutput(...)` continue to work after the
   * implementation moved to `task-dispatcher/prompts.ts`.
   */
  parseRebaseResultOutput(output: string, taskId: string): TaskResult['rebaseResult'] | undefined {
    return parseRebaseResultOutputFn(output, taskId, this.logger);
  }

  /**
   * @internal
   * Preserved on the class so existing unit tests that spy via
   * `internal.parseContinuationPrOutput(...)` continue to work after the
   * implementation moved to `task-dispatcher/prompts.ts`.
   */
  parseContinuationPrOutput(
    taskId: string,
    prOutput: string
  ):
    | {
        url?: string;
        number?: number;
        headRefName?: string;
        title?: string;
        state?: string;
        mergedAt?: string | null;
      }
    | undefined {
    return parseContinuationPrOutputFn(taskId, prOutput, this.logger);
  }


  private async startWorkerAttempt(
    task: Task,
    params: {
      prompt: string;
      continueSession: boolean;
      injectActiveGoal?: boolean;
    }
  ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> {
    return await this.taskRunner.startWorkerAttempt(task, params);
  }

  private async teardownAttempt(taskId: string, keepSession: boolean): Promise<void> {
    await this.attemptLifecycle.teardownAttempt(taskId, keepSession);
  }

  private async failAcceptedResume(task: Task, error: unknown): Promise<void> {
    await this.attemptLifecycle.failAcceptedResume(task, error);
  }

  private async finalizeTask(
    task: Task,
    statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
    keepLogForwarderOpen = false
  ): Promise<void> {
    await this.completionPipeline.finalizeTask(task, statusParam, payload, keepLogForwarderOpen);
  }

  private async checkForResult(task: Task): Promise<TaskResult | undefined> {
    return await checkForResultFn(this.logger, task);
  }

  private appendOrchestratorTaskLog(taskId: string, message: string): void {
    appendOrchestratorTaskLogFn(this.logForwarder, taskId, message);
  }

  private appendTaggedTaskLog(taskId: string, tag: string, message: string): void {
    appendTaggedTaskLogFn(this.logForwarder, taskId, tag, message);
  }

  private async flushTaskLogs(taskId: string): Promise<void> {
    await flushTaskLogsFn(this.logForwarder, this.logger, taskId);
  }


  async prepareComplianceValidationInput(
    task: Task,
    finalResult: TaskResult,
    verification: CompletionVerifierVerdict
  ): Promise<ComplianceValidationInput | undefined> {
    return await this.completionPipeline.prepareComplianceValidationInput(
      task,
      finalResult,
      verification
    );
  }

  async executeComplianceValidation(
    task: Task,
    input: ComplianceValidationInput
  ): Promise<void> {
    await this.completionPipeline.executeComplianceValidation(task, input);
  }

  async flushAndCloseLogForwarder(taskId: string): Promise<void> {
    await this.completionPipeline.flushAndCloseLogForwarder(taskId);
  }

  private clearTaskTimers(taskId: string): void {
    this.taskTimers.clearTaskTimers(taskId);
  }

  /**
   * Emit the `code_tasks_*` metric family for a task that has just reached
   * a terminal state (INT-1565 §S5).
   *
   * - `code_tasks_completed{status}` increments on every terminal transition.
   * - `code_tasks_failed{reason}` increments only for non-success terminal
   *   statuses; `reason` carries the raw status (`failed | interrupted |
   *   cancelled`) so dashboards can distinguish operator-cancelled from
   *   genuinely failed runs.
   * - `code_tasks_duration{status}` records wall-clock duration in ms;
   *   non-finite or negative durations are clamped to 0 so the distribution
   *   stays well-formed.
   *
   * Public so the startup-recovery path in `main.ts` can also count
   * `interrupted` transitions that bypass `finalizeTask()` (the recovery
   * loop marks `running` tasks `interrupted` directly when their container
   * is gone). Without this, restart-induced interruptions would be missing
   * from the `code_tasks_*` series.
   *
   * Emission is best-effort — `MetricsClient` swallows its own errors, but
   * we wrap the duration parse defensively because a malformed `startedAt`
   * timestamp would otherwise propagate `NaN` into the histogram.
   */
  emitTerminalMetrics(
    task: Task,
    finalStatus: 'completed' | 'failed' | 'interrupted' | 'cancelled'
  ): void {
    this.completionPipeline.emitTerminalMetrics(task, finalStatus);
  }
}
