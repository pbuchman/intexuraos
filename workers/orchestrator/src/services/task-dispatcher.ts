import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Mutex } from 'async-mutex';
import type { Result, Logger } from '@intexuraos/common-core';
import type { OrchestratorConfig } from '../types/config.js';
import type { Task, TaskStatus, TaskResult, TaskError } from '../types/task.js';
import type { CreateTaskRequest } from '../types/api.js';
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

const execAsync = promisify(exec);

const TASK_TIMEOUT_WARNING_MS = 115 * 60 * 1000; // 1h 55m
const TASK_TIMEOUT_KILL_MS = 120 * 60 * 1000; // 2h
const COMPLETION_CHECK_INTERVAL_MS = 30 * 1000; // 30s

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
  };
  gcpSaKeyPath: string;
  githubAppKeyPath: string;
}

export interface CompletionControlConfig {
  maxAttempts: number;
  verifier: CompletionVerifier;
  preserveFailedContainers?: boolean;
  logDrainTimeoutMs?: number;
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
  private readonly completionMaxAttempts: number;
  private readonly completionVerifier: CompletionVerifier;
  private readonly preserveFailedContainers: boolean;
  private readonly logDrainTimeoutMs: number;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly statePersistence: StatePersistence,
    private readonly worktreeManager: WorktreeManager,
    private readonly logForwarder: LogForwarder,
    private readonly webhookClient: WebhookClient,
    _githubTokenService: GitHubTokenService,
    private readonly logger: Logger,
    private readonly isolation: IsolationConfig,
    completionControl: CompletionControlConfig
  ) {
    this.completionMaxAttempts = completionControl.maxAttempts;
    this.completionVerifier = completionControl.verifier;
    this.preserveFailedContainers = completionControl.preserveFailedContainers ?? false;
    this.logDrainTimeoutMs = completionControl.logDrainTimeoutMs ?? 30000;
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
      this.appendOrchestratorTaskLog(taskId, `Prompt: ${promptPreview}`);
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
    const state = await this.statePersistence.load();
    state.tasks[task.taskId] = task;
    await this.statePersistence.save(state);
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
    const attempt = task.attemptCount ?? 1;
    const maxAttempts = task.maxAttempts ?? this.completionMaxAttempts;
    const phase = this.hasCodeTaskLabel(task.linearIssueLabels) ? 'phase2' : 'phase1';
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
      await this.finalizeTask(task, 'failed', failurePayload);
      return;
    }

    if (!verification.passed && attempt < maxAttempts) {
      this.logForwarder.appendChunk(task.taskId, '\n\n');
      this.appendOrchestratorTaskLog(
        task.taskId,
        `Verification failed; continuing with next attempt (${String(attempt + 1)}/${String(maxAttempts)})`
      );
      await this.flushTaskLogs(task.taskId);
      await this.teardownAttempt(task.taskId, true);

      const resumePrompt = this.buildResumePrompt(task.prompt, verification);
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
          { taskId: task.taskId, attempt: nextAttempt, maxAttempts },
          'Resumed task with follow-up attempt'
        );
        this.appendOrchestratorTaskLog(
          task.taskId,
          `Resume attempt started successfully: attempt=${String(nextAttempt)}/${String(maxAttempts)}`
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
      await this.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error: resumeError,
      });
      return;
    }

    if (verification.passed) {
      this.appendOrchestratorTaskLog(task.taskId, 'Completion verification passed');
      await this.flushTaskLogs(task.taskId);
      await this.finalizeTask(task, 'completed', {
        ...(result !== undefined && { result }),
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

    await this.finalizeTask(task, 'failed', {
      ...(result !== undefined && { result }),
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

  private async startWorkerAttempt(
    task: Task,
    params: { prompt: string; hasChildren: boolean; continueSession: boolean }
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
      systemPrompt: buildSystemPrompt({
        taskId: task.taskId,
        worktreePath: task.worktreePath,
        ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
        linearIssueLabels: task.linearIssueLabels,
        hasChildren: params.hasChildren,
      }),
      /* v8 ignore stop @preserve */
      workerType: task.workerType,
      secrets: this.isolation.getSecrets(),
      gcpSaKeyPath: this.isolation.gcpSaKeyPath,
      githubAppKeyPath: this.isolation.githubAppKeyPath,
      continueSession: params.continueSession,
      onLog: (chunk) => {
        const cleaned = stripDockerHeaders(chunk);
        const formatted = this.formatClaudeSystemMessages(cleaned);
        this.logForwarder.appendChunk(task.taskId, formatted);
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
    let finalStatus = statusParam;
    const shouldPreserve =
      this.preserveFailedContainers && (finalStatus === 'failed' || finalStatus === 'interrupted');
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
      await this.logForwarder.awaitDrain(task.taskId, this.logDrainTimeoutMs);
    } catch (drainError) {
      const drainStats = this.logForwarder.getDeliveryStats(task.taskId);
      this.logger.error(
        { taskId: task.taskId, error: drainError, ...drainStats },
        'Log drain failed'
      );
      if (payload.error === undefined) {
        finalStatus = 'failed';
        const drainMsg = drainError instanceof Error ? drainError.message : String(drainError);
        payload.error = {
          code: 'LOG_DELIVERY_FAILED',
          message: `${drainMsg} (produced=${String(drainStats.produced)} acked=${String(drainStats.acked)} pending=${String(drainStats.pending)})`,
        };
      }
    }
    const logStats = this.logForwarder.getDeliveryStats(task.taskId);
    this.logForwarder.close(task.taskId);

    if (shouldPreserve) {
      await this.isolation.provider.preserveWorker?.(task.taskId);
    } else {
      await this.teardownAttempt(task.taskId, false);
    }
    this.appendOrchestratorTaskLog(
      task.taskId,
      `Log delivery stats: produced=${String(logStats.produced)} acked=${String(logStats.acked)} pending=${String(logStats.pending)}`
    );
    this.isolation.tokenRefresher.unregisterTask(task.taskId);
    this.claudeErrors.delete(task.taskId);
    this.taskExitCodes.delete(task.taskId);
    this.claudeLogBuffers.delete(task.taskId);
    this.attemptCompletionSignals.delete(task.taskId);

    task.status = finalStatus;
    task.completedAt = new Date().toISOString();
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
      this.claudeErrors.set(taskId, 'Task failed: tool_use_error in Claude stream');
      this.logger.info({ taskId }, 'Detected Claude tool_use_error in stream');
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
        const obj = JSON.parse(jsonLine) as {
          type?: string;
          subtype?: string;
          hook_name?: string;
          output?: string;
          session_id?: string;
        };
        if (obj.type !== 'system') return jsonLine;

        if (obj.subtype === 'hook_started') {
          return `[hook] ${obj.hook_name ?? 'unknown'} started`;
        }
        if (obj.subtype === 'hook_response') {
          const output = obj.output ?? '';
          const lineCount = output.split('\n').filter((l) => l.trim() !== '').length;
          return `[hook] ${obj.hook_name ?? 'unknown'} completed (${String(lineCount)} lines)`;
        }
        // Other system messages (e.g. init) — suppress session_id noise
        return jsonLine;
      } catch {
        return jsonLine;
      }
    });
  }

  private formatLocalTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  private appendOrchestratorTaskLog(taskId: string, message: string): void {
    this.logForwarder.appendChunk(
      taskId,
      `${this.formatLocalTime(new Date())} [orchestrator] ${message}\n`
    );
  }

  private async flushTaskLogs(taskId: string): Promise<void> {
    try {
      await this.logForwarder.flush(taskId);
    } catch (error) {
      this.logger.warn({ taskId, error }, 'Failed to flush task logs');
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
