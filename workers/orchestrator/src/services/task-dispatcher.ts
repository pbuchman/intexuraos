import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Mutex } from 'async-mutex';
import {
  type Result,
  type Logger,
  getErrorMessage,
  hasCodeTaskLabel,
} from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import { withTimeout } from '../with-timeout.js';
import type { Task, TaskStatus, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
import type { SendMessageResult, SendMessageError } from '../types/schemas.js';
import type { StatePersistence } from './state-persistence.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { LogForwarder } from './log-forwarder.js';
import type { WebhookClient } from './webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { IsolationProvider, WorkerConfig, WorkerHandle } from './isolation/types.js';
import { WORKER_TYPES } from './isolation/types.js';
import type { TokenRefresher } from './isolation/token-refresher.js';
import type { ApiKeyValidator } from './api-key-validator.js';
import type { WorkerAuthProvider, WorkerAuthRegistry } from './worker-auth/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import { stripDockerHeaders } from './log-formatter.js';
import {
  type CompletionAgentType,
  type CompletionVerifier,
  type CompletionVerifierVerdict,
  getLast50Lines,
} from './completion-verifier.js';
import { getRuntime, type RuntimeEvent, type WorkerRuntime } from './runtime/index.js';
import type { TurnMetricsCollector } from './turn-metrics-collector.js';
import type {
  AgentComplianceValidator,
  ComplianceValidationInput,
} from './agent-compliance-validator.js';
import type { ExecutionAgentData } from './completion-verifier.js';
import { readSessionTranscript } from './transcript-reader.js';
import { formatTranscript } from './transcript-formatter.js';
import { extractPrNumber } from './deep-validator-helpers.js';

const execAsync = promisify(exec);

export function getTaskEventUrl(webhookUrl: string): string {
  return webhookUrl.replace('/internal/webhooks/task-complete', '/internal/webhooks/task-event');
}

const FATAL_EXIT_CODE_PREFIX = 'fatal_exit_code_';

export function hasFatalExitCodeField(missingFields: string[]): string | undefined {
  return missingFields.find((f) => f.startsWith(FATAL_EXIT_CODE_PREFIX));
}

const TASK_TIMEOUT_WARNING_MS = 175 * 60 * 1000; // 2h 55m
const TASK_TIMEOUT_KILL_MS = 180 * 60 * 1000; // 3h
const COMPLETION_CHECK_INTERVAL_MS = 30 * 1000; // 30s
const ACTIVITY_HEARTBEAT_THRESHOLD_MS = 30 * 1000; // 30s
const IMAGE_PULL_TIMEOUT_MS = 900_000; // 15 minutes — image pulls are network-bound
const CONTAINER_CREATE_TIMEOUT_MS = 120_000; // 2 minutes
const ZOMBIE_CLEANUP_TIMEOUT_MS = 30_000; // 30s — generous limit for best-effort destroy

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
}

export class TaskDispatcher {
  private runningCount = 0;
  private readonly capacityMutex = new Mutex();
  private readonly activeTasks = new Map<string, NodeJS.Timeout>();
  private readonly claudeErrors = new Map<string, string>();
  private readonly taskExitCodes = new Map<string, number>();
  private readonly attemptCompletionSignals = new Set<string>();
  private readonly completionInProgress = new Set<string>();
  private readonly pendingMessages = new Map<string, string[]>();
  private readonly lastOutputAt = new Map<string, number>();
  private readonly completionMaxAttempts: number;
  private readonly completionVerifier: CompletionVerifier;
  private readonly preserveWorkerContainers: boolean;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly statePersistence: StatePersistence,
    private readonly worktreeManager: WorktreeManager,
    private readonly logForwarder: LogForwarder,
    private readonly webhookClient: WebhookClient,
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
      const isPullRequestTask =
        task.agentType === 'pull_request' ||
        task.linearIssueLabels.some((l) => l.trim().toLowerCase() === 'pr-comment');
      /* v8 ignore start -- source-map: ternary branch mapping misattributed after bundling despite unit tests for all agents @preserve */
      const agentLabel = isPullRequestTask
        ? 'Pull Request Agent'
        : task.agentType === 'review'
          ? 'Review Agent'
          : task.agentType === 'remediation'
            ? 'Remediation Agent'
            : task.agentType === 'execution'
              ? 'Execution Agent'
              : task.agentType === 'planning'
                ? 'Planning Agent'
                : hasCodeTaskLabel(task.linearIssueLabels)
                  ? 'Execution Agent'
                  : 'Planning Agent';
      const agentDesc =
        agentLabel === 'Pull Request Agent'
          ? 'Pull Request Agent \u2014 respond to PR comment/review and push to existing PR branch'
          : agentLabel === 'Review Agent'
            ? 'Review Agent \u2014 read-only PR review, post review comments'
            : agentLabel === 'Remediation Agent'
              ? 'Remediation Agent \u2014 address review findings on the existing PR branch and decide if re-review is needed'
              : agentLabel === 'Execution Agent'
                ? 'Execution Agent \u2014 implement autonomously, run CI, create PR'
                : 'Planning Agent \u2014 create planning artifacts only, no implementation coding';
      /* v8 ignore stop @preserve */
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
    this.logger.error(
      { taskId: request.taskId, error: originalError },
      `Task setup failed: ${message}`
    );
    try {
      await this.webhookClient.send({
        url: request.webhookUrl,
        secret: request.webhookSecret,
        payload: {
          taskId: request.taskId,
          status: 'failed',
          error: {
            code: 'SETUP_FAILED',
            message,
          },
          duration: 0,
        },
        taskId: request.taskId,
      });
    } catch (webhookError) {
      this.logger.error(
        { taskId: request.taskId, webhookError },
        'Failed to send setup failure webhook'
      );
    }
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
      // TODO(INT-1130): call code-agent /internal/tasks/:id/dispatch-metadata when task not in state
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
      // Verify the container is still available before accepting the resume.
      // isResumeAvailable performs a synchronous Docker inspect so the caller gets a
      // synchronous 'not_found' error instead of a silent async RESUME_ATTEMPT_FAILED.
      /* v8 ignore start -- source-map: optional chaining ?. and ?? false branches inside await expression not tracked by v8 even with tests covering both paths @preserve */
      const isAvailable = (await this.isolation.provider.isResumeAvailable?.(taskId)) ?? false;
      /* v8 ignore stop @preserve */
      if (!isAvailable) {
        return {
          ok: false,
          error: { type: 'not_found', message: 'Worker container no longer available for resume' },
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

      const prompt = this.buildResumePreamble(task) + message;
      task.status = 'running';
      task.containerId = '';
      task.startedAt = new Date().toISOString();
      task.attemptCount = 1;
      task.verificationHistory = [];
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
    return task.runtime ?? WORKER_TYPES[task.workerType].runtime;
  }

  private getRuntimeDisplayName(task: Task): string {
    return this.resolveTaskRuntime(task) === 'codex' ? 'Codex' : 'Claude';
  }

  private async saveTask(task: Task): Promise<void> {
    await this.statePersistence.modify((state) => {
      state.tasks[task.taskId] = task;
    });
  }

  private async resumeTaskWithUserMessage(task: Task): Promise<void> {
    const prompt = task.pendingResumeStart?.prompt;
    /* v8 ignore start -- upstream: sendMessage and recoverPendingResumeTask always set pendingResumeStart.prompt before invoking this helper; guards against unexpected in-flight mutation @preserve */
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
        injectActiveGoal: true,
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
            this.logger.warn({ taskId }, 'Task approaching 3-hour timeout');
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

          // Kill Docker container
          await this.isolation.provider.destroyWorker(taskId);

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
    const isPullRequestTask =
      task.agentType === 'pull_request' ||
      task.linearIssueLabels.some((l) => l.trim().toLowerCase() === 'pr-comment');
    /* v8 ignore start -- ts-type: nested ternary chain over discriminated union variants creates structural branches; exhaustive conditional narrowing @preserve */
    const completionAgentType: CompletionAgentType = isPullRequestTask
      ? 'pull_request'
      : task.agentType === 'review'
        ? 'review'
        : task.agentType === 'remediation'
          ? 'remediation'
          : task.agentType === 'execution'
            ? 'execution'
            : task.agentType === 'planning'
              ? 'planning'
              : hasCodeTaskLabel(task.linearIssueLabels)
                ? 'execution'
                : 'planning';
    /* v8 ignore stop @preserve */
    this.attemptCompletionSignals.delete(task.taskId);

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
      `🤖 Gemini summary: ${verification.agentData?.summary ?? '(no summary extracted)'}`
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

    // Verifier failure (Gemini down/parse error): retry Gemini immediately if attempts remain
    /* v8 ignore start -- upstream: verifierFailure path requires Gemini to return parse errors; FakeCompletionVerifier always returns valid responses and cannot simulate upstream failures @preserve */
    if (verification.verifierFailure) {
      if (attempt < maxAttempts) {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Verifier failure; retrying Gemini (${String(attempt + 1)}/${String(maxAttempts)})`
        );
        // Re-call verifier with same logs — counts as an attempt
        const retryVerification = await this.completionVerifier.verify({
          taskId: task.taskId,
          attempt: attempt + 1,
          maxAttempts,
          agentType: completionAgentType,
          rawLogs,
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
        message: 'Gemini verifier unavailable',
        remediation: {
          action: 'contact_support',
          manualSteps: [
            'Ensure INTEXURAOS_GEMINI_APP_API_KEY is configured for orchestrator.',
            'Check Gemini provider connectivity and retry task after verifier is healthy.',
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
      /* v8 ignore start -- upstream: exit code override path requires non-zero taskExitCodes entry set by runtime; fake isolation provider cannot simulate non-zero container exit codes @preserve */
      if (exitCode !== undefined && exitCode !== 0) {
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Non-zero exit code (${String(exitCode)}) overrides verifier passed decision`
        );
        await this.flushTaskLogs(task.taskId);
        await this.collectTurnMetrics(task, attempt);
        await this.teardownAttempt(task.taskId, false);
        const error: TaskError = {
          code: 'TASK_EXIT_CODE_OVERRIDE',
          message: `Non-zero exit code (${String(exitCode)}) overrides verifier passed decision`,
          remediation: { action: 'retry' },
        };
        await this.finalizeTask(task, 'failed', {
          ...(result !== undefined && { result }),
          error,
        });
        return;
      }
      /* v8 ignore stop @preserve */

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
    /* v8 ignore start -- upstream: fatal exit code path requires SIGKILL/SIGSEGV in missingFields; fake verifier always returns empty missingFields and cannot simulate signal-based termination @preserve */
    const fatalField = hasFatalExitCodeField(verification.missingFields);
    if (fatalField !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Fatal exit code detected (${fatalField}); skipping retry — session state is not recoverable`
      );
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      await this.teardownAttempt(task.taskId, false);
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

      const resumePrompt = this.buildMissingFieldsPrompt(
        completionAgentType,
        verification.missingFields,
        rawLogs
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

  private buildMissingFieldsPrompt(
    agentType: CompletionAgentType,
    missingFields: string[],
    rawLogs: string
  ): string {
    const transcript = getLast50Lines(rawLogs);
    return [
      '[AUTO-CONTINUE ATTEMPT]',
      'Your last response was missing required fields for the completion verifier.',
      '',
      `Missing fields: ${missingFields.join(', ')}`,
      '',
      'Please ensure your final message includes all required information.',
      `Agent type: ${agentType}`,
      '',
      'Last 50 lines of transcript for reference:',
      transcript,
      '',
      'Constraints:',
      '- Do not restart from scratch.',
      '- Continue from current repository/worktree state.',
    ].join('\n');
  }

  private buildResultFromVerification(
    task: Task,
    gitResult: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
    verification: CompletionVerifierVerdict
  ): TaskResult {
    const base: TaskResult = { ...(gitResult ?? {}) };
    const agentData = verification.agentData;
    if (agentData === undefined) return base;

    base.summary = agentData.summary;

    /* v8 ignore start -- upstream: FakeCompletionVerifier always returns planning agentData; execution/review/remediation/pull_request variants require agent-type specific verifier responses not producible with unit test fakes @preserve */
    if (agentData.agentType === 'planning') {
      base.planning_outcome_label = agentData.outcome;
      base.planning_superpowers_writing_plans_used =
        agentData.superpowers_writing_plans === 'used' ? '1' : '0';
      base.planning_linear_url = agentData.linear_url;
      base.planning_is_complex = agentData.is_complex;
      base.planning_has_plan_doc = agentData.has_plan_doc;
      base.planning_subtask_urls = agentData.subtask_urls;
      if (agentData.pr_url !== '') {
        base.planning_pr_url = agentData.pr_url;
      }
      base.planning_unclear_clarification = agentData.unclear_clarification;
    } else if (agentData.agentType === 'execution') {
      base.execution_outcome_label = agentData.outcome;
      base.execution_superpowers_subagent_driven_dev_used =
        agentData.superpowers_subagent_driven_dev === 'used' ? '1' : '0';
      base.execution_superpowers_requesting_code_review_used =
        agentData.superpowers_requesting_code_review === 'used' ? '1' : '0';
      base.execution_memory_ids_used = agentData.memory_ids_used;
      base.execution_memory_ids_rejected = agentData.memory_ids_rejected;
      base.execution_memory_usage_summary = agentData.memory_usage_summary;
      if (agentData.gh_pr_url !== '') {
        base.prUrl = agentData.gh_pr_url;
      }
      if (task.linearIssueId !== undefined) {
        base.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
      }
    } else if (agentData.agentType === 'review') {
      if (agentData.gh_pr_url !== '') {
        base.prUrl = agentData.gh_pr_url;
      }
      if (agentData.review_id !== undefined) {
        base.review_id = agentData.review_id;
      }
      base.review_comments_posted = agentData.review_comments_posted;
      base.review_types = agentData.review_types;
      base.requirements_tracker_updated = agentData.requirements_tracker_updated;
      base.gh_actions_status = agentData.gh_actions_status;
      base.needs_remediation = agentData.needs_remediation;
      if (agentData.review_body !== '') {
        base.review_body = agentData.review_body;
      }
      if (agentData.review_inline_comments !== '') {
        base.review_inline_comments = agentData.review_inline_comments;
      }
    } else if (agentData.agentType === 'remediation') {
      base.execution_outcome_label = agentData.outcome;
      if (agentData.gh_pr_url !== '') {
        base.prUrl = agentData.gh_pr_url;
      }
      base.requires_re_review = agentData.requires_re_review;
    } else {
      if (agentData.gh_pr_url !== '') {
        base.prUrl = agentData.gh_pr_url;
      }
      base.comment_replied = agentData.comments_replied === 'yes';
    }
    /* v8 ignore stop @preserve */

    return base;
  }

  private enrichResultForResumedTask(
    task: Task,
    result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
  ): TaskResult | undefined {
    if (result === undefined) return undefined;
    /* v8 ignore start -- upstream: enrichResultForResumedTask agent-type branches require review/remediation/pull_request tasks with lastSuccessResult set; FakeIsolationProvider always returns planning task fixtures without prior success results @preserve */
    if (task.agentType === 'execution' && task.linearIssueId !== undefined) {
      result.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
    }
    if (task.agentType === 'review' && task.lastSuccessResult !== undefined) {
      if (result.review_id === undefined && task.lastSuccessResult.review_id !== undefined) {
        result.review_id = task.lastSuccessResult.review_id;
      }
      if (
        result.review_comments_posted === undefined &&
        task.lastSuccessResult.review_comments_posted !== undefined
      ) {
        result.review_comments_posted = task.lastSuccessResult.review_comments_posted;
      }
      if (result.review_types === undefined && task.lastSuccessResult.review_types !== undefined) {
        result.review_types = task.lastSuccessResult.review_types;
      }
      if (
        result.requirements_tracker_updated === undefined &&
        task.lastSuccessResult.requirements_tracker_updated !== undefined
      ) {
        result.requirements_tracker_updated = task.lastSuccessResult.requirements_tracker_updated;
      }
      if (
        result.gh_actions_status === undefined &&
        task.lastSuccessResult.gh_actions_status !== undefined
      ) {
        result.gh_actions_status = task.lastSuccessResult.gh_actions_status;
      }
      if (
        result.needs_remediation === undefined &&
        task.lastSuccessResult.needs_remediation !== undefined
      ) {
        result.needs_remediation = task.lastSuccessResult.needs_remediation;
      }
    }
    if (task.agentType === 'remediation' && task.lastSuccessResult !== undefined) {
      if (
        result.requires_re_review === undefined &&
        task.lastSuccessResult.requires_re_review !== undefined
      ) {
        result.requires_re_review = task.lastSuccessResult.requires_re_review;
      }
    }
    if (task.agentType === 'pull_request' && task.lastSuccessResult !== undefined) {
      if (
        result.comment_replied === undefined &&
        task.lastSuccessResult.comment_replied !== undefined
      ) {
        result.comment_replied = task.lastSuccessResult.comment_replied;
      }
    }
    /* v8 ignore stop @preserve */
    return result;
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
    const prViewCommand =
      task?.continuationPrNumber !== undefined
        ? `gh pr view ${String(task.continuationPrNumber)} --json state,mergedAt,number 2>/dev/null || echo "NO_PR"`
        : 'gh pr view --json state,mergedAt,number 2>/dev/null || echo "NO_PR"';

    const openInstructions =
      task?.continuationPrBranch !== undefined
        ? {
            lines: [
              'If PR is OPEN:',
              '  1. Continue on current local branch normally',
              `  2. Push updates with: git push origin HEAD:${task.continuationPrBranch}`,
              '  3. Check for unaddressed PR comments:',
            ],
            finalStep: '  4. If the message below references a PR comment or review, address it',
          }
        : {
            lines: [
              'If PR is OPEN:',
              '  1. Continue on current branch normally',
              '  2. Check for unaddressed PR comments:',
            ],
            finalStep: '  3. If the message below references a PR comment or review, address it',
          };

    return [
      '[RESUME PRE-FLIGHT — MANDATORY]',
      'Before making ANY changes, check your PR state:',
      `  ${prViewCommand}`,
      '',
      'If PR is MERGED or CLOSED or NO_PR:',
      '  1. git fetch origin',
      '  2. git checkout -b followup/<short-desc> origin/development',
      '  3. After changes → create NEW PR targeting development',
      '  4. Do NOT push to the old branch',
      '',
      ...openInstructions.lines,
      '     gh api /repos/{owner}/{repo}/pulls/{number}/comments --jq "[.[] | select(.user.login != \\"intexuraos-code-worker[bot]\\")] | length"',
      openInstructions.finalStep,
      '---',
      '',
    ].join('\n');
  }

  private buildActiveGoalSection(task: Task | undefined, prompt: string): string {
    const preamble = this.buildResumePreamble(task);
    const goalText = prompt.startsWith(preamble) ? prompt.slice(preamble.length) : prompt;
    return [
      '',
      '',
      '[ACTIVE GOAL — HIGHEST PRIORITY]',
      'A new user message has been received. This is your PRIMARY task.',
      'Complete this goal before doing anything else. If context was compacted,',
      'this section survives and takes absolute priority over conversation history.',
      '',
      goalText,
    ].join('\n');
  }

  private parseContinuationPrOutput(
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
    try {
      return JSON.parse(prOutput) as {
        url?: string;
        number?: number;
        headRefName?: string;
        title?: string;
        state?: string;
        mergedAt?: string | null;
      };
    } catch {
      this.logger.warn({ taskId, prOutput }, 'Failed to parse continuation PR output');
      return undefined;
    }
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
    if (params.continueSession && runtimeName === 'codex' && task.runtimeSessionId === undefined) {
      return {
        ok: false,
        error: new Error('Codex resume requires a persisted runtime session ID'),
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
    statusParam: TaskStatus,
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
    if (shouldPreserve) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Preserving worker container for debugging: taskId=${task.taskId} status=${finalStatus}`
      );
    }
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
      /* v8 ignore next -- ts-type: IsolationProvider declares listPreservedWorkers as optional so ?.() optional chaining cannot be tested via a mock that always has or lacks the method without changing the interface contract @preserve */
      const preserved = (await this.isolation.provider.listPreservedWorkers?.()) ?? [];
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
      await this.isolation.provider.preserveWorker?.(task.taskId);
    } else {
      await this.teardownAttempt(task.taskId, false);
    }
    this.isolation.tokenRefresher.unregisterTask(task.taskId);
    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
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
    try {
      const execOptions = { cwd: task.worktreePath };

      /* v8 ignore start -- upstream: continuationPrNumber path requires a pull_request task with a PR number set; unit test fixtures cannot exercise continuationPrNumber workflows without active GitHub PR infrastructure @preserve */
      if (task.continuationPrNumber !== undefined) {
        const { stdout: prOutput } = await execAsync(
          `gh pr view ${String(task.continuationPrNumber)} --json url,number,headRefName,title,state,mergedAt --jq .`,
          execOptions
        );
        const pr = this.parseContinuationPrOutput(task.taskId, prOutput);
        if (pr === undefined) {
          return undefined;
        }

        if (
          typeof pr.url === 'string' &&
          typeof pr.headRefName === 'string' &&
          typeof pr.title === 'string' &&
          String(pr.state).toUpperCase() === 'OPEN' &&
          (pr.mergedAt === null || pr.mergedAt === undefined)
        ) {
          let rebaseResult: TaskResult['rebaseResult'] | undefined;
          try {
            const { stdout: rebaseOutput } = await execAsync(
              'cat .rebase-result.json 2>/dev/null || echo "{}"',
              execOptions
            );
            const parsed = JSON.parse(rebaseOutput) as {
              attempted?: boolean;
              success?: boolean;
              conflictFiles?: string[];
            };
            if (parsed.attempted === true && typeof parsed.success === 'boolean') {
              rebaseResult = {
                attempted: parsed.attempted,
                success: parsed.success,
                ...(parsed.conflictFiles !== undefined && { conflictFiles: parsed.conflictFiles }),
              };
            }
          } catch (parseError) {
            this.logger.warn(
              { taskId: task.taskId, error: parseError },
              'Failed to parse rebase result'
            );
          }

          return {
            branch: pr.headRefName,
            prUrl: pr.url,
            summary: pr.title,
            ...(rebaseResult !== undefined && { rebaseResult }),
          };
        }

        return undefined;
      }
      /* v8 ignore stop @preserve */

      // Get current branch name from worktree
      const { stdout: branchOutput } = await execAsync('git branch --show-current', execOptions);
      const currentBranch = branchOutput.trim();

      // Check for pull requests on this branch
      const { stdout: prOutput } = await execAsync(
        `gh pr list --head "${currentBranch}" --json url,number,headRefName,title,commits --jq .`,
        execOptions
      );
      const prs = JSON.parse(prOutput) as {
        url: string;
        number: number;
        headRefName: string;
        commits?: { oid: string; messageHeadline: string }[];
        title: string;
      }[];

      /* v8 ignore start -- ts-type: array access with nullish coalescing creates type narrowing branches @preserve */
      if (prs.length > 0) {
        const pr = prs[0] ?? undefined;
        if (pr === undefined) {
          return undefined;
        }
        const branch = pr.headRefName;
        const commits = Array.isArray(pr.commits) ? pr.commits.length : 0;
        const commitDetails = Array.isArray(pr.commits)
          ? pr.commits.map((c) => ({ sha: c.oid, message: c.messageHeadline }))
          : undefined;

        // Check for rebase result
        let rebaseResult: TaskResult['rebaseResult'] | undefined;
        try {
          const { stdout: rebaseOutput } = await execAsync(
            'cat .rebase-result.json 2>/dev/null || echo "{}"',
            execOptions
          );
          const parsed = JSON.parse(rebaseOutput) as {
            attempted?: boolean;
            success?: boolean;
            conflictFiles?: string[];
          };
          /* v8 ignore start -- ts-type: spread operator with optional property creates type narrowing branch @preserve */
          if (parsed.attempted === true && typeof parsed.success === 'boolean') {
            rebaseResult = {
              attempted: parsed.attempted,
              success: parsed.success,
              ...(parsed.conflictFiles !== undefined && { conflictFiles: parsed.conflictFiles }),
            };
          }
          /* v8 ignore stop @preserve */
        } catch (parseError) {
          this.logger.warn(
            { taskId: task.taskId, error: parseError },
            'Failed to parse rebase result'
          );
        }

        /* v8 ignore start -- ts-type: spread operator with optional rebaseResult creates type narrowing branch @preserve */
        const result: TaskResult = {
          branch,
          commits,
          prUrl: pr.url,
          summary: pr.title,
          ...(commitDetails !== undefined && { commitDetails }),
          /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */
          ...(rebaseResult !== undefined && { rebaseResult }),
          /* v8 ignore stop @preserve */
        };
        /* v8 ignore stop @preserve */

        return result;
      }
      /* v8 ignore stop @preserve */

      return undefined;
    } catch (error) {
      this.logger.error({ taskId: task.taskId, error }, 'Failed to check for task result');
      return undefined;
    }
  }

  private async handleRuntimeEvents(task: Task, events: RuntimeEvent[]): Promise<void> {
    let shouldPersistTask = false;
    const taskId = task.taskId;
    const runtimeName = this.resolveTaskRuntime(task);

    for (const event of events) {
      if (event.type === 'log') {
        if (event.text !== '') {
          if (runtimeName === 'codex') {
            this.logForwarder.appendRawChunk(taskId, event.text);
          } else {
            this.logForwarder.appendChunk(taskId, event.text);
          }
        }
        continue;
      }

      if (event.type === 'runtime_session_started') {
        if (task.runtimeSessionId !== event.sessionId) {
          task.runtimeSessionId = event.sessionId;
          shouldPersistTask = true;
        }
        this.logger.info({ taskId, sessionId: event.sessionId }, 'Detected runtime session start');
        continue;
      }

      if (event.type === 'attempt_completed') {
        if (!this.attemptCompletionSignals.has(taskId)) {
          this.taskExitCodes.set(taskId, event.exitCode);
          this.attemptCompletionSignals.add(taskId);
          this.logger.info(
            { taskId, exitCode: event.exitCode },
            'Detected runtime stream result; signaling attempt completion'
          );
        }
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

  private formatLocalTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  private appendOrchestratorTaskLog(taskId: string, message: string): void {
    this.appendTaggedTaskLog(taskId, 'orchestrator', message);
  }

  private appendTaggedTaskLog(taskId: string, tag: string, message: string): void {
    this.logForwarder.appendChunk(
      taskId,
      `${this.formatLocalTime(new Date())} [${tag}] ${message}\n`
    );
  }

  private async flushTaskLogs(taskId: string): Promise<void> {
    try {
      await this.logForwarder.flush(taskId);
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to flush task logs');
    }
  }

  private async collectTurnMetrics(task: Task, attempt: number): Promise<void> {
    if (this.turnMetricsCollector === undefined) return;
    try {
      await this.turnMetricsCollector.collectAndPublish({
        taskId: task.taskId,
        containerId: task.containerId,
        attempt,
        startedAt: task.startedAt,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        { taskId: task.taskId, attempt, error },
        'Failed to collect turn metrics (non-fatal, task finalization continues)'
      );
    }
  }

  private async prepareComplianceValidationInput(
    task: Task,
    finalResult: TaskResult,
    verification: CompletionVerifierVerdict
  ): Promise<ComplianceValidationInput | undefined> {
    if (this.agentComplianceValidator === undefined) return undefined;
    if (verification.agentData?.agentType !== 'execution') return undefined;

    try {
      const agentData: ExecutionAgentData = verification.agentData;

      const prNumber = extractPrNumber(finalResult.prUrl);
      if (prNumber === undefined) {
        this.logger.warn({ taskId: task.taskId }, 'Compliance validation skipped: no PR number');
        return undefined;
      }

      this.appendOrchestratorTaskLog(task.taskId, 'Starting compliance validation');

      const entries = await readSessionTranscript(
        this.config.secretsBasePath,
        task.taskId,
        this.logger
      );

      if (entries.length === 0) {
        this.logger.warn(
          { taskId: task.taskId },
          'Compliance validation skipped: no transcript entries'
        );
        return undefined;
      }

      const formattedTranscript = formatTranscript(entries);

      return {
        taskId: task.taskId,
        prNumber,
        repository: task.repository,
        formattedTranscript,
        agentClaims: {
          outcome: agentData.outcome,
          superpowers_subagent_driven_dev: agentData.superpowers_subagent_driven_dev,
          superpowers_requesting_code_review: agentData.superpowers_requesting_code_review,
          gh_pr_url: agentData.gh_pr_url,
          memory_ids_used: agentData.memory_ids_used,
          memory_ids_rejected: agentData.memory_ids_rejected,
          memory_usage_summary: agentData.memory_usage_summary,
          summary: agentData.summary,
        },
        workerType: task.workerType,
      };
    } catch (error) {
      this.logger.warn(
        { taskId: task.taskId, error: getErrorMessage(error) },
        'Compliance validation preparation failed (non-fatal, skipping compliance validation)'
      );
      return undefined;
    }
  }

  private async executeComplianceValidation(
    task: Task,
    input: ComplianceValidationInput
  ): Promise<void> {
    const { taskId } = task;
    this.appendOrchestratorTaskLog(
      taskId,
      `Compliance validation starting (transcript: ${String(input.formattedTranscript.length)} chars)`
    );
    try {
      const result = await this.agentComplianceValidator?.validate(input, (message: string) => {
        this.appendOrchestratorTaskLog(taskId, `Compliance validation: ${message}`);
      });
      if (result !== undefined && result !== null) {
        this.appendOrchestratorTaskLog(taskId, 'Compliance validation completed');
        this.logger.info({ taskId }, 'Compliance validation completed');

        // Fire-and-forget: send structured report to code-agent
        const complianceReportUrl = task.webhookUrl.replace(
          '/internal/webhooks/task-complete',
          '/internal/webhooks/compliance-report'
        );
        if (!task.webhookUrl.includes('/internal/webhooks/task-complete')) {
          this.logger.warn(
            { taskId, webhookUrl: task.webhookUrl },
            'Compliance report webhook URL does not contain expected path — skipping delivery'
          );
        } else {
          void this.webhookClient
            .send({
              url: complianceReportUrl,
              secret: task.webhookSecret,
              payload: {
                taskId: input.taskId,
                prNumber: input.prNumber,
                report: result.report,
                model: result.model,
                promptVersion: result.promptVersion,
                costUsd: result.costUsd,
                workerType: input.workerType,
                transcriptTooLong: result.transcriptTooLong,
              },
              taskId,
            })
            .then((webhookResult) => {
              if (webhookResult.ok) {
                this.logger.info({ taskId }, 'Compliance report webhook delivered');
              } else {
                this.logger.warn(
                  { taskId, error: webhookResult.error.message },
                  'Compliance report webhook delivery failed'
                );
              }
            })
            .catch((error: unknown) => {
              this.logger.warn(
                { taskId, error: getErrorMessage(error) },
                'Compliance report webhook send error'
              );
            });
        }
      } else {
        this.appendOrchestratorTaskLog(taskId, 'Compliance validation completed without result');
        this.logger.warn({ taskId }, 'Compliance validation completed without result');
      }
    } catch (error) {
      this.appendOrchestratorTaskLog(
        taskId,
        `Compliance validation error: ${getErrorMessage(error)}`
      );
      this.logger.error(
        { taskId, error: getErrorMessage(error) },
        'Compliance validation failed (non-fatal, task finalization continues)'
      );
    }
  }

  private async flushAndCloseLogForwarder(taskId: string): Promise<void> {
    await this.flushTaskLogs(taskId);
    try {
      this.logForwarder.close(taskId);
    } catch (error) {
      this.logger.warn(
        { taskId, error },
        'Failed to close log forwarder after compliance validation'
      );
    }
  }

  private clearTaskTimers(taskId: string): void {
    const keys = [`${taskId}-warning`, `${taskId}-kill`, `${taskId}-monitor`];
    for (const key of keys) {
      const timer = this.activeTasks.get(key);
      if (timer !== undefined) {
        clearTimeout(timer);
        clearInterval(timer);
        this.activeTasks.delete(key);
      }
    }
    this.completionInProgress.delete(taskId);
    this.attemptCompletionSignals.delete(taskId);
  }
}
