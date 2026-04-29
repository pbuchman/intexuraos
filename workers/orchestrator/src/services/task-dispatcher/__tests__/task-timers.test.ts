import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskTimers } from '../task-timers.js';
import {
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  COMPLETION_CHECK_INTERVAL_MS,
} from '../retry-logic.js';
import { makeContextHarness, makeTask, type ContextHarness } from './fixtures.js';

describe('TaskTimers', () => {
  let harness: ContextHarness;
  let timers: TaskTimers;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = makeContextHarness([makeTask()]);
    timers = new TaskTimers(harness.ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleTimeoutWarning', () => {
    it('registers a warning timer keyed under {taskId}-warning', () => {
      timers.scheduleTimeoutWarning('task-1');
      expect(harness.ctx.activeTasks.has('task-1-warning')).toBe(true);
    });

    it('clearTaskTimers removes the warning entry', () => {
      timers.scheduleTimeoutWarning('task-1');
      timers.clearTaskTimers('task-1');
      expect(harness.ctx.activeTasks.has('task-1-warning')).toBe(false);
    });

    it('logs a warning when the timer fires for a still-running task', async () => {
      timers.scheduleTimeoutWarning('task-1');
      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_WARNING_MS);
      // Drain any microtasks scheduled by the inner async callback.
      await Promise.resolve();
      expect(harness.logger.warn).toHaveBeenCalledWith(
        { taskId: 'task-1' },
        expect.stringContaining('5-hour timeout')
      );
    });
  });

  describe('scheduleTimeoutKill', () => {
    it('writes interrupted status, releases slot, sends webhook', async () => {
      harness.runningCount.value = 1;
      timers.scheduleTimeoutKill('task-1');

      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_KILL_MS);
      // Drain inner async callback chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const task = harness.tasks.get('task-1');
      expect(task?.status).toBe('interrupted');
      expect(harness.runningCount.value).toBe(0);
      expect(harness.webhookSend).toHaveBeenCalledTimes(1);
      const sendArgs = harness.webhookSend.mock.calls[0]?.[0] as {
        payload: { status: string };
      };
      expect(sendArgs.payload.status).toBe('interrupted');
      // Activity timeout stopped early to prevent restart during hard kill.
      expect(harness.activityTimeoutManager.stop).toHaveBeenCalledWith('task-1');
    });

    it('bails out without webhook when task is no longer running', async () => {
      const completedTask = makeTask({ status: 'completed' });
      harness.tasks.set(completedTask.taskId, completedTask);
      timers.scheduleTimeoutKill('task-1');

      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_KILL_MS);
      await Promise.resolve();

      // No webhook fired because the task wasn't running anymore.
      expect(harness.webhookSend).not.toHaveBeenCalled();
    });
  });

  describe('startCompletionMonitoring', () => {
    it('triggers handleTaskCompletion when worker exits', async () => {
      harness.isWorkerRunning.mockResolvedValue(false);

      timers.startCompletionMonitoring('task-1');

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS);
      // Drain micro-tasks scheduled inside the interval callback.
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.handleTaskCompletion).toHaveBeenCalledTimes(1);
    });

    it('clears its own timer when the task is no longer running', async () => {
      const completedTask = makeTask({ status: 'completed' });
      harness.tasks.set(completedTask.taskId, completedTask);

      timers.startCompletionMonitoring('task-1');
      expect(harness.ctx.activeTasks.has('task-1-monitor')).toBe(true);

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS);
      await Promise.resolve();

      expect(harness.ctx.activeTasks.has('task-1-monitor')).toBe(false);
      expect(harness.handleTaskCompletion).not.toHaveBeenCalled();
    });

    it('skips completion when an inactivity restart is in flight', async () => {
      harness.isWorkerRunning.mockResolvedValue(false);
      harness.ctx.inactivityRestartInProgress.add('task-1');

      timers.startCompletionMonitoring('task-1');

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS);
      await Promise.resolve();

      expect(harness.handleTaskCompletion).not.toHaveBeenCalled();
    });
  });

  describe('clearTaskTimers', () => {
    it('cancels all per-task timers and clears completion-in-progress', () => {
      timers.scheduleTimeoutWarning('task-1');
      timers.scheduleTimeoutKill('task-1');
      timers.startCompletionMonitoring('task-1');
      harness.ctx.completionInProgress.add('task-1');
      harness.ctx.attemptCompletionSignals.add('task-1');

      timers.clearTaskTimers('task-1');

      expect(harness.ctx.activeTasks.has('task-1-warning')).toBe(false);
      expect(harness.ctx.activeTasks.has('task-1-kill')).toBe(false);
      expect(harness.ctx.activeTasks.has('task-1-monitor')).toBe(false);
      expect(harness.ctx.completionInProgress.has('task-1')).toBe(false);
      expect(harness.ctx.attemptCompletionSignals.has('task-1')).toBe(false);
      expect(harness.activityTimeoutManager.stop).toHaveBeenCalledWith('task-1');
    });
  });

  describe('shutdown signal wiring (INT-1551 §E.7)', () => {
    it('cancels the warning timer when the shutdown signal aborts', async () => {
      const controller = new AbortController();
      harness.ctx.shutdownSignal = controller.signal;

      timers.scheduleTimeoutWarning('task-1');
      controller.abort();

      // Advance past the warning deadline; the cancelled timer must NOT fire.
      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_WARNING_MS + 1);
      await Promise.resolve();
      expect(harness.logger.warn).not.toHaveBeenCalled();
    });

    it('cancels the completion-monitor interval when the shutdown signal aborts', async () => {
      const controller = new AbortController();
      harness.ctx.shutdownSignal = controller.signal;
      harness.isWorkerRunning.mockResolvedValue(false);

      timers.startCompletionMonitoring('task-1');
      controller.abort();

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS + 1);
      await Promise.resolve();
      expect(harness.handleTaskCompletion).not.toHaveBeenCalled();
    });

    it('clears immediately when scheduled with an already-aborted signal', () => {
      const controller = new AbortController();
      controller.abort();
      harness.ctx.shutdownSignal = controller.signal;

      // Spy clearTimeout to verify the early-cancel branch executed.
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      timers.scheduleTimeoutKill('task-1');
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
