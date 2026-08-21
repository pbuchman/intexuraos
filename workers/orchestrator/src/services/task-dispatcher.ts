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
import type { TokenRefresher } from './isolation/token-refresher.js';
import type { ApiKeyValidator } from './api-key-validator.js';
import type { WorkerAuthRegistry } from './worker-auth/index.js';
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
  missingFieldsPrompt as missingFieldsPromptObj,
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
import { checkForResult as checkForResultFn } from './task-dispatcher/webhook-callbacks.js';
import { getRuntimeDisplayName as getRuntimeDisplayNameFn } from './task-dispatcher/lifecycle.js';
import { INACTIVITY_TIMEOUT_MS, MAX_INACTIVITY_RESTARTS } from './task-dispatcher/retry-logic.js';
import type { DispatcherContext } from './task-dispatcher/dispatcher-context.js';
import { TaskRunner } from './task-dispatcher/task-runner.js';
import { TaskTimers } from './task-dispatcher/task-timers.js';
import { CompletionPipeline } from './task-dispatcher/completion-pipeline.js';
import { AttemptLifecycle } from './task-dispatcher/attempt-lifecycle.js';
import {
  submitTask as submitTaskOp,
  adoptTask as adoptTaskOp,
  cancelTask as cancelTaskOp,
  sendMessage as sendMessageOp,
} from './task-dispatcher/operations.js';
import { buildDispatcherContext } from './task-dispatcher/setup.js';
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
export const missingFieldsPrompt = missingFieldsPromptObj;

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
    ERROR_HUB_HOST: string;
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
  private readonly runningCountBox = { value: 0 };
  /**
   * @internal Tests poke this directly via `dispatcher as unknown as { runningCount: number }`.
   * Backed by `runningCountBox.value` so the sub-modules see writes through the shared context.
   */
  get runningCount(): number {
    return this.runningCountBox.value;
  }
  set runningCount(v: number) {
    this.runningCountBox.value = v;
  }
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
  /**
   * INT-1551 §E.7: in-flight fire-and-forget handler promises. The shutdown
   * handler in `main.ts` calls `getInFlightPromises()` and awaits drain via
   * `Promise.race` against `SHUTDOWN_TIMEOUT_MS`.
   */
  private readonly inFlightHandlers = new Set<Promise<unknown>>();
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
        // INT-1551 §E.7: track inactivity-restart so graceful shutdown drains it.
        void this.context.trackInFlight(
          this.attemptLifecycle.handleInactivityRestart(taskId).catch((error: unknown) => {
            this.logger.error({ taskId, error }, 'Error in inactivity restart handler');
          })
        );
      }
    );

    // INT-1551 §E.6: build the shared dispatcher context once via the
    // helper in `task-dispatcher/setup.ts`. The class still owns per-task
    // state Maps/Sets/counter physically — they're handed in by reference.
    this.context = buildDispatcherContext(
      {
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
      },
      {
        activeTasks: this.activeTasks,
        claudeErrors: this.claudeErrors,
        taskExitCodes: this.taskExitCodes,
        attemptStartedAt: this.attemptStartedAt,
        attemptCompletionSignals: this.attemptCompletionSignals,
        completionInProgress: this.completionInProgress,
        inactivityRestartInProgress: this.inactivityRestartInProgress,
        pendingMessages: this.pendingMessages,
        lastOutputAt: this.lastOutputAt,
        inFlightHandlers: this.inFlightHandlers,
        capacityMutex: this.capacityMutex,
        runningCount: this.runningCountBox,
      },
      {
        appendOrchestratorTaskLog: (taskId, message): void => {
          this.appendOrchestratorTaskLog(taskId, message);
        },
        appendTaggedTaskLog: (taskId, tag, message): void => {
          this.appendTaggedTaskLog(taskId, tag, message);
        },
        flushTaskLogs: (taskId) => this.flushTaskLogs(taskId),
        handleTaskCompletion: (task) => this.completionPipeline.handleTaskCompletion(task),
        checkForResult: (task) => this.checkForResult(task),
        saveTask: (task) => this.saveTask(task),
        getTask: (taskId) => this.getTask(taskId),
        startWorkerAttempt: (task, params) => this.taskRunner.startWorkerAttempt(task, params),
        finalizeTask: (task, statusParam, payload, keepLogForwarderOpen) =>
          this.completionPipeline.finalizeTask(task, statusParam, payload, keepLogForwarderOpen),
        teardownAttempt: (taskId, keepSession) =>
          this.attemptLifecycle.teardownAttempt(taskId, keepSession),
        clearTaskTimers: (taskId): void => {
          this.taskTimers.clearTaskTimers(taskId);
        },
        scheduleTimeoutWarning: (taskId, overrideKillMs): void => {
          this.taskTimers.scheduleTimeoutWarning(taskId, overrideKillMs);
        },
        scheduleTimeoutKill: (taskId, overrideKillMs): void => {
          this.taskTimers.scheduleTimeoutKill(taskId, overrideKillMs);
        },
        startCompletionMonitoring: (taskId): void => {
          this.taskTimers.startCompletionMonitoring(taskId);
        },
        failAcceptedResume: (task, error) => this.attemptLifecycle.failAcceptedResume(task, error),
        getRuntimeDisplayName: (task) => getRuntimeDisplayNameFn(task),
        getDefaultRepository: () => 'pbuchman/intexuraos',
      }
    );

    this.taskRunner = new TaskRunner(this.context);
    this.taskTimers = new TaskTimers(this.context);
    this.completionPipeline = new CompletionPipeline(this.context);
    this.attemptLifecycle = new AttemptLifecycle(this.context);
  }

  async submitTask(request: CreateTaskRequest): Promise<Result<void, DispatchError>> {
    return await submitTaskOp(this.context, this.attemptLifecycle, request);
  }

  async adoptTask(task: Task): Promise<Result<void, DispatchError>> {
    return await adoptTaskOp(this.context, this.attemptLifecycle, task);
  }

  async cancelTask(taskId: string): Promise<Result<void, CancelError>> {
    return await cancelTaskOp(this.context, taskId);
  }

  async sendMessage(
    taskId: string,
    message: string
  ): Promise<Result<SendMessageResult, SendMessageError>> {
    return await sendMessageOp(this.context, this.attemptLifecycle, taskId, message);
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

    this.logForwarder.registerTask(task.taskId, task.webhookSecret, task.webhookUrl);
    this.runningCountBox.value++;
    // `ok: true` here means startup recovery took ownership of the accepted resume.
    // Worker startup may still fail, in which case resumeTaskWithUserMessage finalizes the task.
    this.logger.info({ taskId: task.taskId }, 'Recovering pending accepted resume after restart');
    await this.attemptLifecycle.resumeTaskWithUserMessage(task);

    return { ok: true, value: undefined };
  }

  getRunningCount(): number {
    return this.runningCountBox.value;
  }

  /**
   * INT-1551 §E.7: snapshot of currently-tracked fire-and-forget handler
   * promises. The shutdown path in `main.ts` awaits these via
   * `Promise.race([Promise.allSettled(...), timeout])` so graceful shutdown
   * actually drains in-flight work instead of polling `getRunningCount()`.
   */
  getInFlightPromises(): Promise<unknown>[] {
    return Array.from(this.inFlightHandlers);
  }

  /**
   * INT-1551 §E.7: thread the top-level AbortController signal down to
   * `TaskRunner` and `TaskTimers`. Wired from `main.ts` after construction so
   * the dispatcher does not need an extra constructor parameter (preserves the
   * public construction API). Calling with a fresh signal replaces any prior
   * one — current tests construct dispatchers without a signal and the
   * production caller invokes this exactly once.
   */
  setShutdownSignal(signal: AbortSignal): void {
    this.context.shutdownSignal = signal;
  }

  getCapacity(): number {
    return this.config.capacity;
  }

  getRunningTaskIds(): string[] {
    return Array.from(this.activeTasks.keys())
      .filter((key) => key.endsWith('-monitor'))
      .map((key) => key.replace('-monitor', ''));
  }

  private async saveTask(task: Task): Promise<void> {
    await this.statePersistence.modify((state) => {
      state.tasks[task.taskId] = task;
    });
  }

  /**
   * @internal Test-spy delegators preserved on the class so existing tests
   * that cast via `dispatcher as unknown as { method }` continue to work
   * after the implementation moved into sub-modules.
   */
  async resumeTaskWithUserMessage(task: Task): Promise<void> {
    await this.attemptLifecycle.resumeTaskWithUserMessage(task);
  }

  /** @internal Test-spy delegator. */
  async finalizeTask(
    task: Task,
    statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
    keepLogForwarderOpen = false
  ): Promise<void> {
    await this.completionPipeline.finalizeTask(task, statusParam, payload, keepLogForwarderOpen);
  }

  /** @internal Test-spy delegator. */
  clearTaskTimers(taskId: string): void {
    this.taskTimers.clearTaskTimers(taskId);
  }

  /** @internal Test-spy delegator. */
  appendOrchestratorTaskLog(taskId: string, message: string): void {
    appendOrchestratorTaskLogFn(this.logForwarder, taskId, message);
  }

  /** @internal Test-spy delegator. */
  appendTaggedTaskLog(taskId: string, tag: string, message: string): void {
    appendTaggedTaskLogFn(this.logForwarder, taskId, tag, message);
  }

  /** @internal Test-spy delegator. */
  async flushTaskLogs(taskId: string): Promise<void> {
    await flushTaskLogsFn(this.logForwarder, this.logger, taskId);
  }

  /** @internal Test-spy delegator. */
  buildResumePreamble(task?: Task): string {
    return buildResumePreambleFn(task);
  }

  /** @internal Test-spy delegator. */
  async startWorkerAttempt(
    task: Task,
    params: {
      prompt: string;
      continueSession: boolean;
      injectActiveGoal?: boolean;
    }
  ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> {
    return await this.taskRunner.startWorkerAttempt(task, params);
  }

  /** @internal Test-spy delegator (vi.spyOn target). */
  async checkForResult(task: Task): Promise<TaskResult | undefined> {
    return await checkForResultFn(this.logger, task);
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
    return this.completionPipeline.buildResultFromVerification(
      task,
      gitResult,
      verification,
      agentType
    );
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

  async executeComplianceValidation(task: Task, input: ComplianceValidationInput): Promise<void> {
    await this.completionPipeline.executeComplianceValidation(task, input);
  }

  async flushAndCloseLogForwarder(taskId: string): Promise<void> {
    await this.completionPipeline.flushAndCloseLogForwarder(taskId);
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
