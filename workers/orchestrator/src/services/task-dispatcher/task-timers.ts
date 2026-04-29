import { withTimeout } from '../../with-timeout.js';
import {
  clearTaskTimers as clearTaskTimersFn,
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  COMPLETION_CHECK_INTERVAL_MS,
  ACTIVITY_HEARTBEAT_THRESHOLD_MS,
  WORKER_DESTROY_TIMEOUT_MS,
} from './retry-logic.js';
import type { DispatcherContext } from './dispatcher-context.js';

/**
 * INT-1551 §E.3: timer/monitor lifecycle helpers.
 *
 * - `scheduleTimeoutWarning`: best-effort 4h55m warning log.
 * - `scheduleTimeoutKill`: hard 5h kill that bypasses `finalizeTask`
 *   (intentional — preserves the standalone teardown semantics; see
 *   `.claude/reference` and inventory note 3).
 * - `startCompletionMonitoring`: 30s poll on `isWorkerRunning` plus
 *   `attemptCompletionSignals`; once a completion is detected (worker
 *   exited or runtime stream said `attempt_completed`), it routes through
 *   the dispatcher-supplied `handleTaskCompletion` callback.
 * - `clearTaskTimers`: cancel all per-task timers + clear transient flags.
 *
 * The class accepts a `DispatcherContext` and uses its
 * `handleTaskCompletion` / `checkForResult` / `getTask` / `saveTask` hooks
 * to bridge back to the dispatcher (the completion pipeline still lives in
 * `TaskDispatcher` for now).
 */
export class TaskTimers {
  constructor(private readonly ctx: DispatcherContext) {}

  scheduleTimeoutWarning(taskId: string): void {
    const ctx = this.ctx;
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await ctx.getTask(taskId);
          /* v8 ignore start -- source-map: claude-runtime detached settimeout closure — branch misattributed by v8 (claude success notify path) @preserve */
          if (task !== null && task.status === 'running') {
            ctx.logger.warn({ taskId }, 'Task approaching 5-hour timeout');
          }
          /* v8 ignore stop @preserve */
        } catch (error) {
          ctx.logger.error({ taskId, error }, 'Error in timeout warning callback');
        }
      })();
    }, TASK_TIMEOUT_WARNING_MS);

    ctx.activeTasks.set(`${taskId}-warning`, timeout);
    // INT-1551 §E.7: cancel pending warning if shutdown signal fires.
    this.attachShutdownAbort(timeout, false);
  }

  scheduleTimeoutKill(taskId: string): void {
    const ctx = this.ctx;
    const timeout = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const task = await ctx.getTask(taskId);
          /* v8 ignore start -- source-map: claude-runtime detached settimeout closure — branch misattributed by v8 (claude failure notify path) @preserve */
          if (task?.status !== 'running') {
            return;
          }
          /* v8 ignore stop @preserve */

          ctx.logger.warn({ taskId }, 'Task timeout - killing');

          // Stop inactivity timeout early to prevent restart during hard kill
          ctx.activityTimeoutManager.stop(taskId);

          // Kill Docker container. Bound by WORKER_DESTROY_TIMEOUT_MS so an
          // unresponsive docker daemon cannot wedge this callback and leave
          // the task in 'running' status indefinitely.
          try {
            await withTimeout(
              ctx.isolation.provider.destroyWorker(taskId),
              WORKER_DESTROY_TIMEOUT_MS,
              `destroyWorker timed out after ${String(WORKER_DESTROY_TIMEOUT_MS / 1000)}s`
            );
          } catch (destroyError) {
            ctx.logger.error(
              { taskId, error: destroyError },
              'Failed to destroy worker during timeout kill'
            );
          }

          try {
            await ctx.logForwarder.flushAndStop(taskId);
          } catch (flushError: unknown) {
            ctx.logger.error(
              { taskId, error: flushError },
              'Failed to flush logs during timeout kill'
            );
          }
          ctx.logForwarder.unregisterTask(taskId);
          ctx.isolation.tokenRefresher.unregisterTask(taskId);
          ctx.claudeErrors.delete(taskId);
          ctx.taskExitCodes.delete(taskId);
          ctx.attemptStartedAt.delete(taskId);
          ctx.attemptCompletionSignals.delete(taskId);
          ctx.completionInProgress.delete(taskId);
          ctx.lastOutputAt.delete(taskId);
          await ctx.isolation.provider.cleanupTaskSession?.(taskId);

          // Check for PR
          const result = await ctx.checkForResult(task);

          // Update task
          task.status = 'interrupted';
          task.completedAt = new Date().toISOString();
          await ctx.saveTask(task);

          // Decrease running count
          ctx.releaseSlot();
          this.clearTaskTimers(taskId);

          // Send webhook
          await ctx.webhookClient.send({
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
          ctx.logger.error({ taskId, error }, 'Error in timeout kill callback');
        }
      })();
    }, TASK_TIMEOUT_KILL_MS);

    ctx.activeTasks.set(`${taskId}-kill`, timeout);
    // INT-1551 §E.7: cancel pending kill timer if shutdown signal fires.
    this.attachShutdownAbort(timeout, false);
  }

  startCompletionMonitoring(taskId: string): void {
    const ctx = this.ctx;
    const checkInterval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const task = await ctx.getTask(taskId);
          if (task?.status !== 'running') {
            this.clearTaskTimers(taskId);
            return;
          }

          // Check if Docker container is still running
          const isRunning = await ctx.isolation.provider.isWorkerRunning(taskId);
          const attemptCompleted = ctx.attemptCompletionSignals.has(taskId);

          // Emit activity heartbeat when no Docker output for threshold duration
          const lastActivity = ctx.lastOutputAt.get(taskId);
          if (isRunning && lastActivity !== undefined) {
            const silenceMs = Date.now() - lastActivity;
            if (silenceMs >= ACTIVITY_HEARTBEAT_THRESHOLD_MS) {
              const silenceSeconds = Math.round(silenceMs / 1000);
              ctx.appendTaggedTaskLog(
                taskId,
                'system',
                `Still processing... no output for ${String(silenceSeconds)}s`
              );
            }
          }

          if (!isRunning || attemptCompleted) {
            if (ctx.completionInProgress.has(taskId)) {
              return;
            }
            // Skip: an inactivity restart is mid-flight (old worker destroyed,
            // new one not yet up). Running completion now would verify on the
            // stale transcript of the killed session.
            if (ctx.inactivityRestartInProgress.has(taskId)) {
              ctx.logger.debug(
                { taskId },
                'Completion monitor tick skipped: inactivity restart in progress'
              );
              return;
            }
            ctx.completionInProgress.add(taskId);
            try {
              await ctx.handleTaskCompletion(task);
            } finally {
              ctx.completionInProgress.delete(taskId);
            }
          }
        } catch (error) {
          ctx.logger.error({ taskId, error }, 'Error in completion monitoring callback');
        }
      })();
    }, COMPLETION_CHECK_INTERVAL_MS);

    ctx.activeTasks.set(`${taskId}-monitor`, checkInterval);
    // INT-1551 §E.7: cancel completion poll if shutdown signal fires.
    this.attachShutdownAbort(checkInterval, true);
  }

  /**
   * INT-1551 §E.7: register a one-shot abort listener that cancels a pending
   * timer when the dispatcher's shutdown signal fires. No-op if no signal is
   * wired (e.g. tests that construct a dispatcher without one) or if the
   * signal has already aborted (caller has not registered yet — clear immediately).
   */
  private attachShutdownAbort(handle: NodeJS.Timeout, isInterval: boolean): void {
    const signal = this.ctx.shutdownSignal;
    if (signal === undefined) {
      return;
    }
    const cancel = (): void => {
      if (isInterval) {
        clearInterval(handle);
      } else {
        clearTimeout(handle);
      }
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
  }

  clearTaskTimers(taskId: string): void {
    const ctx = this.ctx;
    clearTaskTimersFn(
      ctx.activeTasks,
      ctx.activityTimeoutManager,
      ctx.completionInProgress,
      ctx.attemptCompletionSignals,
      taskId
    );
  }
}
