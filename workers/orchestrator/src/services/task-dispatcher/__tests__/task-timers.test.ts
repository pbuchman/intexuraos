import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskTimers } from '../task-timers.js';
import {
  TASK_TIMEOUT_WARNING_MS,
  TASK_TIMEOUT_KILL_MS,
  TASK_TIMEOUT_WARNING_OFFSET_MS,
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

    it('logs a 5-hour warning at TASK_TIMEOUT_WARNING_MS when no override is set', async () => {
      timers.scheduleTimeoutWarning('task-1');
      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_WARNING_MS);
      // Drain any microtasks scheduled by the inner async callback.
      await Promise.resolve();
      expect(harness.logger.warn).toHaveBeenCalledWith(
        { taskId: 'task-1' },
        'Task approaching 5-hour timeout'
      );
    });
  });

  describe('per-task timeout override (INT-1585)', () => {
    it('schedules warning at overrideKillMs - 5min when override is provided', async () => {
      const overrideKillMs = 2 * 60 * 60 * 1000; // 2h
      timers.scheduleTimeoutWarning('task-1', overrideKillMs);

      // Just before the warning deadline → no log yet.
      await vi.advanceTimersByTimeAsync(overrideKillMs - TASK_TIMEOUT_WARNING_OFFSET_MS - 1);
      await Promise.resolve();
      expect(harness.logger.warn).not.toHaveBeenCalled();

      // Cross the deadline → warning logged with templated hour count.
      await vi.advanceTimersByTimeAsync(2);
      await Promise.resolve();
      expect(harness.logger.warn).toHaveBeenCalledWith(
        { taskId: 'task-1' },
        'Task approaching 2-hour timeout'
      );
    });

    it('clamps warning to 0 when overrideKillMs is below the warning offset (Math.max guard)', async () => {
      // When overrideKillMs is smaller than the 5-min warning offset, the
      // warning would otherwise be scheduled at a negative delay. The Math.max
      // guard clamps to 0 so the warning fires on the next tick instead.
      const tinyOverride = TASK_TIMEOUT_WARNING_OFFSET_MS - 1; // < offset
      timers.scheduleTimeoutWarning('task-1', tinyOverride);

      // Advance 1ms — the clamped 0ms timer must fire.
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(harness.logger.warn).toHaveBeenCalled();
    });

    it('kills the task at overrideKillMs when override is provided', async () => {
      const overrideKillMs = 3 * 60 * 60 * 1000; // 3h
      harness.runningCount.value = 1;
      timers.scheduleTimeoutKill('task-1', overrideKillMs);

      // Before override deadline → not killed yet.
      await vi.advanceTimersByTimeAsync(overrideKillMs - 1);
      await Promise.resolve();
      const taskMid = harness.tasks.get('task-1');
      expect(taskMid?.status).not.toBe('interrupted');

      // Cross the override deadline → task killed.
      await vi.advanceTimersByTimeAsync(2);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const taskAfter = harness.tasks.get('task-1');
      expect(taskAfter?.status).toBe('interrupted');
    });

    it('falls back to TASK_TIMEOUT_KILL_MS (5h) when overrideKillMs is undefined', async () => {
      harness.runningCount.value = 1;
      timers.scheduleTimeoutKill('task-1');

      // Just before the legacy 5h deadline → not killed yet.
      await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_KILL_MS - 1);
      await Promise.resolve();
      expect(harness.tasks.get('task-1')?.status).not.toBe('interrupted');

      // Cross the deadline → task killed via legacy 5h constant.
      await vi.advanceTimersByTimeAsync(2);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.tasks.get('task-1')?.status).toBe('interrupted');
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

    it('finalizes from attempt completion signal without waiting for Docker liveness', async () => {
      harness.ctx.attemptCompletionSignals.add('task-1');
      harness.isWorkerRunning.mockImplementationOnce(() => new Promise<boolean>(() => undefined));

      timers.startCompletionMonitoring('task-1');

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.isWorkerRunning).not.toHaveBeenCalled();
      expect(harness.handleTaskCompletion).toHaveBeenCalledTimes(1);
    });

    it('bounds Docker liveness checks when no attempt completion signal exists', async () => {
      harness.isWorkerRunning.mockImplementationOnce(() => new Promise<boolean>(() => undefined));

      timers.startCompletionMonitoring('task-1');

      await vi.advanceTimersByTimeAsync(COMPLETION_CHECK_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(31_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.handleTaskCompletion).not.toHaveBeenCalled();
      expect(harness.ctx.completionInProgress.has('task-1')).toBe(false);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1' }),
        'Docker liveness check timed out; treating worker as still running'
      );
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
