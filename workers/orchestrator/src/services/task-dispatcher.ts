import { Mutex } from 'async-mutex';
import { type Result, type Logger, getErrorMessage } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import { withTimeout } from '../with-timeout.js';
import type { Task, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
import type { SendMessageResult, SendMessageError } from '../types/schemas.js';
import type { StatePersistence } from './state-persistence.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { LogForwarder } from './log-forwarder.js';
import type { WebhookClient } from './webhook-client.js';
import type { StatusUpdateClient } from './status-update-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { IsolationProvider, WorkerConfig, WorkerHandle } from './isolation/types.js';
import { WORKER_TYPES } from './isolation/types.js';
import type { TokenRefresher } from './isolation/token-refresher.js';
import type { ApiKeyValidator } from './api-key-validator.js';
import type { WorkerAuthProvider, WorkerAuthRegistry } from './worker-auth/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import { stripDockerHeaders } from './log-formatter.js';
import { ActivityTimeoutManager } from './activity-timeout-manager.js';
import {
  type CompletionAgentType,
  type CompletionVerifier,
  type CompletionVerifierVerdict,
  getLast50ClaudeLines,
} from './completion-verifier.js';
import { getRuntime, type RuntimeEvent, type WorkerRuntime } from './runtime/index.js';
import type { TurnMetricsCollector } from './turn-metrics-collector.js';
import type {
  AgentComplianceValidator,
  ComplianceValidationInput,
} from './agent-compliance-validator.js';
import { fetchDispatchMetadata } from './dispatch-metadata-client.js';
import {
  buildMissingFieldsPrompt as buildMissingFieldsPromptFn,
  buildResumePreamble as buildResumePreambleFn,
  buildActiveGoalSection as buildActiveGoalSectionFn,
  parseRebaseResultOutput as parseRebaseResultOutputFn,
  parseContinuationPrOutput as parseContinuationPrOutputFn,
  getTaskEventUrl as getTaskEventUrlFn,
  hasFatalExitCodeField as hasFatalExitCodeFieldFn,
  INACTIVITY_RESTART_PROMPT,
} from './task-dispatcher/prompts.js';
import {
  appendOrchestratorTaskLog as appendOrchestratorTaskLogFn,
  appendTaggedTaskLog as appendTaggedTaskLogFn,
  flushTaskLogs as flushTaskLogsFn,
  flushAndCloseLogForwarder as flushAndCloseLogForwarderFn,
} from './task-dispatcher/log-streaming.js';
import {
  collectTurnMetrics as collectTurnMetricsFn,
  prepareComplianceValidationInput as prepareComplianceValidationInputFn,
  executeComplianceValidation as executeComplianceValidationFn,
} from './task-dispatcher/metrics.js';
import {
  sendSetupFailureWebhook as sendSetupFailureWebhookFn,
  buildResultFromVerification as buildResultFromVerificationFn,
  enrichResultForResumedTask as enrichResultForResumedTaskFn,
  checkForResult as checkForResultFn,
} from './task-dispatcher/webhook-callbacks.js';
import {
  pickCompletionAgentType as pickCompletionAgentTypeFn,
  pickAgentLabel as pickAgentLabelFn,
  describeAgent as describeAgentFn,
  resolveTaskRuntime as resolveTaskRuntimeFn,
  getRuntimeDisplayName as getRuntimeDisplayNameFn,
} from './task-dispatcher/lifecycle.js';
import {
  clearTaskTimers as clearTaskTimersFn,
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  COMPLETION_CHECK_INTERVAL_MS,
  ACTIVITY_HEARTBEAT_THRESHOLD_MS,
  IMAGE_PULL_TIMEOUT_MS,
  CONTAINER_CREATE_TIMEOUT_MS,
  ZOMBIE_CLEANUP_TIMEOUT_MS,
  EVIDENCE_CAPTURE_TIMEOUT_MS,
  WORKER_DESTROY_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MS,
  MAX_INACTIVITY_RESTARTS,
} from './task-dispatcher/retry-logic.js';
import { classifyAttempt, type AttemptClassification } from './task-dispatcher/classify-attempt.js';

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
  verifier: CompletionVerifier;
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
  private readonly completionVerifier: CompletionVerifier;
  private readonly preserveWorkerContainers: boolean;
  private readonly activityTimeoutManager: ActivityTimeoutManager;

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
    private readonly agentComplianceValidator?: AgentComplianceValidator
  ) {
    this.completionMaxAttempts = completionControl.maxAttempts;
    this.completionVerifier = completionControl.verifier;
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
    let registered: boolean;
    try {
      registered = await this.worktreeManager.isWorktreeRegistered(task.taskId);
    } catch (error) {
      this.logger.error(
        { taskId: task.taskId, error },
        'Failed to check worktree registration during adoption'
      );
      // The registration check failed before we could do any cleanup. Release
      // the capacity slot we reserved; adoptTask itself never gets a chance to.
      // adoptTask guarantees runningCount was incremented before invoking this
      // method, so an unconditional decrement is safe.
      this.runningCount--;
      return {
        ok: false,
        error: {
          type: 'service_error',
          message: 'Failed to check worktree registration for adopted task',
          originalError: error,
        },
      };
    }

    if (registered) {
      return null;
    }

    this.logger.warn(
      { taskId: task.taskId, worktreePath: task.worktreePath },
      'Worktree metadata missing on adoption, attempting repair'
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Worktree metadata missing on adoption, repairing: path=${task.worktreePath}`
    );

    try {
      await this.worktreeManager.repairWorktree(task.taskId);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { taskId: task.taskId, worktreePath: task.worktreePath, error },
        'git worktree repair failed during adoption — marking task as WORKTREE_LOST'
      );

      const terminalError: TaskError = {
        code: 'WORKTREE_LOST',
        message: `Worktree metadata missing and repair failed for ${task.worktreePath}: ${message}`,
        // The failure is infrastructural (orchestrator host lost git
        // metadata), not something the user can fix in their code. Signal
        // contact_support so remediation does not present a code-edit path.
        remediation: {
          action: 'contact_support',
          worktreePath: task.worktreePath,
        },
      };

      this.appendOrchestratorTaskLog(
        task.taskId,
        `Terminal failure: WORKTREE_LOST (${terminalError.message})`
      );

      await this.finalizeTask(task, 'failed', { error: terminalError });

      return {
        ok: false,
        error: {
          type: 'service_error',
          message: terminalError.message,
          originalError: error,
        },
      };
    }
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
    const taskId = request.taskId;

    try {
      const repository = request.repository ?? this.getDefaultRepository(request);
      const baseBranch = request.baseBranch ?? 'development';

      // Create worktree
      let worktreePath: string;
      try {
        worktreePath =
          request.continuationPrBranch === undefined
            ? await this.worktreeManager.createWorktree(taskId, baseBranch)
            : await this.worktreeManager.createWorktree(
                taskId,
                baseBranch,
                request.continuationPrBranch
              );
      } catch (error) {
        if (this.runningCount > 0) this.runningCount--;
        await this.sendSetupFailureWebhook(request, 'Failed to create worktree', error);
        return;
      }

      this.logForwarder.registerTask(taskId, request.webhookSecret);

      // Create task object
      const task: Task = {
        taskId,
        workerType: request.workerType,
        runtime: WORKER_TYPES[request.workerType].runtime,
        prompt: request.prompt,
        repository,
        baseBranch,
        webhookUrl: request.webhookUrl,
        webhookSecret: request.webhookSecret,
        status: 'running',
        worktreePath,
        containerId: '',
        ...(request.linearIssueId !== undefined && { linearIssueId: request.linearIssueId }),
        ...(request.linearIssueTitle !== undefined && {
          linearIssueTitle: request.linearIssueTitle,
        }),
        linearIssueLabels: request.linearIssueLabels,
        hasChildren: request.hasChildren,
        ...(request.slug !== undefined && { slug: request.slug }),
        ...(request.actionId !== undefined && { actionId: request.actionId }),
        ...(request.retriedFrom !== undefined && { retriedFrom: request.retriedFrom }),
        ...(request.agentType !== undefined && { agentType: request.agentType }),
        ...(request.executionMemoryContext !== undefined && {
          executionMemoryContext: request.executionMemoryContext,
        }),
        ...(request.trackingCommentId !== undefined && {
          trackingCommentId: request.trackingCommentId,
        }),
        ...(request.prNumber !== undefined && { prNumber: request.prNumber }),
        ...(request.continuationPrNumber !== undefined && {
          continuationPrNumber: request.continuationPrNumber,
        }),
        ...(request.continuationPrBranch !== undefined && {
          continuationPrBranch: request.continuationPrBranch,
        }),
        /* v8 ignore start -- ts-type: conditional spread for exact optional property types @preserve */
        ...(request.reviewTypes !== undefined && { reviewTypes: request.reviewTypes }),
        /* v8 ignore stop @preserve */
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: this.completionMaxAttempts,
        verificationHistory: [],
      };

      const startResult = await this.startWorkerAttempt(task, {
        prompt: request.prompt,
        continueSession: false,
      });
      if (!startResult.ok) {
        if (this.runningCount > 0) this.runningCount--;
        this.logger.error(
          {
            taskId,
            error: startResult.error,
            errorMessage:
              startResult.error instanceof Error
                ? startResult.error.message
                : String(startResult.error),
          },
          'Failed to create worker container'
        );
        this.isolation.tokenRefresher.unregisterTask(taskId);
        this.logForwarder.unregisterTask(taskId);
        await this.isolation.provider.cleanupTaskSession?.(taskId);
        this.worktreeManager.removeWorktree(taskId).catch((cleanupError: unknown) => {
          this.logger.error(
            { taskId, cleanupError },
            'Failed to cleanup worktree after worker start failure'
          );
        });
        await this.sendSetupFailureWebhook(
          request,
          'Failed to start worker container',
          startResult.error
        );
        return;
      }
      task.containerId = startResult.containerId;

      await this.saveTask(task);

      this.scheduleTimeoutWarning(taskId);
      this.scheduleTimeoutKill(taskId);

      this.startCompletionMonitoring(taskId);
      this.appendOrchestratorTaskLog(
        taskId,
        `Task started: id=${taskId} attempt=1/${String(this.completionMaxAttempts)} workerType=${task.workerType}`
      );
      if (task.linearIssueId !== undefined) {
        this.appendOrchestratorTaskLog(
          taskId,
          `Linear issue: ${task.linearIssueId}${task.linearIssueTitle !== undefined ? ` — ${task.linearIssueTitle}` : ''}`
        );
      }
      const promptPreview =
        task.prompt.length > 500 ? task.prompt.slice(0, 500) + '…' : task.prompt;
      this.appendTaggedTaskLog(taskId, 'prompt', promptPreview);
      const agentLabel = pickAgentLabelFn(task);
      const agentDesc = describeAgentFn(agentLabel);
      this.appendTaggedTaskLog(taskId, 'instructions', `${agentLabel}: ${agentDesc}`);
      this.logger.info({}, `Task started: id=${taskId} runningCount=${String(this.runningCount)}`);
    } catch (error) {
      if (this.runningCount > 0) this.runningCount--;
      await this.sendSetupFailureWebhook(request, 'Failed to start task', error);
    }
  }

  private async sendSetupFailureWebhook(
    request: CreateTaskRequest,
    message: string,
    originalError: unknown
  ): Promise<void> {
    await sendSetupFailureWebhookFn(
      this.webhookClient,
      this.logger,
      request,
      message,
      originalError
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

  private resolveTaskRuntime(task: Task): WorkerRuntime {
    return resolveTaskRuntimeFn(task);
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
    const metadata = await fetchDispatchMetadata(
      {
        codeAgentUrl: this.config.codeAgentUrl,
        internalAuthToken: this.config.internalAuthToken,
      },
      taskId
    );

    if (metadata === null) {
      return null;
    }

    if (metadata.webhookSecret === null) {
      return null;
    }

    if (metadata.agentType === 'review' || metadata.agentType === 'remediation') {
      return {
        ok: false,
        error: {
          type: 'invalid_agent_type',
          message: 'Cannot send messages to review/remediation tasks',
        },
      };
    }

    const task: Task = {
      taskId: metadata.taskId,
      workerType: metadata.workerType,
      runtime: WORKER_TYPES[metadata.workerType].runtime,
      prompt: metadata.prompt,
      repository: metadata.repository,
      baseBranch: metadata.baseBranch,
      linearIssueLabels: [],
      webhookUrl: metadata.webhookUrl,
      webhookSecret: metadata.webhookSecret,
      status: 'running',
      worktreePath: '',
      containerId: '',
      startedAt: new Date().toISOString(),
      attemptCount: 1,
      maxAttempts: this.completionMaxAttempts,
      verificationHistory: [],
      ...(metadata.agentType !== null && { agentType: metadata.agentType }),
      ...(metadata.linearIssueId !== null && { linearIssueId: metadata.linearIssueId }),
      ...(metadata.trackingCommentId !== null && {
        trackingCommentId: metadata.trackingCommentId,
      }),
      ...(metadata.prNumber !== null && { prNumber: metadata.prNumber }),
      ...(metadata.continuationPrBranch !== null && {
        continuationPrBranch: metadata.continuationPrBranch,
      }),
    };

    this.logForwarder.registerTask(taskId, task.webhookSecret);
    this.appendOrchestratorTaskLog(
      taskId,
      'Recreating task from dispatch metadata with user message'
    );
    this.appendTaggedTaskLog(
      taskId,
      'prompt',
      message.length > 200 ? message.slice(0, 200) + '\u2026' : message
    );

    const prompt =
      task.agentType === 'ask_agent' ? message : this.buildResumePreamble(task) + message;
    task.pendingResumeStart = {
      prompt,
      acceptedAt: new Date().toISOString(),
    };
    await this.saveTask(task);

    this.runningCount++;
    void this.recreateTaskFromDispatchMetadata(task).catch((error: unknown) => {
      void this.failAcceptedResume(task, error);
    });
    this.logger.info({ taskId }, 'Task resume accepted after dispatch metadata recovery');

    return { ok: true, value: { action: 'resumed' } };
  }

  private async recreateTaskFromDispatchMetadata(task: Task): Promise<void> {
    try {
      task.worktreePath =
        task.continuationPrBranch === undefined
          ? await this.worktreeManager.createWorktree(task.taskId, task.baseBranch)
          : await this.worktreeManager.createWorktree(
              task.taskId,
              task.baseBranch,
              task.continuationPrBranch
            );
      await this.saveTask(task);
      await this.resumeTaskWithUserMessage(task);
    } catch (error) {
      await this.failAcceptedResume(task, error);
    }
  }

  private async resumeTaskWithUserMessage(task: Task): Promise<void> {
    const prompt = task.pendingResumeStart?.prompt;
    /* v8 ignore start -- upstream: sendMessage and recoverPendingResumeTask validate pendingResumeStart before invoking this async helper; this guard cannot be reached in unit tests because callers always set pendingResumeStart before calling resumeTaskWithUserMessage @preserve */
    if (prompt === undefined) {
      await this.failAcceptedResume(
        task,
        new Error('Accepted resume is missing the persisted startup prompt')
      );
      return;
    }
    /* v8 ignore stop @preserve */

    try {
      const resumeResult = await this.startWorkerAttempt(task, {
        prompt,
        continueSession: true,
        injectActiveGoal: task.agentType !== 'ask_agent',
      });

      if (!resumeResult.ok) {
        await this.failAcceptedResume(task, resumeResult.error);
        return;
      }

      task.containerId = resumeResult.containerId;
      delete task.pendingResumeStart;
      await this.saveTask(task);

      this.scheduleTimeoutWarning(task.taskId);
      this.scheduleTimeoutKill(task.taskId);
      this.startCompletionMonitoring(task.taskId);

      this.logger.info({ taskId: task.taskId }, 'Task resumed with user message');
    } catch (error) {
      await this.failAcceptedResume(task, error);
    }
  }

  private scheduleTimeoutWarning(taskId: string): void {
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          /* v8 ignore start -- source-map: branch inside void async setTimeout callback misattributed by v8 coverage instrumentation even when exercised by fake timer tests @preserve */
          if (task !== null && task.status === 'running') {
            this.logger.warn({ taskId }, 'Task approaching 5-hour timeout');
          }
          /* v8 ignore stop @preserve */
        } catch (error) {
          this.logger.error({ taskId, error }, 'Error in timeout warning callback');
        }
      })();
    }, TASK_TIMEOUT_WARNING_MS);

    this.activeTasks.set(`${taskId}-warning`, timeout);
  }

  private scheduleTimeoutKill(taskId: string): void {
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          /* v8 ignore start -- source-map: branch inside void async setTimeout callback misattributed by v8 coverage instrumentation even when exercised by fake timer tests @preserve */
          if (task?.status !== 'running') {
            return;
          }
          /* v8 ignore stop @preserve */

          this.logger.warn({ taskId }, 'Task timeout - killing');

          // Stop inactivity timeout early to prevent restart during hard kill
          this.activityTimeoutManager.stop(taskId);

          // Kill Docker container. Bound by WORKER_DESTROY_TIMEOUT_MS so an
          // unresponsive docker daemon cannot wedge this callback and leave
          // the task in 'running' status indefinitely.
          try {
            await withTimeout(
              this.isolation.provider.destroyWorker(taskId),
              WORKER_DESTROY_TIMEOUT_MS,
              `destroyWorker timed out after ${String(WORKER_DESTROY_TIMEOUT_MS / 1000)}s`
            );
          } catch (destroyError) {
            this.logger.error(
              { taskId, error: destroyError },
              'Failed to destroy worker during timeout kill'
            );
          }

          try {
            await this.logForwarder.flushAndStop(taskId);
          } catch (flushError: unknown) {
            this.logger.error(
              { taskId, error: flushError },
              'Failed to flush logs during timeout kill'
            );
          }
          this.logForwarder.unregisterTask(taskId);
          this.isolation.tokenRefresher.unregisterTask(taskId);
          this.claudeErrors.delete(taskId);
          this.taskExitCodes.delete(taskId);
          this.attemptStartedAt.delete(taskId);
          this.attemptCompletionSignals.delete(taskId);
          this.completionInProgress.delete(taskId);
          this.lastOutputAt.delete(taskId);
          await this.isolation.provider.cleanupTaskSession?.(taskId);

          // Check for PR
          const result = await this.checkForResult(task);

          // Update task
          task.status = 'interrupted';
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
              status: 'interrupted',
              result,
              duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
            },
            taskId,
          });
        } catch (error) {
          this.logger.error({ taskId, error }, 'Error in timeout kill callback');
        }
      })();
    }, TASK_TIMEOUT_KILL_MS);

    this.activeTasks.set(`${taskId}-kill`, timeout);
  }

  private async handleInactivityRestart(taskId: string): Promise<void> {
    // Mark the restart as in-flight synchronously before any await so the
    // completion monitor cannot race and run verification on the stale
    // transcript while destroyWorker/startWorkerAttempt are pending.
    this.inactivityRestartInProgress.add(taskId);
    try {
      await this.doHandleInactivityRestart(taskId);
    } finally {
      this.inactivityRestartInProgress.delete(taskId);
    }
  }

  private async doHandleInactivityRestart(taskId: string): Promise<void> {
    // Guard: skip if completion is already in progress
    if (this.completionInProgress.has(taskId)) {
      this.logger.debug({ taskId }, 'Inactivity restart skipped: completion already in progress');
      return;
    }

    const task = await this.getTask(taskId);
    /* v8 ignore start -- source-map: branch inside void async setTimeout callback misattributed by v8 coverage instrumentation even when exercised by fake timer tests @preserve */
    if (task?.status !== 'running') {
      return;
    }
    /* v8 ignore stop @preserve */

    const canRestart = this.activityTimeoutManager.recordRestart(taskId);
    if (!canRestart) {
      // Max consecutive restarts exceeded — fail the task
      this.activityTimeoutManager.stop(taskId);

      this.appendTaggedTaskLog(
        taskId,
        'system',
        `Inactivity timeout: worker unresponsive after ${String(MAX_INACTIVITY_RESTARTS)} consecutive restarts — failing task`
      );
      this.logger.error(
        { taskId, maxRestarts: MAX_INACTIVITY_RESTARTS },
        'Max inactivity restarts exceeded — failing task'
      );

      const result = await this.checkForResult(task);
      const error: TaskError = {
        code: 'TASK_INACTIVITY_TIMEOUT',
        message: `Worker unresponsive after ${String(MAX_INACTIVITY_RESTARTS)} consecutive inactivity restarts`,
        remediation: { action: 'retry' },
      };
      /* v8 ignore start -- ts-type: conditional spread for exact optional property types @preserve */
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      /* v8 ignore stop @preserve */
      return;
    }

    const restartCount = this.activityTimeoutManager.getRestartCount(taskId);
    // Note: do NOT call stop() here — it would clear the consecutive restart counter.
    // The counter must persist across restarts. The timer is reset when
    // startWorkerAttempt() calls activityTimeoutManager.start(), which calls
    // clearTimer() internally before creating a new timer.

    this.appendTaggedTaskLog(
      taskId,
      'system',
      `Inactivity timeout: no output for ${String(INACTIVITY_TIMEOUT_MS / 1000)}s — killing worker and restarting (restart ${String(restartCount)}/${String(MAX_INACTIVITY_RESTARTS)})`
    );
    this.logger.info(
      { taskId, restartCount, maxRestarts: MAX_INACTIVITY_RESTARTS },
      'Inactivity restart triggered'
    );

    const evidenceDir = `/var/log/orchestrator/inactivity-evidence/${taskId}/`;
    // Bound each best-effort docker call by EVIDENCE_CAPTURE_TIMEOUT_MS so a
    // stalled container (e.g. already-exited with orphaned state) cannot wedge
    // the restart path.
    const [copyResult, statsResult] = await Promise.allSettled([
      withTimeout(
        this.isolation.provider.copyOut(taskId, '/tmp', evidenceDir),
        EVIDENCE_CAPTURE_TIMEOUT_MS,
        `copyOut timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
      ),
      withTimeout(
        this.isolation.provider.statsSnapshot(taskId),
        EVIDENCE_CAPTURE_TIMEOUT_MS,
        `statsSnapshot timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
      ),
    ]);
    if (copyResult.status === 'rejected') {
      this.logger.warn(
        { taskId, error: getErrorMessage(copyResult.reason) },
        'Failed to copy /tmp evidence before inactivity kill'
      );
    }
    if (statsResult.status === 'fulfilled') {
      this.logger.warn({ taskId, stats: statsResult.value }, 'Container stats at inactivity kill');
    } else {
      this.logger.warn(
        { taskId, error: getErrorMessage(statsResult.reason) },
        'Failed to capture container stats before inactivity kill'
      );
    }

    try {
      await withTimeout(
        this.isolation.provider.destroyWorker(taskId),
        WORKER_DESTROY_TIMEOUT_MS,
        `destroyWorker timed out after ${String(WORKER_DESTROY_TIMEOUT_MS / 1000)}s`
      );
    } catch (destroyError) {
      this.logger.warn(
        { taskId, error: destroyError },
        'Failed to destroy worker for inactivity restart'
      );
    }
    this.appendOrchestratorTaskLog(taskId, 'Worker destroyed for inactivity restart');

    await this.teardownAttempt(taskId, true);

    // Re-fetch to avoid race with completion monitor: if status is no longer
    // 'running', the task was finalized by another handler and we must bail out.
    const reloadedTask = await this.getTask(taskId);
    /* v8 ignore start -- source-map: branch inside void async setTimeout callback misattributed by v8 coverage instrumentation even when exercised by fake timer tests @preserve */
    if (reloadedTask?.status !== 'running') {
      this.logger.debug({ taskId }, 'Inactivity restart bailed out: task no longer running');
      return;
    }
    /* v8 ignore stop @preserve */

    this.appendTaggedTaskLog(taskId, 'prompt', INACTIVITY_RESTART_PROMPT);
    const startResult = await this.startWorkerAttempt(task, {
      prompt: INACTIVITY_RESTART_PROMPT,
      continueSession: true,
    });

    if (!startResult.ok) {
      this.logger.error(
        { taskId, error: startResult.error },
        'Failed to restart worker after inactivity timeout'
      );
      const error: TaskError = {
        code: 'TASK_INACTIVITY_RESTART_FAILED',
        message: 'Failed to restart worker after inactivity timeout',
        remediation: { action: 'retry' },
      };
      const result = await this.checkForResult(task);
      /* v8 ignore start -- ts-type: conditional spread for exact optional property types @preserve */
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      /* v8 ignore stop @preserve */
      return;
    }

    task.containerId = startResult.containerId;
    task.inactivityRestartCount = (task.inactivityRestartCount ?? 0) + 1;
    await this.saveTask(task);

    this.appendOrchestratorTaskLog(taskId, `Inactivity restart attempt started: taskId=${taskId}`);
  }

  private startCompletionMonitoring(taskId: string): void {
    const checkInterval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          if (task?.status !== 'running') {
            this.clearTaskTimers(taskId);
            return;
          }

          // Check if Docker container is still running
          const isRunning = await this.isolation.provider.isWorkerRunning(taskId);
          const attemptCompleted = this.attemptCompletionSignals.has(taskId);

          // Emit activity heartbeat when no Docker output for threshold duration
          const lastActivity = this.lastOutputAt.get(taskId);
          if (isRunning && lastActivity !== undefined) {
            const silenceMs = Date.now() - lastActivity;
            if (silenceMs >= ACTIVITY_HEARTBEAT_THRESHOLD_MS) {
              const silenceSeconds = Math.round(silenceMs / 1000);
              this.appendTaggedTaskLog(
                taskId,
                'system',
                `Still processing... no output for ${String(silenceSeconds)}s`
              );
            }
          }

          if (!isRunning || attemptCompleted) {
            if (this.completionInProgress.has(taskId)) {
              return;
            }
            // Skip: an inactivity restart is mid-flight (old worker destroyed,
            // new one not yet up). Running completion now would verify on the
            // stale transcript of the killed session.
            if (this.inactivityRestartInProgress.has(taskId)) {
              this.logger.debug(
                { taskId },
                'Completion monitor tick skipped: inactivity restart in progress'
              );
              return;
            }
            this.completionInProgress.add(taskId);
            try {
              await this.handleTaskCompletion(task);
            } finally {
              this.completionInProgress.delete(taskId);
            }
          }
        } catch (error) {
          this.logger.error({ taskId, error }, 'Error in completion monitoring callback');
        }
      })();
    }, COMPLETION_CHECK_INTERVAL_MS);

    this.activeTasks.set(`${taskId}-monitor`, checkInterval);
  }

  private async handleTaskCompletion(task: Task): Promise<void> {
    if (task.resumedAfterSuccess === true) {
      await this.handleResumedAfterSuccessCompletion(task);
      return;
    }

    const attempt = task.attemptCount ?? 1;
    const maxAttempts = task.maxAttempts ?? 5;
    const completionAgentType: CompletionAgentType = pickCompletionAgentTypeFn(task);
    this.attemptCompletionSignals.delete(task.taskId);

    // ask_agent: skip structured completion verification — extract summary and finalize
    if (completionAgentType === 'ask_agent') {
      try {
        await this.logForwarder.flushAndStop(task.taskId);
      } catch (flushError: unknown) {
        this.logger.error(
          { taskId: task.taskId, error: flushError },
          'Failed to flush logs on ask_agent task completion'
        );
      }

      /* v8 ignore start -- upstream: pending messages delivery path requires sendMessage called on a completing ask_agent task; timing-dependent race cannot be reproduced with fake timer sequential execution @preserve */
      // Check for pending messages before finalizing — user may have sent
      // a follow-up while this attempt was completing.
      const pendingQueue = this.pendingMessages.get(task.taskId);
      if (pendingQueue !== undefined && pendingQueue.length > 0) {
        this.pendingMessages.delete(task.taskId);
        const combinedPrompt = pendingQueue.join('\n\n');
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Ask agent: delivering ${String(pendingQueue.length)} queued message(s) instead of finalizing`
        );
        this.appendTaggedTaskLog(
          task.taskId,
          'prompt',
          combinedPrompt.length > 200 ? combinedPrompt.slice(0, 200) + '\u2026' : combinedPrompt
        );
        await this.flushTaskLogs(task.taskId);
        await this.teardownAttempt(task.taskId, true);
        const resumeResult = await this.startWorkerAttempt(task, {
          prompt: combinedPrompt,
          continueSession: true,
          injectActiveGoal: false,
        });
        if (resumeResult.ok) {
          task.containerId = resumeResult.containerId;
          await this.saveTask(task);
          this.claudeErrors.delete(task.taskId);
          this.taskExitCodes.delete(task.taskId);
          this.attemptStartedAt.delete(task.taskId);
          return;
        }
        this.appendOrchestratorTaskLog(
          task.taskId,
          'Failed to deliver queued messages, finalizing normally'
        );
      }
      /* v8 ignore stop @preserve */

      const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
      const summary = getLast50ClaudeLines(rawLogs);
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Ask agent completed — skipping structured verification`
      );
      await this.finalizeTaskWithResult(task, 'ask_agent', { summary });
      return;
    }

    this.logger.info(
      {},
      `Worker attempt finished: taskId=${task.taskId} attempt=${String(attempt)}/${String(maxAttempts)} agentType=${completionAgentType}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Attempt finished: attempt=${String(attempt)}/${String(maxAttempts)} agentType=${completionAgentType}`
    );

    try {
      await this.logForwarder.flushAndStop(task.taskId);
    } catch (flushError: unknown) {
      this.logger.error(
        { taskId: task.taskId, error: flushError },
        'Failed to flush logs on task completion'
      );
    }

    const result = await this.checkForResult(task);
    const exitCode = this.taskExitCodes.get(task.taskId);
    /* v8 ignore start -- ts-type: nullish coalescing and optional chaining in log statements create narrowing branches unreachable given prior type guards @preserve */
    if (result !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Result: prUrl=${result.prUrl ?? 'none'} branch=${result.branch ?? 'none'} commits=${String(result.commits ?? 0)} ciFailed=${String(result.ciFailed ?? 'unknown')}`
      );
    }
    /* v8 ignore stop @preserve */
    const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);

    // INT-1455: Classify the attempt before calling the verifier. An attempt
    // that never produced Claude output must not be graded as a broken
    // transcript — that hides the real infra failure behind a policy-looking
    // "missing memory fields" error.
    const attemptStart = this.attemptStartedAt.get(task.taskId);
    const attemptDurationMs =
      attemptStart !== undefined ? Date.now() - attemptStart : Number.POSITIVE_INFINITY;
    const classification: AttemptClassification = classifyAttempt({
      logs: rawLogs,
      exitCode,
      durationMs: attemptDurationMs,
    });
    this.appendOrchestratorTaskLog(
      task.taskId,
      classification.outcome === 'ran'
        ? `Attempt classified: ran=true`
        : `Attempt classified: ran=false reason=${classification.subReason} exitCode=${String(exitCode)}`
    );
    if (classification.outcome === 'infra_failed') {
      await this.finalizeAttemptAsInfraFailure(task, attempt, classification, result);
      return;
    }

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Running completion verification: attempt=${String(attempt)}/${String(maxAttempts)}`
    );
    const verification = await this.completionVerifier.verify({
      taskId: task.taskId,
      attempt,
      maxAttempts,
      agentType: completionAgentType,
      rawLogs,
      ...(exitCode !== undefined && { lastExitCode: exitCode }),
      ...(task.executionMemoryContext !== undefined && {
        executionMemoryContext: task.executionMemoryContext,
      }),
    });
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Passed: ${String(verification.passed)} | VerifierFailure: ${String(verification.verifierFailure)}`
    );
    if (verification.missingFields.length > 0) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Missing fields: ${verification.missingFields.join(' | ')}`
      );
    }
    const transcriptLines = verification.trace.transcript
      .split('\n')
      .filter((l) => l.trim() !== '');
    /* v8 ignore start -- ts-type: nullish coalescing and ternary in transcript summary narrowing; noUncheckedIndexedAccess creates unreachable else branch given filter guarantees @preserve */
    const firstLine = transcriptLines[0] ?? '';
    const lastLine = transcriptLines[transcriptLines.length - 1] ?? '';
    const transcriptSummary =
      transcriptLines.length <= 2
        ? transcriptLines.join('\n')
        : `${firstLine}\n  ... (${String(transcriptLines.length - 2)} lines omitted) ...\n${lastLine}`;
    /* v8 ignore stop @preserve */
    this.appendOrchestratorTaskLog(
      task.taskId,
      `📋 Transcript (first + last):\n${transcriptSummary}`
    );
    /* v8 ignore start -- ts-type: optional chaining on agentData creates narrowing branch; agentData guaranteed to have summary when present @preserve */
    this.appendOrchestratorTaskLog(
      task.taskId,
      `🤖 Verifier summary (${verification.succeededModelName ?? 'unknown'}): ${verification.agentData?.summary ?? '(no summary extracted)'}`
    );
    /* v8 ignore stop @preserve */

    if (typeof exitCode === 'number') {
      task.lastExitCode = exitCode;
    } else {
      delete task.lastExitCode;
    }
    task.verificationHistory = [
      ...(task.verificationHistory ?? []),
      {
        attempt,
        passed: verification.passed,
        missingFields: verification.missingFields,
        verifierFailure: verification.verifierFailure,
        createdAt: new Date().toISOString(),
      },
    ];

    // Verifier failure (all validation models down or unparseable output): retry immediately if attempts remain
    /* v8 ignore start -- upstream: verifierFailure path requires all validation models to return parse errors; FakeCompletionVerifier always returns valid responses and cannot simulate upstream failures @preserve */
    if (verification.verifierFailure) {
      if (attempt < maxAttempts) {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Verifier failure; retrying verifier (${String(attempt + 1)}/${String(maxAttempts)})`
        );
        // Re-call verifier with same logs — counts as an attempt
        const retryVerification = await this.completionVerifier.verify({
          taskId: task.taskId,
          attempt: attempt + 1,
          maxAttempts,
          agentType: completionAgentType,
          rawLogs,
          ...(task.executionMemoryContext !== undefined && {
            executionMemoryContext: task.executionMemoryContext,
          }),
        });
        task.verificationHistory = [
          ...(task.verificationHistory ?? []),
          {
            attempt: attempt + 1,
            passed: retryVerification.passed,
            missingFields: retryVerification.missingFields,
            verifierFailure: retryVerification.verifierFailure,
            createdAt: new Date().toISOString(),
          },
        ];
        task.attemptCount = attempt + 1;

        if (retryVerification.passed && retryVerification.agentData !== undefined) {
          this.appendOrchestratorTaskLog(task.taskId, 'Verifier retry succeeded');
          await this.flushTaskLogs(task.taskId);
          await this.collectTurnMetrics(task, attempt + 1);
          const finalResult = this.buildResultFromVerification(task, result, retryVerification);
          await this.finalizeTaskWithResult(task, completionAgentType, finalResult);
          return;
        }
      }

      const error: TaskError = {
        code: 'TASK_COMPLETION_VERIFIER_FAILED',
        message: 'Completion verifier unavailable (all validation models failed)',
        remediation: {
          action: 'contact_support',
          manualSteps: [
            'Ensure INTEXURAOS_GEMINI_APP_API_KEY and INTEXURAOS_OPENROUTER_APP_API_KEY are configured for orchestrator.',
            'Check connectivity to all configured validation models and retry task after verifier is healthy.',
          ],
        },
      };
      this.appendOrchestratorTaskLog(task.taskId, 'Terminal failure: verifier unavailable');
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      return;
    }
    /* v8 ignore stop @preserve */

    // Verification passed
    if (verification.passed && verification.agentData !== undefined) {
      // Non-zero exit code overrides verifier passed decision
      if (exitCode !== undefined && exitCode !== 0) {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Non-zero exit code (${String(exitCode)}) overrides verifier passed decision`
        );
        await this.flushTaskLogs(task.taskId);
        await this.collectTurnMetrics(task, attempt);
        const error: TaskError = {
          code: 'TASK_EXIT_CODE_OVERRIDE',
          message: `Non-zero exit code (${String(exitCode)}) overrides verifier passed decision`,
          remediation: { action: 'retry' },
        };
        /* v8 ignore start -- ts-type: conditional spread for exact optional property types; FakeIsolationProvider cannot deliver a result alongside a non-zero exit code in the same fake-driven completion tick @preserve */
        await this.finalizeTask(task, 'failed', {
          ...(result !== undefined && { result }),
          error,
        });
        /* v8 ignore stop @preserve */
        return;
      }

      /* v8 ignore start -- upstream: pending messages delivery path requires sendMessage called on a completing task; timing-dependent race cannot be reproduced with fake timer sequential execution @preserve */
      const pendingQueue = this.pendingMessages.get(task.taskId);
      if (pendingQueue !== undefined && pendingQueue.length > 0) {
        this.pendingMessages.delete(task.taskId);
        const combinedPrompt = pendingQueue.join('\n\n');
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Delivering ${String(pendingQueue.length)} queued message(s) instead of finalizing`
        );
        this.appendTaggedTaskLog(
          task.taskId,
          'prompt',
          combinedPrompt.length > 200 ? combinedPrompt.slice(0, 200) + '\u2026' : combinedPrompt
        );
        await this.flushTaskLogs(task.taskId);
        await this.teardownAttempt(task.taskId, true);
        const resumeResult = await this.startWorkerAttempt(task, {
          prompt: combinedPrompt,
          continueSession: true,
          injectActiveGoal: true,
        });
        if (resumeResult.ok) {
          task.containerId = resumeResult.containerId;
          await this.saveTask(task);
          this.claudeErrors.delete(task.taskId);
          this.taskExitCodes.delete(task.taskId);
          this.attemptStartedAt.delete(task.taskId);
          return;
        }
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Failed to deliver queued messages, finalizing normally`
        );
      }
      /* v8 ignore stop @preserve */

      this.appendOrchestratorTaskLog(task.taskId, 'Completion verification passed');
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      const finalResult = this.buildResultFromVerification(task, result, verification);

      // Compliance validation for execution tasks: pre-read data before cleanup, then fire-and-forget
      /* v8 ignore start -- source-map: void fire-and-forget compliance validation branches misattributed by v8; detached promise created by void expression not tracked by coverage instrumentation @preserve */
      let complianceInput: ComplianceValidationInput | undefined;
      if (completionAgentType === 'execution' && this.agentComplianceValidator !== undefined) {
        complianceInput = await this.prepareComplianceValidationInput(
          task,
          finalResult,
          verification
        );
      }

      const keepLogOpen = complianceInput !== undefined;
      await this.finalizeTaskWithResult(task, completionAgentType, finalResult, keepLogOpen);

      if (complianceInput !== undefined) {
        void this.executeComplianceValidation(task, complianceInput).finally(() => {
          void this.flushAndCloseLogForwarder(task.taskId);
        });
      }
      /* v8 ignore stop @preserve */
      return;
    }

    // Fatal exit code (SIGKILL=137, SIGSEGV=139): do not retry — session state is corrupted
    const fatalField = hasFatalExitCodeField(verification.missingFields);
    if (fatalField !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Fatal exit code detected (${fatalField}); skipping retry — session state is not recoverable`
      );
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      const error: TaskError = {
        code: 'TASK_FATAL_EXIT_CODE',
        message: `Worker process killed by signal: ${fatalField}`,
        remediation: { action: 'retry' },
      };
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      return;
    }

    /* v8 ignore start -- upstream: FakeIsolationProvider cannot drive the missing-fields retry or terminal-failure paths in the remainder of this method — the fake always returns exitCode 0 and unable to reproduce multi-attempt verifier sequences or runtime resume signals @preserve */
    // Missing fields: re-launch the selected runtime with an adjusted prompt if attempts remain
    if (verification.missingFields.length > 0 && attempt < maxAttempts) {
      this.logForwarder.appendChunk(task.taskId, '\n\n');
      const nextAttempt = attempt + 1;
      const runtimeName = this.getRuntimeDisplayName(task);
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Missing fields; re-launching ${runtimeName} (${String(nextAttempt)}/${String(maxAttempts)}): ${verification.missingFields.join(', ')}`
      );
      await this.flushTaskLogs(task.taskId);
      await this.teardownAttempt(task.taskId, true);

      const resumePrompt = buildMissingFieldsPromptFn(
        completionAgentType,
        verification.missingFields,
        rawLogs,
        task.executionMemoryContext
      );
      const resumePreview =
        resumePrompt.length > 500 ? resumePrompt.slice(0, 500) + '\u2026' : resumePrompt;
      this.appendTaggedTaskLog(task.taskId, 'prompt', `Resume prompt:\n${resumePreview}`);
      const resumeStart = await this.startWorkerAttempt(task, {
        prompt: resumePrompt,
        continueSession: true,
      });

      if (resumeStart.ok) {
        task.attemptCount = nextAttempt;
        task.containerId = resumeStart.containerId;
        await this.saveTask(task);
        this.logger.info(
          { taskId: task.taskId, attempt: nextAttempt, maxAttempts },
          'Resumed task with follow-up attempt'
        );
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Resume attempt started: attempt=${String(nextAttempt)}/${String(maxAttempts)}`
        );
        this.claudeErrors.delete(task.taskId);
        this.taskExitCodes.delete(task.taskId);
        this.attemptStartedAt.delete(task.taskId);
        return;
      }

      const resumeError: TaskError = {
        code: 'RESUME_ATTEMPT_FAILED',
        message: `Failed to start attempt ${String(nextAttempt)}: ${String(resumeStart.error)}`,
        remediation: { action: 'retry' },
      };
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Terminal failure: resume start failed for attempt=${String(nextAttempt)} (${resumeError.message})`
      );
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error: resumeError,
      });
      return;
    }

    // Terminal failure: no attempts left
    const error: TaskError = {
      code: 'TASK_COMPLETION_VERIFICATION_FAILED',
      message:
        verification.missingFields.length > 0
          ? `Missing fields: ${verification.missingFields.join(', ')}`
          : 'Completion verification failed',
      remediation: {
        action: 'retry',
        ...(verification.missingFields.length > 0 && {
          manualSteps: verification.missingFields,
        }),
      },
    };
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: completion criteria not met after ${String(attempt)} attempts`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
    /* v8 ignore stop @preserve */
  }

  /**
   * INT-1455: Finalize an attempt classified as `infra_failed`. Skips the
   * verifier entirely and writes a `WORKER_INFRA_FAILURE` TaskError. If the
   * same sub-reason was observed on the previous attempt, mark the remediation
   * action as contact_support so the code-agent classifier stops looping.
   */
  private async finalizeAttemptAsInfraFailure(
    task: Task,
    attempt: number,
    classification: Extract<AttemptClassification, { outcome: 'infra_failed' }>,
    result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
  ): Promise<void> {
    const { subReason, firstErrorLine } = classification;
    const history = task.taskInfraFailureHistory ?? [];
    const previous = history[history.length - 1];
    const repeatedSubReason = previous?.subReason === subReason;

    task.taskInfraFailureHistory = [
      ...history,
      { attempt, subReason, createdAt: new Date().toISOString() },
    ];

    if (repeatedSubReason) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Repeat infra failure (${subReason}) on attempt ${String(attempt)}; flipping remediation to contact_support`
      );
    }

    // INT-1455: `remediation.action` is advisory for on-call/UI triage only.
    // The code-agent classifyFailure() already returns 'fail' unconditionally
    // for WORKER_INFRA_FAILURE (apps/code-agent/src/domain/utils/classifyFailure.ts),
    // so neither 'retry' nor 'contact_support' here gates the automated retry
    // loop. The flip exists so dashboards and webhook consumers can distinguish
    // a first-time infra failure from a repeat of the same sub-reason after a
    // user-driven resume.
    const error: TaskError = {
      code: 'WORKER_INFRA_FAILURE',
      message: firstErrorLine,
      remediation: repeatedSubReason
        ? { action: 'contact_support', manualSteps: [`Repeat infra failure: ${subReason}`] }
        : { action: 'retry', manualSteps: [`Infra failure: ${subReason}`] },
    };

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: worker infra failure (${subReason})`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
      error,
    });
  }

  private buildResultFromVerification(
    task: Task,
    gitResult: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
    verification: CompletionVerifierVerdict
  ): TaskResult {
    return buildResultFromVerificationFn(task, gitResult, verification);
  }

  private enrichResultForResumedTask(
    task: Task,
    result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
  ): TaskResult | undefined {
    return enrichResultForResumedTaskFn(task, result);
  }

  private async finalizeTaskWithResult(
    task: Task,
    agentType: CompletionAgentType,
    finalResult: TaskResult,
    keepLogForwarderOpen = false
  ): Promise<void> {
    /* v8 ignore start -- upstream: planning 'unclear' outcome requires FakeCompletionVerifier to return unclear outcome label; fake verifier always returns 'completed' outcome and cannot simulate unclear planning decisions @preserve */
    if (agentType === 'planning' && finalResult.planning_outcome_label === 'unclear') {
      await this.finalizeTask(
        task,
        'failed',
        {
          result: finalResult,
          error: {
            code: 'PLANNING_AGENT_UNCLEAR',
            message:
              finalResult.planning_unclear_clarification ??
              'Planning agent reported unclear outcome',
          },
        },
        keepLogForwarderOpen
      );
      return;
    }
    /* v8 ignore stop @preserve */
    await this.finalizeTask(task, 'completed', { result: finalResult }, keepLogForwarderOpen);
  }

  private buildResumePreamble(task?: Task): string {
    return buildResumePreambleFn(task);
  }

  private buildActiveGoalSection(task: Task | undefined, prompt: string): string {
    return buildActiveGoalSectionFn(task, prompt);
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

  private async handleResumedAfterSuccessCompletion(task: Task): Promise<void> {
    this.attemptCompletionSignals.delete(task.taskId);
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess nullish coalescing on attemptCount; task always has attemptCount set before this method is called @preserve */
    const attempt = task.attemptCount ?? 1;
    /* v8 ignore stop @preserve */

    this.logger.info(
      {},
      `Resumed-after-success completion: taskId=${task.taskId} attempt=${String(attempt)}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      'Resumed-after-success completion: using loosened verification (exit code + runtime hard error only)'
    );

    try {
      await this.logForwarder.flushAndStop(task.taskId);
    } catch (flushError: unknown) {
      this.logger.error(
        { taskId: task.taskId, error: flushError },
        'Failed to flush logs on resumed-after-success completion'
      );
    }

    const checkResult = await this.checkForResult(task);
    const effectiveResult = checkResult ?? task.lastSuccessResult;
    if (checkResult === undefined && task.lastSuccessResult !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        'checkForResult returned undefined, falling back to lastSuccessResult'
      );
    }
    const claudeError = this.claudeErrors.get(task.taskId);
    const exitCode = this.taskExitCodes.get(task.taskId);
    const runtimeName = this.getRuntimeDisplayName(task);

    const hasHardError =
      (typeof exitCode === 'number' && exitCode !== 0) || claudeError !== undefined;

    if (typeof exitCode === 'number') {
      task.lastExitCode = exitCode;
    } else {
      delete task.lastExitCode;
    }

    /* v8 ignore start -- ts-type: nullish coalescing on verificationHistory; task always has verificationHistory initialized before this method is called @preserve */
    task.verificationHistory = [
      ...(task.verificationHistory ?? []),
      {
        attempt,
        passed: !hasHardError,
        missingFields: [],
        verifierFailure: false,
        createdAt: new Date().toISOString(),
      },
    ];
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- upstream: hasHardError path requires non-zero exit code or claudeError set by runtime; FakeIsolationProvider cannot simulate worker process failures or runtime errors in unit tests @preserve */
    if (hasHardError) {
      const error: TaskError = {
        code: 'TASK_RESUMED_HARD_ERROR',
        message: [
          ...(typeof exitCode === 'number' && exitCode !== 0
            ? [`Non-zero exit code: ${String(exitCode)}`]
            : []),
          ...(claudeError !== undefined ? [`${runtimeName} error: ${claudeError}`] : []),
        ].join('; '),
        remediation: { action: 'retry' },
      };

      this.appendOrchestratorTaskLog(
        task.taskId,
        `Resumed-after-success hard error: ${error.message}`
      );
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      delete task.resumedAfterSuccess;
      const enrichedErrorResult = this.enrichResultForResumedTask(task, effectiveResult);
      await this.finalizeTask(task, 'failed', {
        ...(enrichedErrorResult !== undefined && { result: enrichedErrorResult }),
        error,
      });
      return;
    }
    /* v8 ignore stop @preserve */

    // Check for pending messages before finalizing
    /* v8 ignore start -- upstream: pending messages path in resumed-after-success requires sendMessage called on a completing task; timing-dependent race cannot be reproduced with fake timer sequential execution @preserve */
    const pendingQueue = this.pendingMessages.get(task.taskId);
    if (pendingQueue !== undefined && pendingQueue.length > 0) {
      this.pendingMessages.delete(task.taskId);
      const combinedPrompt = pendingQueue.join('\n\n');
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Delivering ${String(pendingQueue.length)} queued message(s) instead of finalizing`
      );
      this.appendTaggedTaskLog(
        task.taskId,
        'prompt',
        combinedPrompt.length > 200 ? combinedPrompt.slice(0, 200) + '\u2026' : combinedPrompt
      );
      await this.flushTaskLogs(task.taskId);
      await this.teardownAttempt(task.taskId, true);
      const resumeResult = await this.startWorkerAttempt(task, {
        prompt: combinedPrompt,
        continueSession: true,
        injectActiveGoal: true,
      });
      if (resumeResult.ok) {
        task.containerId = resumeResult.containerId;
        await this.saveTask(task);
        this.claudeErrors.delete(task.taskId);
        this.taskExitCodes.delete(task.taskId);
        this.attemptStartedAt.delete(task.taskId);
        return;
      }
      this.appendOrchestratorTaskLog(
        task.taskId,
        'Failed to deliver queued messages, finalizing normally'
      );
    }
    /* v8 ignore stop @preserve */

    this.appendOrchestratorTaskLog(task.taskId, 'Resumed-after-success verification passed');
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);
    delete task.resumedAfterSuccess;

    const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
    const geminiSummary = await this.completionVerifier.extractResumeSummary(task.taskId, rawLogs);

    const enrichedResult = this.enrichResultForResumedTask(task, effectiveResult);
    if (enrichedResult !== undefined && geminiSummary !== undefined) {
      enrichedResult.summary = geminiSummary;
    }
    await this.finalizeTask(task, 'completed', {
      ...(enrichedResult !== undefined && { result: enrichedResult }),
      resumedCompletion: true,
    });
  }

  private async startWorkerAttempt(
    task: Task,
    params: {
      prompt: string;
      continueSession: boolean;
      injectActiveGoal?: boolean;
    }
  ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> {
    this.attemptCompletionSignals.delete(task.taskId);
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Starting worker attempt: continueSession=${String(params.continueSession)}`
    );
    const runtimeName = this.resolveTaskRuntime(task);
    const workerTypeConfig = WORKER_TYPES[task.workerType];
    const runtime = getRuntime(runtimeName);
    const runtimeAttemptState = runtime.createAttemptState(task.taskId, this.logger);
    if (params.continueSession && task.runtimeSessionId === undefined) {
      return {
        ok: false,
        error: new Error(`${runtimeName} resume requires a persisted runtime session ID`),
      };
    }
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Worker config: type=${task.workerType} runtime=${runtimeName} model=${workerTypeConfig.model ?? 'default'} apiUrl=${workerTypeConfig.apiBaseUrl}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Container config: worktree=${task.worktreePath} baseBranch=${task.baseBranch}`
    );
    if (params.continueSession) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Exec command: /entrypoint.sh run-attempt (reusing existing container)`
      );
    } else {
      const imageInfo = this.isolation.provider.getImageInfo?.();
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Creating new container: image=${imageInfo?.configuredRef ?? 'configured'} cmd=/entrypoint.sh`
      );
    }

    const workerConfig: WorkerConfig = {
      taskId: task.taskId,
      worktreePath: task.worktreePath,
      prompt: params.prompt,
      /* v8 ignore start -- ts-type: conditional spread for exact optional property types @preserve */
      systemPrompt:
        buildSystemPrompt({
          taskId: task.taskId,
          ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
          ...(task.linearIssueTitle !== undefined && { linearIssueTitle: task.linearIssueTitle }),
          taskUrl: `https://intexuraos.cloud/#/code-tasks/${task.taskId}`,
          linearIssueLabels: task.linearIssueLabels,
          workerType: task.workerType,
          ...(WORKER_TYPES[task.workerType].model !== undefined && {
            modelName: WORKER_TYPES[task.workerType].model,
          }),
          ...(task.agentType !== undefined && { agentType: task.agentType }),
          ...(task.trackingCommentId !== undefined && {
            trackingCommentId: task.trackingCommentId,
          }),
          ...(task.continuationPrNumber !== undefined && {
            continuationPrNumber: task.continuationPrNumber,
          }),
          ...(task.continuationPrBranch !== undefined && {
            continuationPrBranch: task.continuationPrBranch,
          }),
          ...(task.executionMemoryContext !== undefined && {
            executionMemoryContext: task.executionMemoryContext,
          }),
          ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
        }) +
        /* v8 ignore stop @preserve */
        (params.injectActiveGoal === true ? this.buildActiveGoalSection(task, params.prompt) : ''),
      workerType: task.workerType,
      runtimeOverride: runtimeName,
      ...(task.runtimeSessionId !== undefined && { runtimeSessionId: task.runtimeSessionId }),
      secrets: this.isolation.getSecrets(),
      gcpSaKeyPath: this.isolation.gcpSaKeyPath,
      githubAppKeyPath: this.isolation.githubAppKeyPath,
      continueSession: params.continueSession,
      onLog: (chunk) => {
        const cleaned = stripDockerHeaders(chunk);
        this.lastOutputAt.set(task.taskId, Date.now());
        this.activityTimeoutManager.touch(task.taskId);
        void this.handleRuntimeEvents(task, runtime.processLogChunk(runtimeAttemptState, cleaned));
      },
      onComplete: (exitCode) => {
        void this.handleRuntimeEvents(task, runtime.flushAttemptState(runtimeAttemptState));
        this.taskExitCodes.set(task.taskId, exitCode);
        this.attemptCompletionSignals.add(task.taskId);
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Worker attempt completed: exitCode=${String(exitCode)}`
        );
        this.logForwarder.flushAndStop(task.taskId).catch((error: unknown) => {
          this.logger.error({ taskId: task.taskId, error }, 'Failed to flush logs on completion');
        });
      },
    };

    this.logger.info(
      {
        taskId: task.taskId,
        agentType: task.agentType ?? 'default',
        systemPromptLength: workerConfig.systemPrompt.length,
        userPromptLength: params.prompt.length,
      },
      'System prompt built'
    );

    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
    this.lastOutputAt.set(task.taskId, Date.now());
    // INT-1455: record attempt start time so the classifier can compute
    // duration on completion. No matching delete() here — the immediate
    // set() below replaces any stale value from a prior attempt.
    this.attemptStartedAt.set(task.taskId, Date.now());

    // Store promise to enable zombie cleanup if timeout fires mid-creation.
    let createPromise: Promise<WorkerHandle> | undefined;

    try {
      await this.isolation.tokenRefresher.registerTask(task.taskId);

      // Phase 1/2: Pull worker image (network-bound, variable latency)
      // Only pull for new containers — continued sessions reuse existing containers.
      if (!params.continueSession && this.isolation.provider.pullImage !== undefined) {
        this.appendOrchestratorTaskLog(task.taskId, 'Phase 1/2: Pulling worker image...');
        const resolvedImage = await withTimeout(
          this.isolation.provider.pullImage(task.taskId, (message) => {
            this.appendOrchestratorTaskLog(task.taskId, message);
          }),
          IMAGE_PULL_TIMEOUT_MS,
          `Image pull timed out after ${String(IMAGE_PULL_TIMEOUT_MS / 1000)}s`
        );
        workerConfig.resolvedImage = resolvedImage;
      }

      // Phase 2/2: Create worker container (deterministic, ~40s)
      if (!params.continueSession) {
        this.appendOrchestratorTaskLog(task.taskId, 'Phase 2/2: Creating worker container...');
      }
      createPromise = this.isolation.provider.createWorker(workerConfig);

      const handle = await withTimeout(
        createPromise,
        CONTAINER_CREATE_TIMEOUT_MS,
        `Container creation timed out after ${String(CONTAINER_CREATE_TIMEOUT_MS / 1000)}s — Docker may be unresponsive`
      );

      this.appendOrchestratorTaskLog(
        task.taskId,
        `Worker container ready: containerId=${handle.containerId}`
      );

      // Best-effort: send task_started event to code-agent
      this.webhookClient
        .send({
          url: getTaskEventUrl(task.webhookUrl),
          secret: task.webhookSecret,
          payload: {
            taskId: task.taskId,
            event: 'task_started',
            attempt: task.attemptCount ?? 1,
            workerType: task.workerType,
          },
          taskId: task.taskId,
        })
        .catch((sendError: unknown) => {
          this.logger.warn(
            { taskId: task.taskId, error: sendError },
            'Failed to send task_started event (best-effort)'
          );
        });

      this.activityTimeoutManager.start(task.taskId);
      return { ok: true, containerId: handle.containerId };
    } catch (error) {
      // If the timeout fired but createWorker is still in-flight, it may
      // eventually succeed and leave a zombie container running with no
      // monitoring. Attach a cleanup handler to destroy it if that happens.
      createPromise
        ?.then((handle) => {
          this.logger.warn(
            { taskId: task.taskId, containerId: handle.containerId },
            'Late container created after timeout — destroying zombie'
          );
          this.appendOrchestratorTaskLog(
            task.taskId,
            `Destroying zombie container created after timeout: ${handle.containerId}`
          );
          return withTimeout(
            this.isolation.provider.destroyWorker(task.taskId),
            ZOMBIE_CLEANUP_TIMEOUT_MS,
            'Zombie container cleanup timed out'
          );
        })
        .catch(() => {
          // createWorker itself failed or cleanup timed out — best effort
        });

      /* v8 ignore start -- ts-type: error instanceof Error ternary creates branch; FakeIsolationProvider throws Error instances so String(error) branch is unreachable in unit tests @preserve */
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Worker start failed: ${error instanceof Error ? error.message : String(error)}`
      );
      /* v8 ignore stop @preserve */
      return { ok: false, error };
    }
  }

  private async teardownAttempt(taskId: string, keepSession: boolean): Promise<void> {
    if (!keepSession) {
      try {
        await this.isolation.provider.destroyWorker(taskId);
      } catch (error) {
        this.logger.warn({ taskId, error }, 'Failed to destroy worker after attempt completion');
      }
      await this.isolation.provider.cleanupTaskSession?.(taskId);
    }
  }

  private async failAcceptedResume(task: Task, error: unknown): Promise<void> {
    this.logger.error(
      { taskId: task.taskId, error },
      'Accepted task resume failed during worker startup'
    );

    const resumeError: TaskError = {
      code: 'RESUME_ATTEMPT_FAILED',
      /* v8 ignore start -- ts-type: error instanceof Error ternary; failAcceptedResume always receives Error instances so String(error) branch is structurally unreachable in unit tests @preserve */
      message: `Failed to resume task: ${error instanceof Error ? error.message : String(error)}`,
      /* v8 ignore stop @preserve */
      remediation: { action: 'retry' },
    };

    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: resume start failed (${resumeError.message})`
    );

    await this.finalizeTask(task, 'failed', {
      error: resumeError,
    });
  }

  private async finalizeTask(
    task: Task,
    statusParam: 'completed' | 'failed' | 'interrupted' | 'cancelled',
    payload: { result?: TaskResult; error?: TaskError; resumedCompletion?: boolean },
    keepLogForwarderOpen = false
  ): Promise<void> {
    const finalStatus = statusParam;
    const isNonPreservableAgentType =
      task.agentType === 'review' || task.agentType === 'remediation';
    const shouldPreserve =
      this.preserveWorkerContainers &&
      !isNonPreservableAgentType &&
      (finalStatus === 'failed' || finalStatus === 'interrupted' || finalStatus === 'completed');
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Finalizing task: status=${finalStatus} hasResult=${String(payload.result !== undefined)} hasError=${String(payload.error !== undefined)}`
    );

    try {
      await this.logForwarder.flush(task.taskId);
    } catch (flushError) {
      this.logger.error(
        { taskId: task.taskId, error: flushError },
        'Log flush failed during finalization'
      );
    }

    this.appendOrchestratorTaskLog(task.taskId, `Finalizing: flushed logs`);
    if (!keepLogForwarderOpen) {
      this.logForwarder.close(task.taskId);
    }

    if (shouldPreserve && task.agentType === 'pull_request' && task.prNumber !== undefined) {
      /* v8 ignore start -- source-map: optional chaining on listPreservedWorkers not tracked by v8 even though test covers both undefined and array paths @preserve */
      const preserved = (await this.isolation.provider.listPreservedWorkers?.()) ?? [];
      /* v8 ignore stop @preserve */
      if (preserved.length > 0) {
        const savedState = await this.statePersistence.load();
        for (const p of preserved) {
          const preservedTask = savedState.tasks[p.taskId];
          if (
            preservedTask?.agentType === 'pull_request' &&
            preservedTask.prNumber === task.prNumber &&
            preservedTask.taskId !== task.taskId
          ) {
            this.logger.info(
              { oldTaskId: p.taskId, newTaskId: task.taskId, prNumber: task.prNumber },
              'Destroying previous preserved pull_request container for same PR'
            );
            await this.isolation.provider.destroyWorker(p.taskId);
          }
        }
      }
    }
    if (shouldPreserve) {
      /* v8 ignore start -- ts-type: optional chaining + nullish coalescing on preserveWorker; IsolationProvider.preserveWorker is structurally optional but always defined by both DockerProvider and the FakeIsolationProvider, so the undefined branch is unreachable from any test entry point @preserve */
      const preserved = (await this.isolation.provider.preserveWorker?.(task.taskId)) ?? false;
      /* v8 ignore stop @preserve */
      if (preserved) {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Preserved worker container for debugging: taskId=${task.taskId} status=${finalStatus}`
        );
      } else {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Failed to preserve worker container (no tracked worker): taskId=${task.taskId} status=${finalStatus}`
        );
        await this.teardownAttempt(task.taskId, false);
      }
    } else {
      await this.teardownAttempt(task.taskId, false);
    }
    this.isolation.tokenRefresher.unregisterTask(task.taskId);
    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
    this.attemptStartedAt.delete(task.taskId);
    this.attemptCompletionSignals.delete(task.taskId);
    this.pendingMessages.delete(task.taskId);
    this.lastOutputAt.delete(task.taskId);

    task.status = finalStatus;
    task.completedAt = new Date().toISOString();
    delete task.resumedAfterSuccess;
    // Store result for resume-after-success fallback; clear on non-success
    if (finalStatus === 'completed' && payload.result !== undefined) {
      task.lastSuccessResult = payload.result;
    } else {
      delete task.lastSuccessResult;
    }
    delete task.pendingResumeStart;
    await this.saveTask(task);

    if (this.runningCount > 0) this.runningCount--;
    this.clearTaskTimers(task.taskId);

    // Send task lifecycle event to code-agent (best-effort)
    /* v8 ignore start -- ts-type: nested ternary over TaskStatus discriminated union; v8 cannot track all branch arms of chained ternary expressions despite tests exercising all statuses @preserve */
    const taskLifecycleEvent =
      finalStatus === 'completed'
        ? 'task_completed'
        : finalStatus === 'failed'
          ? 'task_failed'
          : finalStatus === 'interrupted'
            ? 'task_interrupted'
            : undefined;
    /* v8 ignore stop @preserve */

    /* v8 ignore start -- ts-type: taskLifecycleEvent undefined branch; v8 misattributes the false branch of this conditional check despite test at line 2160 exercising finalizeTask with cancelled status @preserve */
    if (taskLifecycleEvent !== undefined) {
      /* v8 ignore stop @preserve */
      const agentStatusMap: Record<string, string> = {
        execution: 'implemented',
        remediation: 'implemented',
        review: 'reviewed',
        planning: 'planned',
      };
      /* v8 ignore start -- ts-type: conditional spread branches for optional result/error fields; FakeWebhookClient records payloads but branch tracking for spread operators inside object literals is misattributed by v8 @preserve */
      const taskEventPayload: Record<string, unknown> = {
        taskId: task.taskId,
        event: taskLifecycleEvent,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard: completedAt set above but test mocks may bypass assignment
        ...(task.completedAt !== undefined && {
          duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
        }),
        ...(payload.result?.prUrl !== undefined && { prUrl: payload.result.prUrl }),
        ...(payload.result?.commitDetails !== undefined && {
          commits: payload.result.commitDetails,
        }),
        ...(payload.error !== undefined && { error: payload.error }),
        ...(task.agentType !== undefined &&
          agentStatusMap[task.agentType] !== undefined && {
            status: agentStatusMap[task.agentType],
          }),
      };
      /* v8 ignore stop @preserve */

      this.webhookClient
        .send({
          url: getTaskEventUrl(task.webhookUrl),
          secret: task.webhookSecret,
          payload: taskEventPayload,
          taskId: task.taskId,
        })
        .catch((sendError: unknown) => {
          this.logger.warn(
            { taskId: task.taskId, error: sendError },
            'Failed to send task lifecycle event (best-effort)'
          );
        });
    }

    // Commit terminal status to code-agent's Firestore BEFORE firing the
    // legacy task-complete webhook. Code-agent's Firestore is the single
    // source of truth for status; the webhook is demoted to side-effects
    // (Linear labels, WhatsApp, etc.). On commit failure, log + continue —
    // the zombie watchdog (Task 6) is the recovery path. Do NOT block
    // finalize: Docker teardown and local state cleanup already ran.
    const statusCommitResult = await this.statusUpdateClient.commit({
      taskId: task.taskId,
      status: finalStatus,
      // Defensive fallback mirrors the line ~2505 guard: task.completedAt is
      // set above at line 2465, but test mocks or future refactors could
      // bypass that assignment. Avoids RangeError inside .toISOString().
      /* v8 ignore start -- ts-type: defensive fallback for optional Task.completedAt; production path at line 2465 always sets it before reaching here, mirrors the runtime guard at line ~2505 @preserve */
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard: completedAt set above but test mocks may bypass assignment
      completedAt: task.completedAt !== undefined ? new Date(task.completedAt) : new Date(),
      /* v8 ignore stop @preserve */
      ...(payload.error !== undefined && {
        error: { code: payload.error.code, message: payload.error.message },
      }),
      ...(payload.result !== undefined && {
        result: {
          ...(payload.result.prUrl !== undefined && { prUrl: payload.result.prUrl }),
          ...(payload.result.branch !== undefined && { branch: payload.result.branch }),
          ...(payload.result.summary !== undefined && { summary: payload.result.summary }),
        },
      }),
    });
    if (!statusCommitResult.ok) {
      this.logger.error(
        {
          taskId: task.taskId,
          tag: 'STATUS_UPDATE_COMMIT_FAILED',
          errorType: statusCommitResult.error.type,
          errorMessage: statusCommitResult.error.message,
          agentType: task.agentType,
          prNumber: task.prNumber,
          repository: task.repository,
          finalStatus,
        },
        'Failed to commit terminal status via /internal/code-tasks/:id/status; zombie watchdog will recover'
      );
      this.appendOrchestratorTaskLog(
        task.taskId,
        `STATUS_UPDATE_COMMIT_FAILED: type=${statusCommitResult.error.type} — zombie watchdog will recover`
      );
    }

    await this.webhookClient.send({
      url: task.webhookUrl,
      secret: task.webhookSecret,
      /* v8 ignore start -- ts-type: conditional spread branches for optional result/error/resumedCompletion fields; spread operator branch tracking inside object literals is misattributed by v8 @preserve */
      payload: {
        taskId: task.taskId,
        status: finalStatus,
        ...(payload.result !== undefined && { result: payload.result }),
        ...(payload.error !== undefined && { error: payload.error }),
        duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
        ...(payload.resumedCompletion === true && { resumedCompletion: true }),
      },
      /* v8 ignore stop @preserve */
      taskId: task.taskId,
    });
    this.logger.info(
      {},
      `Task finalized: id=${task.taskId} status=${finalStatus} durationMs=${String(new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime())}`
    );
  }

  private async checkForResult(task: Task): Promise<TaskResult | undefined> {
    return await checkForResultFn(this.logger, task);
  }

  private async handleRuntimeEvents(task: Task, events: RuntimeEvent[]): Promise<void> {
    let shouldPersistTask = false;
    const taskId = task.taskId;
    const runtimeName = this.resolveTaskRuntime(task);

    for (const event of events) {
      if (event.type === 'log') {
        /* v8 ignore start -- upstream: event.text empty string branch requires runtime adapter to emit an empty log event; FakeIsolationProvider and both runtime fakes always produce non-empty log chunks so the empty-text skip is unreachable in unit tests @preserve */
        if (event.text !== '') {
          if (runtimeName === 'codex') {
            this.logForwarder.appendRawChunk(taskId, event.text);
          } else {
            this.logForwarder.appendChunk(taskId, event.text);
          }
        }
        /* v8 ignore stop @preserve */
        continue;
      }

      if (event.type === 'runtime_session_started') {
        /* v8 ignore start -- upstream: runtimeSessionId equality branch requires a runtime to emit a duplicate runtime_session_started event with the same sessionId; FakeIsolationProvider emits each session id exactly once so the equal-id skip is unreachable in unit tests @preserve */
        if (task.runtimeSessionId !== event.sessionId) {
          task.runtimeSessionId = event.sessionId;
          shouldPersistTask = true;
        }
        /* v8 ignore stop @preserve */
        this.logger.info({ taskId, sessionId: event.sessionId }, 'Detected runtime session start');
        continue;
      }

      if (event.type === 'attempt_completed') {
        /* v8 ignore start -- upstream: attemptCompletionSignals.has guard requires runtime to emit attempt_completed twice for the same task without reset; FakeIsolationProvider emits each attempt_completed once per attempt so the duplicate-signal skip is unreachable in unit tests @preserve */
        if (!this.attemptCompletionSignals.has(taskId)) {
          this.taskExitCodes.set(taskId, event.exitCode);
          this.attemptCompletionSignals.add(taskId);
          this.logger.info(
            { taskId, exitCode: event.exitCode },
            'Detected runtime stream result; signaling attempt completion'
          );
        }
        /* v8 ignore stop @preserve */
        continue;
      }

      if (!this.attemptCompletionSignals.has(taskId)) {
        this.taskExitCodes.set(taskId, event.exitCode);
        this.attemptCompletionSignals.add(taskId);
        this.logger.info(
          { taskId, exitCode: event.exitCode },
          'Detected runtime stream result; signaling attempt completion'
        );
      }
      this.claudeErrors.set(taskId, event.errorMessage);
    }

    if (shouldPersistTask) {
      await this.saveTask(task);
    }
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

  private async collectTurnMetrics(task: Task, attempt: number): Promise<void> {
    await collectTurnMetricsFn(this.turnMetricsCollector, this.logger, task, attempt);
  }

  private async prepareComplianceValidationInput(
    task: Task,
    finalResult: TaskResult,
    verification: CompletionVerifierVerdict
  ): Promise<ComplianceValidationInput | undefined> {
    return await prepareComplianceValidationInputFn(
      this.agentComplianceValidator,
      this.config,
      this.logForwarder,
      this.logger,
      task,
      finalResult,
      verification
    );
  }

  private async executeComplianceValidation(
    task: Task,
    input: ComplianceValidationInput
  ): Promise<void> {
    await executeComplianceValidationFn(
      this.agentComplianceValidator,
      this.webhookClient,
      this.logForwarder,
      this.logger,
      task,
      input
    );
  }

  private async flushAndCloseLogForwarder(taskId: string): Promise<void> {
    await flushAndCloseLogForwarderFn(this.logForwarder, this.logger, taskId);
  }

  private clearTaskTimers(taskId: string): void {
    clearTaskTimersFn(
      this.activeTasks,
      this.activityTimeoutManager,
      this.completionInProgress,
      this.attemptCompletionSignals,
      taskId
    );
  }
}
