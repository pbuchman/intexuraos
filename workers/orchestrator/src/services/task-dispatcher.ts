import { exec, execFile } from 'node:child_process';
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
import { buildSystemPrompt } from './system-prompt.js';
import { stripDockerHeaders } from './log-formatter.js';
import {
  type CompletionAgentType,
  type CompletionVerifier,
  type CompletionVerifierVerdict,
  getLast50Lines,
} from './completion-verifier.js';
import type { TurnMetricsCollector } from './turn-metrics-collector.js';
import type { ExecutionDeepValidator, DeepValidationInput } from './execution-deep-validator.js';
import type { ExecutionAgentData } from './completion-verifier.js';
import { readSessionTranscript } from './transcript-reader.js';
import { formatTranscript } from './transcript-formatter.js';
import {
  extractPrNumber,
  fetchLinearIssueContextViaCodeAgent,
  readPlanFile,
} from './deep-validator-helpers.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function getTaskEventUrl(webhookUrl: string): string {
  return webhookUrl.replace('/internal/webhooks/task-complete', '/internal/webhooks/task-event');
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
  getSecrets: () => {
    ANTHROPIC_API_KEY: string;
    LINEAR_API_KEY: string;
    SENTRY_AUTH_TOKEN: string;
    MINIMAX_API_KEY: string;
    DASHSCOPE_API_KEY: string;
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
  private readonly claudeLogBuffers = new Map<string, string>();
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
    private readonly executionDeepValidator?: ExecutionDeepValidator
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

  async submitTask(request: CreateTaskRequest): Promise<Result<void, DispatchError>> {
    const healthErr = this.checkDockerAvailability();
    if (healthErr !== null) return healthErr;

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
        /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
        if (this.runningCount > 0) this.runningCount--;
        /* v8 ignore stop @preserve */
        await this.sendSetupFailureWebhook(request, 'Failed to create worktree', error);
        return;
      }

      this.logForwarder.registerTask(taskId, request.webhookSecret);

      if (request.agentType === 'execution' && request.planningPrBranch !== undefined) {
        const mergeResult = await this.worktreeManager.mergePlanningBranch(
          worktreePath,
          request.planningPrBranch
        );
        if (!mergeResult.ok) {
          this.logger.warn(
            { taskId, branch: request.planningPrBranch, error: mergeResult.error },
            'Failed to merge planning branch — proceeding without plan files'
          );
        }
      } else if (request.agentType === 'execution') {
        this.logger.info(
          { taskId },
          'No planning branch to merge — dispatched without planningPrBranch'
        );
      }

      const workerTypeConfig = WORKER_TYPES[request.workerType];
      if (workerTypeConfig.apiKeyEnvVar === 'ANTHROPIC_API_KEY') {
        const validation = await this.isolation.apiKeyValidator.validate('anthropic');
        if (!validation.valid) {
          /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
          if (this.runningCount > 0) this.runningCount--;
          /* v8 ignore stop @preserve */
          this.logForwarder.unregisterTask(taskId);
          await this.sendSetupFailureWebhook(
            request,
            `Anthropic API key is invalid: ${validation.errorMessage ?? 'authentication failed'}`,
            new Error('INVALID_API_KEY')
          );
          return;
        }
      }

      // Create task object
      const task: Task = {
        taskId,
        workerType: request.workerType,
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
        ...(request.trackingCommentId !== undefined && {
          trackingCommentId: request.trackingCommentId,
        }),
        ...(request.continuationPrNumber !== undefined && {
          continuationPrNumber: request.continuationPrNumber,
        }),
        ...(request.continuationPrBranch !== undefined && {
          continuationPrBranch: request.continuationPrBranch,
        }),
        ...(request.planningPrBranch !== undefined && {
          planningPrBranch: request.planningPrBranch,
        }),
        ...(request.planningPrUrl !== undefined && { planningPrUrl: request.planningPrUrl }),
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
        /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
        if (this.runningCount > 0) this.runningCount--;
        /* v8 ignore stop @preserve */
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
            : agentLabel === 'Execution Agent'
              ? 'Execution Agent \u2014 implement autonomously, run CI, create PR'
              : 'Planning Agent \u2014 create planning artifacts only, no implementation coding';
      /* v8 ignore stop @preserve */
      this.appendTaggedTaskLog(taskId, 'instructions', `${agentLabel}: ${agentDesc}`);
      this.logger.info({}, `Task started: id=${taskId} runningCount=${String(this.runningCount)}`);
    } catch (error) {
      /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
      if (this.runningCount > 0) this.runningCount--;
      /* v8 ignore stop @preserve */
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
      this.claudeLogBuffers.delete(taskId);
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
      /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
      if (this.runningCount > 0) this.runningCount--;
      /* v8 ignore stop @preserve */
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

  /* v8 ignore start -- test-infra: cannot unit-test without Docker, SSH, and state persistence infrastructure @preserve */
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
      return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
    }

    if (task.status === 'running') {
      const queue = this.pendingMessages.get(taskId) ?? [];
      queue.push(message);
      this.pendingMessages.set(taskId, queue);
      this.appendOrchestratorTaskLog(
        taskId,
        `Message queued (${String(queue.length)} pending): ${message.length > 200 ? message.slice(0, 200) + '\u2026' : message}`
      );
      this.logger.info({ taskId }, 'Message queued for running task');
      return { ok: true, value: { action: 'queued', pendingMessages: [...queue] } };
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') {
      const wasCompleted = task.status === 'completed';
      await this.teardownAttempt(taskId, true);

      // Register secret BEFORE any appendOrchestratorTaskLog calls, because
      // appendChunk creates a ForwardingState that captures the webhook secret
      // at creation time and never refreshes it.
      this.logForwarder.registerTask(taskId, task.webhookSecret);

      this.appendOrchestratorTaskLog(taskId, 'Resuming task with user message');
      this.appendTaggedTaskLog(
        taskId,
        'prompt',
        message.length > 200 ? message.slice(0, 200) + '\u2026' : message
      );

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
  /* v8 ignore stop @preserve */

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

  private async saveTask(task: Task): Promise<void> {
    await this.statePersistence.modify((state) => {
      state.tasks[task.taskId] = task;
    });
  }

  private async resumeTaskWithUserMessage(task: Task): Promise<void> {
    const prompt = task.pendingResumeStart?.prompt;
    /* v8 ignore start -- async-timing: sendMessage and recoverPendingResumeTask validate pendingResumeStart before invoking the async helper; this only guards against unexpected in-flight mutation @preserve */
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
    /* v8 ignore start -- test-infra: cannot trigger setTimeout callback with async task lookup in unit tests @preserve */
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          if (task !== null && task.status === 'running') {
            this.logger.warn({ taskId }, 'Task approaching 3-hour timeout');
          }
        } catch (error) {
          this.logger.error({ taskId, error }, 'Error in timeout warning callback');
        }
      })();
    }, TASK_TIMEOUT_WARNING_MS);
    /* v8 ignore stop @preserve */

    this.activeTasks.set(`${taskId}-warning`, timeout);
  }

  private scheduleTimeoutKill(taskId: string): void {
    /* v8 ignore start -- test-infra: cannot trigger setTimeout callback with complex async kill logic in unit tests @preserve */
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          if (task?.status !== 'running') {
            return;
          }

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
          this.claudeLogBuffers.delete(taskId);
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
          /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
          if (this.runningCount > 0) this.runningCount--;
          /* v8 ignore stop @preserve */
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
    /* v8 ignore stop @preserve */

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
    const completionAgentType: CompletionAgentType = isPullRequestTask
      ? 'pull_request'
      : task.agentType === 'review'
        ? 'review'
        : task.agentType === 'execution'
          ? 'execution'
          : task.agentType === 'planning'
            ? 'planning'
            : hasCodeTaskLabel(task.linearIssueLabels)
              ? 'execution'
              : 'planning';
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
    if (result !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Result: prUrl=${result.prUrl ?? 'none'} branch=${result.branch ?? 'none'} commits=${String(result.commits ?? 0)} ciFailed=${String(result.ciFailed ?? 'unknown')}`
      );
    }
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
    const firstLine = transcriptLines[0] ?? '';
    const lastLine = transcriptLines[transcriptLines.length - 1] ?? '';
    const transcriptSummary =
      transcriptLines.length <= 2
        ? transcriptLines.join('\n')
        : `${firstLine}\n  ... (${String(transcriptLines.length - 2)} lines omitted) ...\n${lastLine}`;
    this.appendOrchestratorTaskLog(
      task.taskId,
      `📋 Transcript (first + last):\n${transcriptSummary}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `🤖 Gemini summary: ${verification.agentData?.summary ?? '(no summary extracted)'}`
    );

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

    // Verification passed
    if (verification.passed && verification.agentData !== undefined) {
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

      this.appendOrchestratorTaskLog(task.taskId, 'Completion verification passed');
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      const finalResult = this.buildResultFromVerification(task, result, verification);

      // Deep validation for execution tasks: pre-read data before cleanup, then fire-and-forget
      let deepValInput: DeepValidationInput | undefined;
      if (completionAgentType === 'execution' && this.executionDeepValidator !== undefined) {
        deepValInput = await this.prepareDeepValidationInput(task, finalResult, verification);
      }

      const keepLogOpen = deepValInput !== undefined;
      await this.finalizeTaskWithResult(task, completionAgentType, finalResult, keepLogOpen);

      if (deepValInput !== undefined) {
        void this.executeDeepValidation(task.taskId, deepValInput).finally(() => {
          void this.flushAndCloseLogForwarder(task.taskId);
        });
      }
      return;
    }

    // Missing fields: re-launch Claude with adjusted prompt if attempts remain
    if (verification.missingFields.length > 0 && attempt < maxAttempts) {
      this.logForwarder.appendChunk(task.taskId, '\n\n');
      const nextAttempt = attempt + 1;
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Missing fields; re-launching Claude (${String(nextAttempt)}/${String(maxAttempts)}): ${verification.missingFields.join(', ')}`
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

    if (agentData.agentType === 'planning') {
      base.planning_outcome_label = agentData.outcome;
      base.planning_superpowers_writing_plans_used =
        agentData.superpowers_writing_plans === 'used' ? '1' : '0';
      base.planning_linear_url = agentData.linear_url;
      base.planning_is_complex = agentData.is_complex;
      base.planning_subtask_urls = agentData.subtask_urls;
      if (agentData.pr_url !== '') {
        base.planning_pr_url = agentData.pr_url;
      }
      base.planning_unclear_clarification = agentData.unclear_clarification;
    } else if (agentData.agentType === 'execution') {
      base.execution_outcome_label = agentData.outcome;
      base.execution_superpowers_executing_plans_used =
        agentData.superpowers_executing_plans === 'used' ? '1' : '0';
      base.execution_superpowers_requesting_code_review_used =
        agentData.superpowers_requesting_code_review === 'used' ? '1' : '0';
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
      base.review_comments_posted = agentData.review_comments_posted;
      base.review_types = agentData.review_types;
      base.requirements_tracker_updated = agentData.requirements_tracker_updated;
    } else {
      if (agentData.gh_pr_url !== '') {
        base.prUrl = agentData.gh_pr_url;
      }
      base.comment_replied = agentData.comments_replied === 'yes';
    }

    return base;
  }

  private enrichResultForResumedTask(
    task: Task,
    result: TaskResult | undefined // @allow-undefined-type -- function parameter, not optional property
  ): TaskResult | undefined {
    if (result === undefined) return undefined;
    if (task.agentType === 'execution' && task.linearIssueId !== undefined) {
      result.execution_linear_issue_url = `https://linear.app/pbuchman/issue/${task.linearIssueId}`;
    }
    if (task.agentType === 'review' && task.lastSuccessResult !== undefined) {
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
    }
    if (task.agentType === 'pull_request' && task.lastSuccessResult !== undefined) {
      if (
        result.comment_replied === undefined &&
        task.lastSuccessResult.comment_replied !== undefined
      ) {
        result.comment_replied = task.lastSuccessResult.comment_replied;
      }
    }
    return result;
  }

  private async finalizeTaskWithResult(
    task: Task,
    agentType: CompletionAgentType,
    finalResult: TaskResult,
    keepLogForwarderOpen = false
  ): Promise<void> {
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
    await this.finalizeTask(task, 'completed', { result: finalResult }, keepLogForwarderOpen);

    if (agentType === 'execution' && task.planningPrUrl !== undefined) {
      await this.closePlanningPr(task.planningPrUrl, task.taskId);
    }
  }

  private async closePlanningPr(prUrl: string, taskId: string): Promise<void> {
    try {
      const parsed = parsePrUrl(prUrl);
      if (parsed === undefined) {
        this.logger.warn({ prUrl, taskId }, 'Could not parse planning PR URL');
        return;
      }

      const comment = `Closed automatically — implementation completed in execution task ${taskId}`;
      await execFileAsync(
        'gh',
        [
          'pr',
          'close',
          String(parsed.number),
          '--repo',
          `${parsed.owner}/${parsed.repo}`,
          '--comment',
          comment,
        ],
        { cwd: this.config.worktreeBasePath }
      );

      this.logger.info(
        { prUrl, taskId, prNumber: parsed.number },
        'Planning PR closed after successful execution'
      );
    } catch (error: unknown) {
      /* v8 ignore start -- upstream: prior check guarantees error is caught, cannot simulate gh CLI process failure @preserve */
      const message = error instanceof Error ? error.message : 'Unknown error';
      /* v8 ignore stop @preserve */
      this.logger.warn(
        { prUrl, taskId, error: message },
        'Failed to close planning PR (best-effort)'
      );
    }
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
    const attempt = task.attemptCount ?? 1;

    this.logger.info(
      {},
      `Resumed-after-success completion: taskId=${task.taskId} attempt=${String(attempt)}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Resumed-after-success completion: using loosened verification (exit code + Claude error only)`
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

    const hasHardError =
      (typeof exitCode === 'number' && exitCode !== 0) || claudeError !== undefined;

    if (typeof exitCode === 'number') {
      task.lastExitCode = exitCode;
    } else {
      delete task.lastExitCode;
    }

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

    if (hasHardError) {
      const error: TaskError = {
        code: 'TASK_RESUMED_HARD_ERROR',
        message: [
          ...(typeof exitCode === 'number' && exitCode !== 0
            ? [`Non-zero exit code: ${String(exitCode)}`]
            : []),
          ...(claudeError !== undefined ? [`Claude error: ${claudeError}`] : []),
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

    // Check for pending messages before finalizing
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
    const workerTypeConfig = WORKER_TYPES[task.workerType];
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Worker config: type=${task.workerType} model=${workerTypeConfig.model ?? 'default'} apiUrl=${workerTypeConfig.apiBaseUrl}`
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
          ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
        }) +
        /* v8 ignore stop @preserve */
        (params.injectActiveGoal === true ? this.buildActiveGoalSection(task, params.prompt) : ''),
      workerType: task.workerType,
      secrets: this.isolation.getSecrets(),
      gcpSaKeyPath: this.isolation.gcpSaKeyPath,
      githubAppKeyPath: this.isolation.githubAppKeyPath,
      continueSession: params.continueSession,
      onLog: (chunk) => {
        const cleaned = stripDockerHeaders(chunk);
        const formatted = this.formatClaudeSystemMessages(cleaned);
        this.logForwarder.appendChunk(task.taskId, formatted);
        this.lastOutputAt.set(task.taskId, Date.now());
        this.detectClaudeError(task.taskId, cleaned);
      },
      onComplete: (exitCode) => {
        this.flushClaudeErrorBuffer(task.taskId);
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
    this.claudeLogBuffers.delete(task.taskId);
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

      this.appendOrchestratorTaskLog(
        task.taskId,
        `Worker start failed: ${error instanceof Error ? error.message : String(error)}`
      );
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
      message: `Failed to resume task: ${error instanceof Error ? error.message : String(error)}`,
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
      task.agentType === 'review' || task.agentType === 'pull_request';
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

    if (shouldPreserve) {
      await this.isolation.provider.preserveWorker?.(task.taskId);
    } else {
      await this.teardownAttempt(task.taskId, false);
    }
    this.isolation.tokenRefresher.unregisterTask(task.taskId);
    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
    this.claudeLogBuffers.delete(task.taskId);
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

    /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
    if (this.runningCount > 0) this.runningCount--;
    /* v8 ignore stop @preserve */
    this.clearTaskTimers(task.taskId);

    // Send task lifecycle event to code-agent (best-effort)
    const taskLifecycleEvent =
      finalStatus === 'completed'
        ? 'task_completed'
        : finalStatus === 'failed'
          ? 'task_failed'
          : finalStatus === 'interrupted'
            ? 'task_interrupted'
            : undefined;

    if (taskLifecycleEvent !== undefined) {
      const agentStatusMap: Record<string, string> = {
        execution: 'implemented',
        review: 'reviewed',
        planning: 'planned',
      };
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
      payload: {
        taskId: task.taskId,
        status: finalStatus,
        ...(payload.result !== undefined && { result: payload.result }),
        ...(payload.error !== undefined && { error: payload.error }),
        duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
        ...(payload.resumedCompletion === true && { resumedCompletion: true }),
      },
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

  private detectClaudeError(taskId: string, chunk: string): void {
    const buffered = `${this.claudeLogBuffers.get(taskId) ?? ''}${chunk}`;
    const lines = buffered.split('\n');
    const remainder = lines.pop() ?? '';
    this.claudeLogBuffers.set(taskId, remainder);

    for (const line of lines) {
      this.parseClaudeLogLine(taskId, line);
    }

    // Eagerly parse buffered remainder if it looks like a result line,
    // in case the exec stream stalls before delivering the trailing newline.
    if (remainder.includes('"type":"result"')) {
      try {
        const jsonStart = remainder.indexOf('{');
        if (jsonStart !== -1) {
          JSON.parse(remainder.slice(jsonStart));
          this.parseClaudeLogLine(taskId, remainder);
          this.claudeLogBuffers.set(taskId, '');
          return;
        }
      } catch {
        // Incomplete JSON — keep buffering.
      }
    }
  }

  private flushClaudeErrorBuffer(taskId: string): void {
    const remainder = this.claudeLogBuffers.get(taskId);
    if (remainder !== undefined && remainder.trim() !== '') {
      this.parseClaudeLogLine(taskId, remainder);
    }
    this.claudeLogBuffers.delete(taskId);
  }

  private parseClaudeLogLine(taskId: string, line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;

    if (trimmed.includes('<tool_use_error>')) {
      this.logger.warn(
        { taskId },
        'Claude tool_use_error in stream (non-fatal sibling call failure)'
      );
      return;
    }

    const jsonStart = trimmed.indexOf('{');
    if (jsonStart === -1) return;

    try {
      const obj = JSON.parse(trimmed.slice(jsonStart)) as {
        type?: string;
        is_error?: boolean;
        result?: string;
        error?: { message?: string };
      };
      if (obj.type === 'result') {
        if (!this.attemptCompletionSignals.has(taskId)) {
          this.taskExitCodes.set(taskId, obj.is_error === true ? 1 : 0);
          this.attemptCompletionSignals.add(taskId);
          this.logger.info(
            { taskId, isError: obj.is_error === true },
            'Detected Claude stream result; signaling attempt completion'
          );
        }
        if (obj.is_error === true) {
          const message = obj.result ?? obj.error?.message ?? 'Task failed';
          this.claudeErrors.set(taskId, message);
        }
      }
    } catch {
      // Ignore non-JSON stream lines.
    }
  }

  /**
   * Convert Claude Code JSON system messages into readable log lines.
   * Replaces hook_started/hook_response JSON blobs with concise summaries.
   * Strips redundant tool_use_result from user messages (bulk diffs).
   * Non-JSON lines pass through unchanged.
   */
  private formatClaudeSystemMessages(text: string): string {
    return text.replace(/^(\{.+\})$/gm, (jsonLine) => {
      try {
        const obj = JSON.parse(jsonLine) as Record<string, unknown>;
        const type = obj['type'] as string | undefined;

        if (type === 'system') {
          const subtype = obj['subtype'] as string | undefined;
          if (subtype === 'hook_started') {
            return `[hook] ${(obj['hook_name'] as string | undefined) ?? 'unknown'} started`;
          }
          if (subtype === 'hook_response') {
            const output = (obj['output'] as string | undefined) ?? '';
            const lineCount = output.split('\n').filter((l) => l.trim() !== '').length;
            return `[hook] ${(obj['hook_name'] as string | undefined) ?? 'unknown'} completed (${String(lineCount)} lines)`;
          }
          if (subtype === 'init') {
            return this.formatInitMessage(obj);
          }
          return jsonLine;
        }

        if (type === 'user' && 'tool_use_result' in obj) {
          delete obj['tool_use_result'];
          return JSON.stringify(obj);
        }

        if (type === 'rate_limit_event') {
          return this.formatRateLimitEvent(obj);
        }

        return jsonLine;
      } catch {
        return jsonLine;
      }
    });
  }

  private formatRateLimitEvent(obj: Record<string, unknown>): string {
    const info = (obj['rate_limit_info'] as Record<string, unknown> | undefined) ?? {};
    const status = (info['status'] as string | undefined) ?? 'unknown';
    const rateLimitType = (info['rateLimitType'] as string | undefined) ?? '';
    const resetsAt = info['resetsAt'] as number | undefined;
    const overageStatus = info['overageStatus'] as string | undefined;
    const overageDisabledReason = info['overageDisabledReason'] as string | undefined;

    const parts = [`[rate-limit] status=${status}`];
    if (rateLimitType !== '') parts.push(`type=${rateLimitType}`);
    if (resetsAt !== undefined) parts.push(`resets=${new Date(resetsAt * 1000).toISOString()}`);
    if (overageStatus !== undefined) parts.push(`overage=${overageStatus}`);
    if (overageDisabledReason !== undefined) parts.push(`reason=${overageDisabledReason}`);

    return parts.join(' ');
  }

  private formatInitMessage(obj: Record<string, unknown>): string {
    const model = (obj['model'] as string | undefined) ?? 'unknown';
    const tools = Array.isArray(obj['tools']) ? obj['tools'].length : 0;
    const mode = (obj['permissionMode'] as string | undefined) ?? 'unknown';
    const version = (obj['version'] as string | undefined) ?? '?';

    const mcpServers = Array.isArray(obj['mcp_servers'])
      ? (obj['mcp_servers'] as Record<string, unknown>[])
          .map((s) => {
            const name = (s['name'] as string | undefined) ?? '?';
            const status = (s['status'] as string | undefined) === 'connected' ? 'ok' : 'fail';
            return `${name}:${status}`;
          })
          .join(', ')
      : '';

    const mcpPart = mcpServers !== '' ? ` mcp=[${mcpServers}]` : '';
    return `[claude] Session init: model=${model} tools=${String(tools)}${mcpPart} mode=${mode} v${version}`;
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

  private async prepareDeepValidationInput(
    task: Task,
    finalResult: TaskResult,
    verification: CompletionVerifierVerdict
  ): Promise<DeepValidationInput | undefined> {
    if (this.executionDeepValidator === undefined) return undefined;
    if (verification.agentData?.agentType !== 'execution') return undefined;

    try {
      const agentData: ExecutionAgentData = verification.agentData;

      const prNumber = extractPrNumber(finalResult.prUrl);
      if (prNumber === undefined) {
        this.logger.warn({ taskId: task.taskId }, 'Deep validation skipped: no PR number');
        return undefined;
      }

      this.appendOrchestratorTaskLog(task.taskId, 'Starting deep validation');

      // Parallelize independent I/O: transcript reading and code-agent context fetch
      const [entries, codeAgentContext] = await Promise.all([
        readSessionTranscript(this.config.secretsBasePath, task.taskId, this.logger),
        task.linearIssueId !== undefined
          ? fetchLinearIssueContextViaCodeAgent(
              task.linearIssueId,
              {
                codeAgentUrl: this.config.codeAgentUrl,
                internalAuthToken: this.config.internalAuthToken,
              },
              this.logger
            )
          : Promise.resolve(undefined),
      ]);

      if (entries.length === 0) {
        this.logger.warn({ taskId: task.taskId }, 'Deep validation skipped: no transcript entries');
        return undefined;
      }

      const formattedTranscript = formatTranscript(entries);

      let linearIssueBody = this.buildLinearIssueSummary(task);
      let planContent: string | undefined;
      if (codeAgentContext !== undefined) {
        if (codeAgentContext.description !== null) {
          linearIssueBody = `${linearIssueBody}\n\nDescription:\n${codeAgentContext.description}`;
        }

        if (codeAgentContext.planDocumentPath !== null) {
          planContent = await readPlanFile(
            task.worktreePath,
            codeAgentContext.planDocumentPath,
            this.logger
          );
        }
      }

      return {
        taskId: task.taskId,
        prNumber,
        repository: task.repository,
        formattedTranscript,
        agentClaims: {
          outcome: agentData.outcome,
          superpowers_executing_plans: agentData.superpowers_executing_plans,
          superpowers_requesting_code_review: agentData.superpowers_requesting_code_review,
          gh_pr_url: agentData.gh_pr_url,
          summary: agentData.summary,
        },
        linearIssueBody,
        planContent,
      };
    } catch (error) {
      this.logger.warn(
        { taskId: task.taskId, error: getErrorMessage(error) },
        'Deep validation preparation failed (non-fatal, skipping deep validation)'
      );
      return undefined;
    }
  }

  private async executeDeepValidation(taskId: string, input: DeepValidationInput): Promise<void> {
    this.appendOrchestratorTaskLog(
      taskId,
      `Deep validation starting (transcript: ${String(input.formattedTranscript.length)} chars)`
    );
    try {
      const result = await this.executionDeepValidator?.validate(input, (message: string) => {
        this.appendOrchestratorTaskLog(taskId, `Deep validation: ${message}`);
      });
      if (result) {
        this.appendOrchestratorTaskLog(taskId, 'Deep validation comment posted');
        this.logger.info({ taskId }, 'Deep validation completed with comment posted');
      } else {
        this.appendOrchestratorTaskLog(taskId, 'Deep validation completed without comment');
        this.logger.warn({ taskId }, 'Deep validation completed without comment');
      }
    } catch (error) {
      this.appendOrchestratorTaskLog(taskId, `Deep validation error: ${getErrorMessage(error)}`);
      this.logger.error(
        { taskId, error: getErrorMessage(error) },
        'Deep validation failed (non-fatal, task finalization continues)'
      );
    }
  }

  private async flushAndCloseLogForwarder(taskId: string): Promise<void> {
    await this.flushTaskLogs(taskId);
    try {
      this.logForwarder.close(taskId);
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to close log forwarder after deep validation');
    }
  }

  private buildLinearIssueSummary(task: Task): string {
    const parts: string[] = [];
    if (task.linearIssueId !== undefined) parts.push(`Linear Issue: ${task.linearIssueId}`);
    if (task.linearIssueTitle !== undefined) parts.push(`Title: ${task.linearIssueTitle}`);
    if (task.linearIssueLabels.length > 0)
      parts.push(`Labels: ${task.linearIssueLabels.join(', ')}`);
    if (parts.length === 0) return 'No Linear issue linked';
    return parts.join('\n');
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

export function parsePrUrl(
  prUrl: string
): { owner: string; repo: string; number: number } | undefined {
  const match =
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl) ??
    /\/repos\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(prUrl);
  if (match === null) return undefined;
  return {
    owner: match[1] ?? '',
    repo: match[2] ?? '',
    number: Number(match[3] ?? '0'),
  };
}
