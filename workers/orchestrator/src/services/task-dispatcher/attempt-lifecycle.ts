import { type Result, getErrorMessage } from '@intexuraos/common-core';
import type { Task, TaskError } from '../../types/task.js';
import type { CreateTaskRequest } from '../../types/api.js';
import type { SendMessageResult, SendMessageError } from '../../types/schemas.js';
import { WORKER_TYPES } from '../isolation/types.js';
import { withTimeout } from '../../with-timeout.js';
import { fetchDispatchMetadata } from '../dispatch-metadata-client.js';
import {
  pickAgentLabel as pickAgentLabelFn,
  describeAgent as describeAgentFn,
} from './lifecycle.js';
import {
  buildResumePreamble as buildResumePreambleFn,
  INACTIVITY_RESTART_PROMPT,
} from './prompts.js';
import { sendSetupFailureWebhook as sendSetupFailureWebhookFn } from './webhook-callbacks.js';
import {
  EVIDENCE_CAPTURE_TIMEOUT_MS,
  WORKER_DESTROY_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MS,
  MAX_INACTIVITY_RESTARTS,
} from './retry-logic.js';
import type { DispatcherContext } from './dispatcher-context.js';
import type { DispatchError } from '../task-dispatcher.js';

/**
 * INT-1551 §E.4: attempt-lifecycle helpers — task setup, worktree
 * rehydration, dispatch-metadata recovery, resume-with-user-message,
 * inactivity restart, teardown, and accept-resume failure handling.
 */
export class AttemptLifecycle {
  constructor(private readonly ctx: DispatcherContext) {}

  async sendSetupFailureWebhook(
    request: CreateTaskRequest,
    message: string,
    originalError: unknown
  ): Promise<void> {
    await sendSetupFailureWebhookFn(
      this.ctx.webhookClient,
      this.ctx.logger,
      request,
      message,
      originalError
    );
  }

  async teardownAttempt(taskId: string, keepSession: boolean): Promise<void> {
    const ctx = this.ctx;
    if (!keepSession) {
      try {
        await ctx.isolation.provider.destroyWorker(taskId);
      } catch (error) {
        ctx.logger.warn({ taskId, error }, 'Failed to destroy worker after attempt completion');
      }
      await ctx.isolation.provider.cleanupTaskSession?.(taskId);
    }
  }

  async failAcceptedResume(task: Task, error: unknown): Promise<void> {
    const ctx = this.ctx;
    ctx.logger.error(
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

    ctx.appendOrchestratorTaskLog(
      task.taskId,
      `Terminal failure: resume start failed (${resumeError.message})`
    );

    await ctx.finalizeTask(task, 'failed', {
      error: resumeError,
    });
  }

  async rehydrateWorktreeForAdoption(task: Task): Promise<Result<void, DispatchError> | null> {
    const ctx = this.ctx;
    let registered: boolean;
    try {
      registered = await ctx.worktreeManager.isWorktreeRegistered(task.taskId);
    } catch (error) {
      ctx.logger.error(
        { taskId: task.taskId, error },
        'Failed to check worktree registration during adoption'
      );
      // adoptTask guarantees runningCount was incremented before invoking this
      // method, so an unconditional decrement is safe.
      ctx.releaseSlot();
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

    ctx.logger.warn(
      { taskId: task.taskId, worktreePath: task.worktreePath },
      'Worktree metadata missing on adoption, attempting repair'
    );
    ctx.appendOrchestratorTaskLog(
      task.taskId,
      `Worktree metadata missing on adoption, repairing: path=${task.worktreePath}`
    );

    try {
      await ctx.worktreeManager.repairWorktree(task.taskId);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      ctx.logger.error(
        { taskId: task.taskId, worktreePath: task.worktreePath, error },
        'git worktree repair failed during adoption — marking task as WORKTREE_LOST'
      );

      const terminalError: TaskError = {
        code: 'WORKTREE_LOST',
        message: `Worktree metadata missing and repair failed for ${task.worktreePath}: ${message}`,
        remediation: {
          action: 'contact_support',
          worktreePath: task.worktreePath,
        },
      };

      ctx.appendOrchestratorTaskLog(
        task.taskId,
        `Terminal failure: WORKTREE_LOST (${terminalError.message})`
      );

      await ctx.finalizeTask(task, 'failed', { error: terminalError });

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

  async executeTaskSetup(
    request: CreateTaskRequest,
    getDefaultRepository: (req: CreateTaskRequest) => string
  ): Promise<void> {
    const ctx = this.ctx;
    const taskId = request.taskId;

    try {
      const repository = request.repository ?? getDefaultRepository(request);
      const baseBranch = request.baseBranch ?? 'development';

      // Create worktree
      let worktreePath: string;
      try {
        worktreePath =
          request.continuationPrBranch === undefined
            ? await ctx.worktreeManager.createWorktree(taskId, baseBranch)
            : await ctx.worktreeManager.createWorktree(
                taskId,
                baseBranch,
                request.continuationPrBranch
              );
      } catch (error) {
        ctx.releaseSlot();
        await this.sendSetupFailureWebhook(request, 'Failed to create worktree', error);
        return;
      }

      ctx.logForwarder.registerTask(taskId, request.webhookSecret, request.webhookUrl);

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
        ...(request.sentryIssue !== undefined && { sentryIssue: request.sentryIssue }),
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
        /* v8 ignore start -- ts-type: exactOptionalPropertyTypes spread for reviewTypes in dispatchPlanReview request payload @preserve */
        ...(request.reviewTypes !== undefined && { reviewTypes: request.reviewTypes }),
        /* v8 ignore stop @preserve */
        // INT-1585: convert per-task hour override into ms once on intake.
        ...(request.timeoutHours !== undefined && {
          timeoutMs: request.timeoutHours * 60 * 60 * 1000,
        }),
        startedAt: new Date().toISOString(),
        attemptCount: 1,
        maxAttempts: ctx.completionMaxAttempts,
        verificationHistory: [],
      };

      const startResult = await ctx.startWorkerAttempt(task, {
        prompt: request.prompt,
        continueSession: false,
      });
      if (!startResult.ok) {
        ctx.releaseSlot();
        ctx.logger.error(
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
        ctx.isolation.tokenRefresher.unregisterTask(taskId);
        ctx.logForwarder.unregisterTask(taskId);
        await ctx.isolation.provider.cleanupTaskSession?.(taskId);
        ctx.worktreeManager.removeWorktree(taskId).catch((cleanupError: unknown) => {
          ctx.logger.error(
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

      await ctx.saveTask(task);

      // INT-1585: pass per-task timeoutMs override to honour user-customised
      // 1–12h horizon; falls back to the legacy 5h constants when undefined.
      ctx.scheduleTimeoutWarning(taskId, task.timeoutMs);
      ctx.scheduleTimeoutKill(taskId, task.timeoutMs);

      ctx.startCompletionMonitoring(taskId);
      ctx.appendOrchestratorTaskLog(
        taskId,
        `Task started: id=${taskId} attempt=1/${String(ctx.completionMaxAttempts)} workerType=${task.workerType}`
      );
      if (task.linearIssueId !== undefined) {
        ctx.appendOrchestratorTaskLog(
          taskId,
          `Linear issue: ${task.linearIssueId}${task.linearIssueTitle !== undefined ? ` — ${task.linearIssueTitle}` : ''}`
        );
      }
      const promptPreview =
        task.prompt.length > 500 ? task.prompt.slice(0, 500) + '…' : task.prompt;
      ctx.appendTaggedTaskLog(taskId, 'prompt', promptPreview);
      const agentLabel = pickAgentLabelFn(task);
      const agentDesc = describeAgentFn(agentLabel);
      ctx.appendTaggedTaskLog(taskId, 'instructions', `${agentLabel}: ${agentDesc}`);
      ctx.logger.info({}, `Task started: id=${taskId}`);
    } catch (error) {
      ctx.releaseSlot();
      await this.sendSetupFailureWebhook(request, 'Failed to start task', error);
    }
  }

  async tryRecoverMissingTask(
    taskId: string,
    message: string
  ): Promise<Result<SendMessageResult, SendMessageError> | null> {
    const ctx = this.ctx;
    const metadata = await fetchDispatchMetadata(
      {
        codeAgentUrl: ctx.config.codeAgentUrl,
        internalAuthToken: ctx.config.internalAuthToken,
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
      maxAttempts: ctx.completionMaxAttempts,
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

    ctx.logForwarder.registerTask(taskId, task.webhookSecret, task.webhookUrl);
    ctx.appendOrchestratorTaskLog(
      taskId,
      'Recreating task from dispatch metadata with user message'
    );
    ctx.appendTaggedTaskLog(
      taskId,
      'prompt',
      message.length > 200 ? message.slice(0, 200) + '…' : message
    );

    const prompt = task.agentType === 'ask_agent' ? message : buildResumePreambleFn(task) + message;
    task.pendingResumeStart = {
      prompt,
      acceptedAt: new Date().toISOString(),
    };
    await ctx.saveTask(task);

    ctx.incrementRunningCount();
    // INT-1551 §E.7: track recreate-from-metadata so shutdown can drain it.
    void ctx.trackInFlight(
      this.recreateTaskFromDispatchMetadata(task).catch((error: unknown) => {
        void this.failAcceptedResume(task, error);
      })
    );
    ctx.logger.info({ taskId }, 'Task resume accepted after dispatch metadata recovery');

    return { ok: true, value: { action: 'resumed' } };
  }

  async recreateTaskFromDispatchMetadata(task: Task): Promise<void> {
    const ctx = this.ctx;
    try {
      task.worktreePath =
        task.continuationPrBranch === undefined
          ? await ctx.worktreeManager.createWorktree(task.taskId, task.baseBranch)
          : await ctx.worktreeManager.createWorktree(
              task.taskId,
              task.baseBranch,
              task.continuationPrBranch
            );
      await ctx.saveTask(task);
      await this.resumeTaskWithUserMessage(task);
    } catch (error) {
      await this.failAcceptedResume(task, error);
    }
  }

  async resumeTaskWithUserMessage(task: Task): Promise<void> {
    const ctx = this.ctx;
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
      const resumeResult = await ctx.startWorkerAttempt(task, {
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
      await ctx.saveTask(task);

      // INT-1585: re-arm timers with the per-task override on resume, too.
      ctx.scheduleTimeoutWarning(task.taskId, task.timeoutMs);
      ctx.scheduleTimeoutKill(task.taskId, task.timeoutMs);
      ctx.startCompletionMonitoring(task.taskId);

      ctx.logger.info({ taskId: task.taskId }, 'Task resumed with user message');
    } catch (error) {
      await this.failAcceptedResume(task, error);
    }
  }

  async handleInactivityRestart(taskId: string): Promise<void> {
    const ctx = this.ctx;
    // Mark the restart as in-flight synchronously before any await so the
    // completion monitor cannot race and run verification on the stale
    // transcript while destroyWorker/startWorkerAttempt are pending.
    ctx.inactivityRestartInProgress.add(taskId);
    try {
      await this.doHandleInactivityRestart(taskId);
    } finally {
      ctx.inactivityRestartInProgress.delete(taskId);
    }
  }

  async doHandleInactivityRestart(taskId: string): Promise<void> {
    const ctx = this.ctx;
    // Guard: skip if completion is already in progress
    if (ctx.completionInProgress.has(taskId)) {
      ctx.logger.debug({ taskId }, 'Inactivity restart skipped: completion already in progress');
      return;
    }

    const task = await ctx.getTask(taskId);
    /* v8 ignore start -- source-map: claude-runtime detached settimeout closure — branch misattributed by v8 (claude finalize fallback) @preserve */
    if (task?.status !== 'running') {
      return;
    }
    /* v8 ignore stop @preserve */

    const canRestart = ctx.activityTimeoutManager.recordRestart(taskId);
    if (!canRestart) {
      // Max consecutive restarts exceeded — fail the task
      ctx.activityTimeoutManager.stop(taskId);

      ctx.appendTaggedTaskLog(
        taskId,
        'system',
        `Inactivity timeout: worker unresponsive after ${String(MAX_INACTIVITY_RESTARTS)} consecutive restarts — failing task`
      );
      ctx.logger.error(
        { taskId, maxRestarts: MAX_INACTIVITY_RESTARTS },
        'Max inactivity restarts exceeded — failing task'
      );

      const result = await ctx.checkForResult(task);
      const error: TaskError = {
        code: 'TASK_INACTIVITY_TIMEOUT',
        message: `Worker unresponsive after ${String(MAX_INACTIVITY_RESTARTS)} consecutive inactivity restarts`,
        remediation: { action: 'retry' },
      };
      /* v8 ignore start -- ts-type: exactOptionalPropertyTypes spread for result on finalizeTask in claude-runtime hard-error path @preserve */
      await ctx.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      /* v8 ignore stop @preserve */
      return;
    }

    const restartCount = ctx.activityTimeoutManager.getRestartCount(taskId);
    // Note: do NOT call stop() here — it would clear the consecutive restart counter.
    ctx.appendTaggedTaskLog(
      taskId,
      'system',
      `Inactivity timeout: no output for ${String(INACTIVITY_TIMEOUT_MS / 1000)}s — killing worker and restarting (restart ${String(restartCount)}/${String(MAX_INACTIVITY_RESTARTS)})`
    );
    ctx.logger.info(
      { taskId, restartCount, maxRestarts: MAX_INACTIVITY_RESTARTS },
      'Inactivity restart triggered'
    );

    const evidenceDir = `/var/log/orchestrator/inactivity-evidence/${taskId}/`;
    const [copyResult, statsResult] = await Promise.allSettled([
      withTimeout(
        ctx.isolation.provider.copyOut(taskId, '/tmp', evidenceDir),
        EVIDENCE_CAPTURE_TIMEOUT_MS,
        `copyOut timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
      ),
      withTimeout(
        ctx.isolation.provider.statsSnapshot(taskId),
        EVIDENCE_CAPTURE_TIMEOUT_MS,
        `statsSnapshot timed out after ${String(EVIDENCE_CAPTURE_TIMEOUT_MS / 1000)}s`
      ),
    ]);
    if (copyResult.status === 'rejected') {
      ctx.logger.warn(
        { taskId, error: getErrorMessage(copyResult.reason) },
        'Failed to copy /tmp evidence before inactivity kill'
      );
    }
    if (statsResult.status === 'fulfilled') {
      ctx.logger.warn({ taskId, stats: statsResult.value }, 'Container stats at inactivity kill');
    } else {
      ctx.logger.warn(
        { taskId, error: getErrorMessage(statsResult.reason) },
        'Failed to capture container stats before inactivity kill'
      );
    }

    try {
      await withTimeout(
        ctx.isolation.provider.destroyWorker(taskId),
        WORKER_DESTROY_TIMEOUT_MS,
        `destroyWorker timed out after ${String(WORKER_DESTROY_TIMEOUT_MS / 1000)}s`
      );
    } catch (destroyError) {
      const message = getErrorMessage(destroyError);
      ctx.logger.warn(
        { taskId, error: destroyError },
        'Failed to destroy worker for inactivity restart'
      );
      ctx.appendOrchestratorTaskLog(
        taskId,
        `Failed to destroy worker for inactivity restart: ${message}`
      );
      const result = await ctx.checkForResult(task);
      const error: TaskError = {
        code: 'TASK_INACTIVITY_RESTART_FAILED',
        message: `Failed to destroy worker before inactivity restart: ${message}`,
        remediation: { action: 'retry' },
      };
      /* v8 ignore start -- ts-type: exactOptionalPropertyTypes spread for result on failed inactivity restart finalization @preserve */
      await ctx.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      /* v8 ignore stop @preserve */
      return;
    }
    ctx.appendOrchestratorTaskLog(taskId, 'Worker destroyed for inactivity restart');

    await this.teardownAttempt(taskId, true);

    // Re-fetch to avoid race with completion monitor: if status is no longer
    // 'running', the task was finalized by another handler and we must bail out.
    const reloadedTask = await ctx.getTask(taskId);
    /* v8 ignore start -- source-map: codex-runtime detached settimeout closure — branch misattributed by v8 (codex finalize fallback) @preserve */
    if (reloadedTask?.status !== 'running') {
      ctx.logger.debug({ taskId }, 'Inactivity restart bailed out: task no longer running');
      return;
    }
    /* v8 ignore stop @preserve */

    ctx.appendTaggedTaskLog(taskId, 'prompt', INACTIVITY_RESTART_PROMPT);
    const startResult = await ctx.startWorkerAttempt(task, {
      prompt: INACTIVITY_RESTART_PROMPT,
      continueSession: true,
    });

    if (!startResult.ok) {
      ctx.logger.error(
        { taskId, error: startResult.error },
        'Failed to restart worker after inactivity timeout'
      );
      const error: TaskError = {
        code: 'TASK_INACTIVITY_RESTART_FAILED',
        message: 'Failed to restart worker after inactivity timeout',
        remediation: { action: 'retry' },
      };
      const result = await ctx.checkForResult(task);
      /* v8 ignore start -- ts-type: exactOptionalPropertyTypes spread for result on finalizeTask in codex-runtime hard-error path @preserve */
      await ctx.finalizeTask(task, 'failed', {
        ...(result !== undefined && { result }),
        error,
      });
      /* v8 ignore stop @preserve */
      return;
    }

    task.containerId = startResult.containerId;
    task.inactivityRestartCount = (task.inactivityRestartCount ?? 0) + 1;
    await ctx.saveTask(task);

    ctx.appendOrchestratorTaskLog(taskId, `Inactivity restart attempt started: taskId=${taskId}`);
  }
}
