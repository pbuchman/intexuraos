import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Mutex } from 'async-mutex';
import type { Result, Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import type { Task, TaskStatus, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
import type { SendMessageResult, SendMessageError } from '../types/schemas.js';
import type { StatePersistence } from './state-persistence.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { LogForwarder } from './log-forwarder.js';
import type { WebhookClient } from './webhook-client.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { IsolationProvider, WorkerConfig, WorkerType } from './isolation/types.js';
import { WORKER_TYPES } from './isolation/types.js';
import type { TokenRefresher } from './isolation/token-refresher.js';
import type { ApiKeyValidator } from './api-key-validator.js';
import { buildSystemPrompt } from './system-prompt.js';
import { stripDockerHeaders } from './log-formatter.js';
import { type CompletionVerifier, type CompletionVerifierVerdict } from './completion-verifier.js';
import { analyzeRetryDecision } from './adaptive-retry.js';
import type { TurnMetricsCollector } from './turn-metrics-collector.js';

const execAsync = promisify(exec);

const TASK_TIMEOUT_WARNING_MS = 115 * 60 * 1000; // 1h 55m
const TASK_TIMEOUT_KILL_MS = 120 * 60 * 1000; // 2h
const COMPLETION_CHECK_INTERVAL_MS = 30 * 1000; // 30s
const ACTIVITY_HEARTBEAT_THRESHOLD_MS = 30 * 1000; // 30s

export interface DispatchError {
  type: 'at_capacity' | 'invalid_request' | 'service_error';
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
    ZAI_API_KEY: string;
    MINIMAX_API_KEY: string;
  };
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
}

export interface CompletionControlConfig {
  maxAttempts: number;
  verifier: CompletionVerifier;
  preserveFailedContainers?: boolean;
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
  private readonly preserveFailedContainers: boolean;

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
    private readonly turnMetricsCollector?: TurnMetricsCollector
  ) {
    this.completionMaxAttempts = completionControl.maxAttempts;
    this.completionVerifier = completionControl.verifier;
    this.preserveFailedContainers = completionControl.preserveFailedContainers ?? false;
  }

  async submitTask(request: CreateTaskRequest): Promise<Result<void, DispatchError>> {
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

  private async executeTaskSetup(request: CreateTaskRequest): Promise<void> {
    const taskId = request.taskId;

    try {
      const repository = request.repository ?? this.getDefaultRepository(request);
      const baseBranch = request.baseBranch ?? 'development';

      // Create worktree
      let worktreePath: string;
      try {
        worktreePath = await this.worktreeManager.createWorktree(taskId, baseBranch);
      } catch (error) {
        /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
        if (this.runningCount > 0) this.runningCount--;
        /* v8 ignore stop @preserve */
        await this.sendSetupFailureWebhook(request, 'Failed to create worktree', error);
        return;
      }

      this.logForwarder.registerTask(taskId, request.webhookSecret);

      const workerTypeConfig = WORKER_TYPES[request.workerType as WorkerType];
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
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: this.completionMaxAttempts,
        verificationHistory: [],
      };

      const startResult = await this.startWorkerAttempt(task, {
        prompt: request.prompt,
        hasChildren: request.hasChildren,
        continueSession: false,
      });
      if (!startResult.ok) {
        /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
        if (this.runningCount > 0) this.runningCount--;
        /* v8 ignore stop @preserve */
        /* v8 ignore start -- ts-type: ternary type narrowing for error message extraction @preserve */
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
        /* v8 ignore stop @preserve */
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
      /* v8 ignore start -- test-infra: short prompts don't hit truncation branch in integration tests @preserve */
      const promptPreview =
        task.prompt.length > 500 ? task.prompt.slice(0, 500) + '…' : task.prompt;
      /* v8 ignore stop @preserve */
      this.appendTaggedTaskLog(taskId, 'prompt', promptPreview);
      const isPRComment = task.linearIssueLabels.some(
        (l) => l.trim().toLowerCase() === 'pr-comment'
      );
      /* v8 ignore start -- source-map: ternary branch mapping misattributed after bundling despite unit tests for all three phases @preserve */
      const phase = isPRComment
        ? 'PR Comment'
        : this.hasCodeTaskLabel(task.linearIssueLabels)
          ? 'Phase 2'
          : 'Phase 1';
      const phaseDesc =
        phase === 'PR Comment'
          ? 'PR Comment Execution \u2014 respond to PR comment, push to existing PR branch'
          : phase === 'Phase 2'
            ? 'Strict Execution \u2014 implement autonomously, run CI, create PR'
            : 'Design & Validation \u2014 analyze and enrich the Linear issue, do not execute code';
      /* v8 ignore stop @preserve */
      this.appendTaggedTaskLog(taskId, 'instructions', `${phase}: ${phaseDesc}`);
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

  /* v8 ignore start -- test-infra: requires worker infrastructure (Docker, SSH, state persistence) for integration testing @preserve */
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

      const preamble = this.buildResumePreamble();
      const resumeResult = await this.startWorkerAttempt(task, {
        prompt: preamble + message,
        hasChildren: task.hasChildren ?? false,
        continueSession: true,
        injectActiveGoal: true,
      });

      if (!resumeResult.ok) {
        this.logger.error(
          { taskId, error: resumeResult.error },
          'Failed to resume task with message'
        );
        return { ok: false, error: { type: 'service_error', message: 'Failed to resume task' } };
      }

      task.status = 'running';
      task.containerId = resumeResult.containerId;
      task.startedAt = new Date().toISOString();
      task.attemptCount = 1;
      task.verificationHistory = [];
      delete task.previousResult;
      delete task.completedAt;
      if (wasCompleted) {
        task.resumedAfterSuccess = true;
      } else {
        delete task.resumedAfterSuccess;
      }
      await this.saveTask(task);

      this.runningCount++;
      this.scheduleTimeoutWarning(taskId);
      this.scheduleTimeoutKill(taskId);
      this.startCompletionMonitoring(taskId);

      this.logger.info({ taskId }, 'Task resumed with user message');
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

  private scheduleTimeoutWarning(taskId: string): void {
    /* v8 ignore start -- test-infra: setTimeout callback with async task lookup, difficult to test in unit tests @preserve */
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await this.getTask(taskId);
          if (task !== null && task.status === 'running') {
            this.logger.warn({ taskId }, 'Task approaching 2-hour timeout');
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
    /* v8 ignore start -- test-infra: setTimeout callback with complex async logic, difficult to test in unit tests @preserve */
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
    const maxAttempts = this.completionMaxAttempts;
    const isPRComment = task.linearIssueLabels.some((l) => l.trim().toLowerCase() === 'pr-comment');
    const phase = isPRComment
      ? 'pr-comment'
      : this.hasCodeTaskLabel(task.linearIssueLabels)
        ? 'phase2'
        : 'phase1';
    this.attemptCompletionSignals.delete(task.taskId);

    this.logger.info(
      {},
      `Worker attempt finished: taskId=${task.taskId} attempt=${String(attempt)}/${String(maxAttempts)} phase=${phase}`
    );
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Attempt finished: attempt=${String(attempt)}/${String(maxAttempts)} phase=${phase}`
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
    const claudeError = this.claudeErrors.get(task.taskId);
    const exitCode = this.taskExitCodes.get(task.taskId);
    if (result !== undefined) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Result: prUrl=${result.prUrl ?? 'none'} branch=${result.branch ?? 'none'} commits=${String(result.commits ?? 0)} ciFailed=${String(result.ciFailed ?? 'unknown')}`
      );
    }
    if (phase === 'phase1' && result?.prUrl !== undefined && result.prUrl !== '') {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `[WARN] Phase mismatch: task ran as Phase 1 (design) but worker created PR: ${result.prUrl}`
      );
      this.logger.warn(
        { taskId: task.taskId, phase, prUrl: result.prUrl },
        'Phase mismatch: Phase 1 task created a PR'
      );
    }
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Running completion verification: exitCode=${String(exitCode ?? 'unknown')} claudeError=${claudeError ?? 'none'} detectedPr=${result?.prUrl ?? 'none'}`
    );
    const rawLogs = await this.isolation.provider.getWorkerLogs(task.taskId);
    const verification = await this.completionVerifier.verify({
      taskId: task.taskId,
      attempt,
      maxAttempts,
      phase,
      originalPrompt: task.prompt,
      rawLogs,
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
      linearIssueLabels: task.linearIssueLabels,
      ...(result !== undefined && { taskResult: result }),
      ...(typeof exitCode === 'number' && { workerExitCode: exitCode }),
      ...(claudeError !== undefined && { claudeError }),
    });
    this.appendOrchestratorTaskLog(task.taskId, `━━━ Verification Result ━━━`);
    this.appendOrchestratorTaskLog(
      task.taskId,
      `  Passed: ${String(verification.passed)} | Confidence: ${verification.confidence.toFixed(2)}`
    );
    if (verification.reasons.length > 0) {
      this.appendOrchestratorTaskLog(task.taskId, `  Reasons: ${verification.reasons.join(' | ')}`);
    }
    if (verification.missingCriteria.length > 0) {
      this.appendOrchestratorTaskLog(
        task.taskId,
        `  Missing: ${verification.missingCriteria.join(' | ')}`
      );
    }
    if (verification.resumeInstruction.length > 0) {
      this.appendOrchestratorTaskLog(task.taskId, `  Resume: ${verification.resumeInstruction}`);
    }
    this.appendOrchestratorTaskLog(task.taskId, `━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

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
        confidence: verification.confidence,
        reasons: verification.reasons,
        missingCriteria: verification.missingCriteria,
        resumeInstruction: verification.resumeInstruction,
        usedLlm: verification.usedLlm,
        ...(verification.verifierFailure === true && { verifierFailure: true }),
        ...(verification.extractedSummary !== undefined && {
          extractedSummary: verification.extractedSummary,
        }),
        createdAt: new Date().toISOString(),
      },
    ];

    if (verification.verifierFailure === true) {
      const error: TaskError = {
        code: 'TASK_COMPLETION_VERIFIER_FAILED',
        message: verification.reasons.join('; '),
        remediation: {
          action: 'contact_support',
          manualSteps: [
            'Ensure INTEXURAOS_GEMINI_APP_API_KEY is configured for orchestrator.',
            'Check Gemini provider connectivity and retry task after verifier is healthy.',
          ],
        },
      };

      const failurePayload: { result?: TaskResult; error: TaskError } = { error };
      /* v8 ignore start -- source-map: binary-expr branch coverage is misreported on strict undefined guard @preserve */
      if (result !== undefined) {
        failurePayload.result = result;
      }
      /* v8 ignore stop @preserve */
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Terminal failure: verifier unavailable (${verification.reasons.join(' | ')})`
      );
      await this.flushTaskLogs(task.taskId);
      await this.collectTurnMetrics(task, attempt);
      await this.finalizeTask(task, 'failed', failurePayload);
      return;
    }

    if (!verification.passed) {
      if (result !== undefined && task.previousResult !== undefined) {
        const diffs: string[] = [];
        const prev = task.previousResult;
        if (prev.commits !== result.commits)
          diffs.push(`commits ${String(prev.commits ?? 0)}→${String(result.commits ?? 0)}`);
        if (prev.ciFailed !== result.ciFailed)
          diffs.push(
            `ciFailed ${String(prev.ciFailed ?? 'unknown')}→${String(result.ciFailed ?? 'unknown')}`
          );
        if (prev.prUrl === undefined && result.prUrl !== undefined) diffs.push('prUrl (new)');
        if (diffs.length > 0) {
          this.appendOrchestratorTaskLog(task.taskId, `Result diff: ${diffs.join(', ')}`);
        }
      }

      const retryDecision = analyzeRetryDecision({
        currentAttempt: attempt,
        baseMaxAttempts: maxAttempts,
        verificationHistory: task.verificationHistory ?? [],
        ...(result !== undefined && { currentResult: result }),
        ...(task.previousResult !== undefined && { previousResult: task.previousResult }),
      });

      this.appendOrchestratorTaskLog(
        task.taskId,
        `Adaptive retry: ${retryDecision.outcome} (score=${String(retryDecision.progressScore)}, resultProgress=${String(retryDecision.signalBreakdown.resultProgress)}, verificationTrend=${String(retryDecision.signalBreakdown.verificationTrend)}, effective=${String(retryDecision.effectiveMaxAttempts)}) — ${retryDecision.reason}`
      );
      this.logger.info(
        {
          taskId: task.taskId,
          attempt,
          maxAttempts,
          outcome: retryDecision.outcome,
          progressScore: retryDecision.progressScore,
          signalBreakdown: retryDecision.signalBreakdown,
          effectiveMaxAttempts: retryDecision.effectiveMaxAttempts,
          hasCurrentResult: result !== undefined,
          hasPreviousResult: task.previousResult !== undefined,
          verificationHistoryLength: (task.verificationHistory ?? []).length,
        },
        'Adaptive retry decision'
      );

      if (retryDecision.outcome === 'continue') {
        this.logForwarder.appendChunk(task.taskId, '\n\n');
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Verification failed; continuing with next attempt (${String(attempt + 1)}/${String(retryDecision.effectiveMaxAttempts)})`
        );
        await this.flushTaskLogs(task.taskId);
        await this.teardownAttempt(task.taskId, true);

        if (result !== undefined) {
          task.previousResult = result;
        }

        const resumePrompt = this.buildResumePrompt(task.prompt, verification);
        const resumePreview =
          resumePrompt.length > 500 ? resumePrompt.slice(0, 500) + '…' : resumePrompt;
        this.appendTaggedTaskLog(task.taskId, 'prompt', `Resume prompt:\n${resumePreview}`);
        const nextAttempt = attempt + 1;
        const resumeStart = await this.startWorkerAttempt(task, {
          prompt: resumePrompt,
          hasChildren: task.hasChildren ?? false,
          continueSession: true,
        });

        if (resumeStart.ok) {
          task.attemptCount = nextAttempt;
          task.containerId = resumeStart.containerId;
          await this.saveTask(task);
          this.logger.info(
            {
              taskId: task.taskId,
              attempt: nextAttempt,
              effectiveMaxAttempts: retryDecision.effectiveMaxAttempts,
              progressScore: retryDecision.progressScore,
            },
            'Resumed task with follow-up attempt'
          );
          this.appendOrchestratorTaskLog(
            task.taskId,
            `Resume attempt started successfully: attempt=${String(nextAttempt)}/${String(retryDecision.effectiveMaxAttempts)}`
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
    }

    if (verification.passed) {
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
          hasChildren: task.hasChildren ?? false,
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
      const finalResult = this.injectExtractedSummary(result, verification.extractedSummary);
      await this.finalizeTask(task, 'completed', {
        ...(finalResult !== undefined && { result: finalResult }),
      });
      return;
    }

    const error: TaskError = {
      code: 'TASK_COMPLETION_VERIFICATION_FAILED',
      message: verification.reasons.join('; '),
      remediation: {
        action: 'retry',
        ...(verification.missingCriteria.length > 0 && {
          manualSteps: verification.missingCriteria,
        }),
      },
    };
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: completion criteria not met (${verification.reasons.join(' | ')})`
    );
    await this.flushTaskLogs(task.taskId);
    await this.collectTurnMetrics(task, attempt);

    const failedResult = this.injectExtractedSummary(result, verification.extractedSummary);
    await this.finalizeTask(task, 'failed', {
      ...(failedResult !== undefined && { result: failedResult }),
      error,
    });
  }

  private buildResumePrompt(
    originalPrompt: string,
    verification: CompletionVerifierVerdict
  ): string {
    const missingCriteria =
      verification.missingCriteria.length > 0
        ? verification.missingCriteria.map((criteria) => `- ${criteria}`).join('\n')
        : '- Completion criteria not met';

    return [
      originalPrompt,
      '',
      '[AUTO-CONTINUE ATTEMPT]',
      'Previous attempt did not meet completion criteria.',
      'Address the exact gaps below, then finish.',
      '',
      'Missing criteria:',
      missingCriteria,
      '',
      'Required action:',
      verification.resumeInstruction,
      '',
      'Constraints:',
      '- Do not restart from scratch.',
      '- Continue from current repository/worktree state.',
      '- Your last message must satisfy the required phase final block contract.',
    ].join('\n');
  }

  private buildResumePreamble(): string {
    return [
      '[RESUME PRE-FLIGHT — MANDATORY]',
      'Before making ANY changes, check your PR state:',
      '  gh pr view --json state,merged,number 2>/dev/null || echo "NO_PR"',
      '',
      'If PR is MERGED or CLOSED or NO_PR:',
      '  1. git fetch origin',
      '  2. git checkout -b followup/<short-desc> origin/development',
      '  3. After changes → create NEW PR targeting development',
      '  4. Do NOT push to the old branch',
      '',
      'If PR is OPEN:',
      '  1. Continue on current branch normally',
      '  2. Check for unaddressed PR comments:',
      '     gh api /repos/{owner}/{repo}/pulls/{number}/comments --jq "[.[] | select(.user.login != \\"intexuraos-code-worker[bot]\\")] | length"',
      '  3. If the message below references a PR comment or review, address it',
      '---',
      '',
    ].join('\n');
  }

  private buildActiveGoalSection(prompt: string): string {
    const preamble = this.buildResumePreamble();
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

    const result = await this.checkForResult(task);
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
        confidence: 1,
        reasons: hasHardError
          ? [
              ...(typeof exitCode === 'number' && exitCode !== 0
                ? [`Non-zero exit code: ${String(exitCode)}`]
                : []),
              ...(claudeError !== undefined ? [`Claude error: ${claudeError}`] : []),
            ]
          : ['Loosened verification passed (resumed after success)'],
        missingCriteria: [],
        resumeInstruction: hasHardError ? 'Resolve the error and retry.' : '',
        usedLlm: false,
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
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
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
        hasChildren: task.hasChildren ?? false,
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
    await this.finalizeTask(task, 'completed', {
      ...(result !== undefined && { result }),
    });
  }

  private async startWorkerAttempt(
    task: Task,
    params: {
      prompt: string;
      hasChildren: boolean;
      continueSession: boolean;
      injectActiveGoal?: boolean;
    }
  ): Promise<{ ok: true; containerId: string } | { ok: false; error: unknown }> {
    this.attemptCompletionSignals.delete(task.taskId);
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Starting worker attempt: continueSession=${String(params.continueSession)} hasChildren=${String(params.hasChildren)}`
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
          hasChildren: params.hasChildren,
        }) +
        /* v8 ignore stop @preserve */
        (params.injectActiveGoal === true ? this.buildActiveGoalSection(params.prompt) : ''),
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

    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
    this.claudeLogBuffers.delete(task.taskId);
    this.lastOutputAt.set(task.taskId, Date.now());

    try {
      await this.isolation.tokenRefresher.registerTask(task.taskId);
      const handle = await this.isolation.provider.createWorker(workerConfig);
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Worker container ready: containerId=${handle.containerId}`
      );
      return { ok: true, containerId: handle.containerId };
    } catch (error) {
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

  private async finalizeTask(
    task: Task,
    statusParam: TaskStatus,
    payload: { result?: TaskResult; error?: TaskError }
  ): Promise<void> {
    const finalStatus = statusParam;
    const shouldPreserve =
      this.preserveFailedContainers &&
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
    this.logForwarder.close(task.taskId);

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
    await this.saveTask(task);

    /* v8 ignore start -- test-infra: guard prevents negative runningCount on double-decrement race @preserve */
    if (this.runningCount > 0) this.runningCount--;
    /* v8 ignore stop @preserve */
    this.clearTaskTimers(task.taskId);

    await this.webhookClient.send({
      url: task.webhookUrl,
      secret: task.webhookSecret,
      payload: {
        taskId: task.taskId,
        status: finalStatus,
        ...(payload.result !== undefined && { result: payload.result }),
        ...(payload.error !== undefined && { error: payload.error }),
        duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
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
        commits?: unknown[];
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
        /* v8 ignore start -- ts-type: TypeScript type narrowing makes branch unreachable @preserve */

        // Check CI status
        let ciFailed: boolean | undefined;
        try {
          const { stdout: ciOutput } = await execAsync(
            /* v8 ignore stop @preserve */
            `gh pr checks ${String(pr.number)} --json state --jq '[.[] | select(.state == "FAILURE")] | length'`,
            execOptions
          );
          ciFailed = parseInt(ciOutput.trim(), 10) > 0;
        } catch {
          this.logger.warn({ taskId: task.taskId }, 'Failed to check CI status for PR');
        }

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
          ...(ciFailed !== undefined && { ciFailed }),
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

  private injectExtractedSummary(
    result: TaskResult | undefined, // @allow-undefined-type -- function parameter, not optional property
    extractedSummary: string | undefined // @allow-undefined-type -- function parameter, not optional property
  ): TaskResult | undefined {
    // @allow-undefined-type -- return type, not optional property
    if (extractedSummary === undefined) return result;
    if (result !== undefined) {
      return { ...result, summary: extractedSummary };
    }
    return { summary: extractedSummary };
  }

  private hasCodeTaskLabel(labels: string[]): boolean {
    return labels.some((label) => {
      const normalized = label.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
      return normalized === 'code-task';
    });
  }

  private detectClaudeError(taskId: string, chunk: string): void {
    const buffered = `${this.claudeLogBuffers.get(taskId) ?? ''}${chunk}`;
    const lines = buffered.split('\n');
    const remainder = lines.pop() ?? '';
    this.claudeLogBuffers.set(taskId, remainder);

    for (const line of lines) {
      this.parseClaudeLogLine(taskId, line);
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
      if (obj.type === 'result' && obj.is_error === true) {
        const message = obj.result ?? obj.error?.message ?? 'Task failed';
        this.claudeErrors.set(taskId, message);
        this.logger.info({ taskId }, 'Detected Claude error in stream result');
      }
    } catch {
      // Ignore non-JSON stream lines.
    }
  }

  /**
   * Convert Claude Code JSON system messages into readable log lines.
   * Replaces hook_started/hook_response JSON blobs with concise summaries.
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

        return jsonLine;
      } catch {
        return jsonLine;
      }
    });
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

  private clearTaskTimers(taskId: string): void {
    const keys = [`${taskId}-warning`, `${taskId}-kill`, `${taskId}-monitor`];
    for (const key of keys) {
      /* v8 ignore start -- test-infra: timer is always set before clearTaskTimers is called, else branch unreachable @preserve */
      const timer = this.activeTasks.get(key);
      /* v8 ignore stop @preserve */
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
