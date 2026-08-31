import type { Result } from '@intexuraos/common-core';
import type { Task } from '../../types/task.js';
import type { CreateTaskRequest } from '../../types/api.js';
import type { SendMessageResult, SendMessageError } from '../../types/schemas.js';
import type { DispatcherContext } from './dispatcher-context.js';
import type { AttemptLifecycle } from './attempt-lifecycle.js';
import type { DispatchError, CancelError } from '../task-dispatcher.js';
import { checkDockerAvailability, checkWorkerAuthAvailability } from './preflight.js';

/**
 * INT-1551 §E.6: public dispatcher operations extracted from the
 * TaskDispatcher class. Each function preserves its original behavior
 * verbatim — only the location moved.
 */

export async function submitTask(
  ctx: DispatcherContext,
  attemptLifecycle: AttemptLifecycle,
  request: CreateTaskRequest
): Promise<Result<void, DispatchError>> {
  const healthErr = checkDockerAvailability(ctx.isolation);
  if (healthErr !== null) return healthErr;

  const workerAuthErr = checkWorkerAuthAvailability(request.workerType, ctx.isolation);
  if (workerAuthErr !== null) return workerAuthErr;

  // Atomic capacity check
  const capacityCheck = await ctx.tryAcquireCapacitySlot();
  if (!capacityCheck.ok) {
    return capacityCheck;
  }

  // INT-1551 §E.7: track this fire-and-forget so graceful shutdown can drain it.
  void ctx.trackInFlight(
    attemptLifecycle
      .executeTaskSetup(request, (req) => ctx.getDefaultRepository(req))
      .catch((error: unknown) => {
        ctx.logger.error({ taskId: request.taskId, error }, 'Unhandled error in async task setup');
      })
  );

  return { ok: true, value: undefined };
}

export async function adoptTask(
  ctx: DispatcherContext,
  attemptLifecycle: AttemptLifecycle,
  task: Task
): Promise<Result<void, DispatchError>> {
  const healthErr = checkDockerAvailability(ctx.isolation);
  if (healthErr !== null) return healthErr;

  // Check if task is already at maxAttempts
  if ((task.attemptCount ?? 0) >= (task.maxAttempts ?? ctx.completionMaxAttempts)) {
    return {
      ok: false,
      error: { type: 'invalid_status', message: 'Task at max attempts' },
    };
  }

  // Atomic capacity check
  const capacityCheck = await ctx.tryAcquireCapacitySlot();
  if (!capacityCheck.ok) {
    return capacityCheck;
  }

  // Adoption may emit repair/finalization logs before the worker starts. Bind the
  // persisted task owner before any such append so no restored task can inherit
  // the orchestrator's static fallback callback route.
  try {
    ctx.logForwarder.registerTask(task.taskId, task.webhookSecret, task.webhookUrl);
  } catch (error) {
    ctx.releaseSlot();
    return {
      ok: false,
      error: {
        type: 'service_error',
        message: 'Failed to register adopted task log callback owner',
        originalError: error,
      },
    };
  }

  // INT-1454: Rehydrate worktree metadata before starting the container.
  // On orchestrator restart, `<repo>/.git/worktrees/<taskId>/` can disappear
  // while the bind-mounted worktree at `<base>/<taskId>/` survives. Without
  // repair, every `git` command inside the container fails with exit 128.
  const worktreeRehydrationError = await attemptLifecycle.rehydrateWorktreeForAdoption(task);
  if (worktreeRehydrationError !== null) {
    ctx.logForwarder.unregisterTask(task.taskId);
    return worktreeRehydrationError;
  }

  // Start worker attempt with continueSession: true
  const startResult = await ctx.startWorkerAttempt(task, {
    prompt: task.prompt,
    continueSession: true,
  });

  if (!startResult.ok) {
    ctx.releaseSlot();
    ctx.isolation.tokenRefresher.unregisterTask(task.taskId);
    ctx.logForwarder.unregisterTask(task.taskId);
    await ctx.isolation.provider.cleanupTaskSession?.(task.taskId);
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
  await ctx.saveTask(task);

  // INT-1585: re-arm timers with task's per-task timeoutMs after restart adoption.
  ctx.scheduleTimeoutWarning(task.taskId, task.timeoutMs);
  ctx.scheduleTimeoutKill(task.taskId, task.timeoutMs);
  ctx.startCompletionMonitoring(task.taskId);

  ctx.appendOrchestratorTaskLog(
    task.taskId,
    `Task adopted after restart: attempt=${String(task.attemptCount)}/${String(task.maxAttempts ?? ctx.completionMaxAttempts)} containerId=${task.containerId}`
  );

  ctx.logger.info(
    {
      taskId: task.taskId,
      attemptCount: task.attemptCount,
      containerId: startResult.containerId,
    },
    `Task adopted: id=${task.taskId} attempt=${String(task.attemptCount)}/${String(task.maxAttempts ?? ctx.completionMaxAttempts)}`
  );

  return { ok: true, value: undefined };
}

export async function cancelTask(
  ctx: DispatcherContext,
  taskId: string
): Promise<Result<void, CancelError>> {
  const state = await ctx.statePersistence.load();
  const task = state.tasks[taskId];

  if (task === undefined) {
    return { ok: false, error: { type: 'not_found', message: 'Task not found' } };
  }

  if (task.status !== 'running') {
    return { ok: false, error: { type: 'already_completed', message: 'Task already completed' } };
  }

  try {
    // Kill Docker container - destroyWorker handles graceful + force kill
    await ctx.isolation.provider.destroyWorker(taskId);

    try {
      await ctx.logForwarder.flushAndStop(taskId);
    } catch (flushError: unknown) {
      ctx.logger.error({ taskId, error: flushError }, 'Failed to flush logs during cancellation');
    }
    ctx.logForwarder.unregisterTask(taskId);
    ctx.isolation.tokenRefresher.unregisterTask(taskId);
    ctx.claudeErrors.delete(taskId);
    ctx.taskExitCodes.delete(taskId);
    ctx.attemptStartedAt.delete(taskId);
    ctx.attemptCompletionSignals.delete(taskId);
    ctx.completionInProgress.delete(taskId);
    ctx.pendingMessages.delete(taskId);
    ctx.lastOutputAt.delete(taskId);
    await ctx.isolation.provider.cleanupTaskSession?.(taskId);

    // Update task status
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    await ctx.saveTask(task);

    // Decrease running count
    ctx.releaseSlot();
    ctx.clearTaskTimers(taskId);

    // Send webhook
    await ctx.webhookClient.send({
      url: task.webhookUrl,
      secret: task.webhookSecret,
      payload: {
        taskId,
        status: 'cancelled',
        duration: new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime(),
      },
      taskId,
    });

    ctx.logger.info({ taskId }, 'Task cancelled');

    return { ok: true, value: undefined };
  } catch (error) {
    return {
      ok: false,
      error: { type: 'service_error', message: 'Failed to cancel task', originalError: error },
    };
  }
}

export async function sendMessage(
  ctx: DispatcherContext,
  attemptLifecycle: AttemptLifecycle,
  taskId: string,
  message: string
): Promise<Result<SendMessageResult, SendMessageError>> {
  const loadResult = await ctx.statePersistence.load().catch((error: unknown) => {
    ctx.logger.error({ taskId, error }, 'Failed to load state persistence');
    return null;
  });
  if (loadResult === null) {
    return { ok: false, error: { type: 'service_error', message: 'Failed to load task state' } };
  }
  const task = loadResult.tasks[taskId];

  if (task === undefined) {
    const recovered = await attemptLifecycle.tryRecoverMissingTask(taskId, message);
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
    const queue = ctx.pendingMessages.get(taskId) ?? [];
    queue.push(message);
    ctx.pendingMessages.set(taskId, queue);
    /* v8 ignore start -- source-map: ternary inside template literal misattributed by v8; truncation branch covered by test but not tracked by coverage @preserve */
    ctx.appendOrchestratorTaskLog(
      taskId,
      `Message queued (${String(queue.length)} pending): ${message.length > 200 ? message.slice(0, 200) + '…' : message}`
    );
    /* v8 ignore stop @preserve */
    ctx.logger.info({ taskId }, 'Message queued for running task');
    return { ok: true, value: { action: 'queued', pendingMessages: [...queue] } };
  }

  if (task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted') {
    // Check if the worktree exists — a container can be recreated, but a worktree cannot.
    // If the container is gone but worktree exists, createWorker(continueSession=true) will
    // create a fresh container. If the worktree is also gone, reject — user must retry.
    const hasWorktree = await ctx.worktreeManager.worktreeExists(taskId);
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
    const canResume = (await ctx.isolation.provider.isResumeAvailable?.(taskId)) ?? true;
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
    await ctx.teardownAttempt(taskId, true);

    // Register secret BEFORE any appendOrchestratorTaskLog calls, because
    // appendChunk creates a ForwardingState that captures the webhook secret
    // at creation time and never refreshes it.
    ctx.logForwarder.registerTask(taskId, task.webhookSecret, task.webhookUrl);

    ctx.appendOrchestratorTaskLog(taskId, 'Resuming task with user message');
    /* v8 ignore start -- source-map: ternary inside function argument misattributed by v8; truncation branch covered by test but not tracked by coverage @preserve */
    ctx.appendTaggedTaskLog(
      taskId,
      'prompt',
      message.length > 200 ? message.slice(0, 200) + '…' : message
    );
    /* v8 ignore stop @preserve */

    const prompt =
      task.agentType === 'ask_agent' ? message : ctx.buildResumePreamble(task) + message;
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
    await ctx.saveTask(task);

    ctx.incrementRunningCount();
    // INT-1551 §E.7: track resume so shutdown can wait for it to settle.
    void ctx.trackInFlight(
      attemptLifecycle.resumeTaskWithUserMessage(task).catch((error: unknown) => {
        void attemptLifecycle.failAcceptedResume(task, error);
      })
    );
    ctx.logger.info({ taskId }, 'Task resume accepted with user message');
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
