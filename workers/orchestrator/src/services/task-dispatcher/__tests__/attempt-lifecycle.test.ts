import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttemptLifecycle } from '../attempt-lifecycle.js';
import { makeContextHarness, makeTask, type ContextHarness } from './fixtures.js';

describe('AttemptLifecycle', () => {
  let harness: ContextHarness;
  let al: AttemptLifecycle;

  beforeEach(() => {
    harness = makeContextHarness();
    al = new AttemptLifecycle(harness.ctx);
  });

  describe('teardownAttempt', () => {
    it('destroys the worker when keepSession is false', async () => {
      await al.teardownAttempt('task-1', false);
      expect(harness.destroyWorker).toHaveBeenCalledWith('task-1');
      expect(harness.cleanupTaskSession).toHaveBeenCalledWith('task-1');
    });

    it('does not destroy the worker when keepSession is true', async () => {
      await al.teardownAttempt('task-1', true);
      expect(harness.destroyWorker).not.toHaveBeenCalled();
    });

    it('swallows destroyWorker errors and logs a warning', async () => {
      harness.destroyWorker.mockRejectedValueOnce(new Error('boom'));
      await al.teardownAttempt('task-1', false);
      expect(harness.logger.warn).toHaveBeenCalled();
    });
  });

  describe('failAcceptedResume', () => {
    it('finalizes the task as failed with RESUME_ATTEMPT_FAILED', async () => {
      const task = makeTask({ taskId: 'fa-1' });
      await al.failAcceptedResume(task, new Error('startup failed'));
      expect(harness.ctx.finalizeTask).toHaveBeenCalledTimes(1);
      const args = vi.mocked(harness.ctx.finalizeTask).mock.calls[0];
      expect(args?.[1]).toBe('failed');
      expect((args?.[2] as { error: { code: string } }).error.code).toBe('RESUME_ATTEMPT_FAILED');
    });
  });

  describe('handleInactivityRestart', () => {
    it('flips inactivityRestartInProgress flag', async () => {
      // Make the inner doHandleInactivityRestart a no-op for this test by
      // forcing completionInProgress so it short-circuits.
      harness.ctx.completionInProgress.add('task-1');
      const promise = al.handleInactivityRestart('task-1');
      // While in flight the flag must be set.
      expect(harness.ctx.inactivityRestartInProgress.has('task-1')).toBe(true);
      await promise;
      // After it resolves the flag must be cleared.
      expect(harness.ctx.inactivityRestartInProgress.has('task-1')).toBe(false);
    });

    it('finalizes failure instead of resuming when destroyWorker fails', async () => {
      const task = makeTask({ runtimeSessionId: 'session-1' });
      harness.tasks.set(task.taskId, task);
      harness.destroyWorker.mockRejectedValueOnce(new Error('docker stuck'));

      await al.doHandleInactivityRestart(task.taskId);

      expect(harness.ctx.startWorkerAttempt).not.toHaveBeenCalled();
      expect(harness.ctx.finalizeTask).toHaveBeenCalledWith(
        task,
        'failed',
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TASK_INACTIVITY_RESTART_FAILED',
          }),
        })
      );
      expect(harness.appendOrchestratorTaskLog).not.toHaveBeenCalledWith(
        task.taskId,
        'Worker destroyed for inactivity restart'
      );
    });

    it('copies /tmp evidence to a directory derived from config.logBasePath (INT-1787)', async () => {
      // Regression for INT-1787: orchestrator was writing evidence to
      // /var/log/orchestrator/inactivity-evidence/, which fails on hosts
      // where /var/log is not writable by the orchestrator user (e.g. the
      // home-dev VM running under systemd). Evidence must live under
      // config.logBasePath which the orchestrator already creates at startup.
      const task = makeTask({ taskId: 'evidence-1' });
      harness.tasks.set(task.taskId, task);

      await al.doHandleInactivityRestart(task.taskId);

      const copyOutMock = harness.ctx.isolation.provider.copyOut as unknown as ReturnType<
        typeof vi.fn
      >;
      expect(copyOutMock).toHaveBeenCalledTimes(1);
      const logBasePath = harness.ctx.config.logBasePath;
      expect(copyOutMock).toHaveBeenCalledWith(
        expect.anything(),
        '/tmp',
        `${logBasePath}/inactivity-evidence/evidence-1/`
      );
    });
  });

  describe('executeTaskSetup', () => {
    it('builds task, creates worktree, starts worker, schedules timers', async () => {
      const worktreeManager = {
        createWorktree: vi.fn().mockResolvedValue('/tmp/wt'),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
      (harness.ctx as any).worktreeManager = worktreeManager;
      const request = {
        taskId: 'setup-1',
        workerType: 'sonnet' as const,
        prompt: 'do thing',
        webhookUrl: 'http://wh',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
      };
      await al.executeTaskSetup(request, () => 'pbuchman/intexuraos');
      expect(worktreeManager.createWorktree).toHaveBeenCalled();
      expect(harness.ctx.logForwarder.registerTask).toHaveBeenCalledWith(
        'setup-1',
        'sec',
        'http://wh'
      );
      expect(harness.ctx.startWorkerAttempt).toHaveBeenCalled();
      // INT-1585: timers are now invoked with the per-task `task.timeoutMs`
      // override (undefined here because no timeoutHours was supplied).
      expect(harness.ctx.scheduleTimeoutWarning).toHaveBeenCalledWith('setup-1', undefined);
      expect(harness.ctx.scheduleTimeoutKill).toHaveBeenCalledWith('setup-1', undefined);
      expect(harness.ctx.startCompletionMonitoring).toHaveBeenCalledWith('setup-1');
      // task should be saved.
      expect(harness.saveTask).toHaveBeenCalled();
    });

    it('forwards per-task timeoutMs to schedule calls when timeoutHours is set (INT-1585)', async () => {
      const worktreeManager = {
        createWorktree: vi.fn().mockResolvedValue('/tmp/wt'),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
      (harness.ctx as any).worktreeManager = worktreeManager;
      const request = {
        taskId: 'setup-timeout',
        workerType: 'sonnet' as const,
        prompt: 'long task',
        webhookUrl: 'http://wh',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        timeoutHours: 8,
      };
      await al.executeTaskSetup(request, () => 'pbuchman/intexuraos');
      const expectedTimeoutMs = 8 * 60 * 60 * 1000;
      expect(harness.ctx.scheduleTimeoutWarning).toHaveBeenCalledWith(
        'setup-timeout',
        expectedTimeoutMs
      );
      expect(harness.ctx.scheduleTimeoutKill).toHaveBeenCalledWith(
        'setup-timeout',
        expectedTimeoutMs
      );
    });

    it('releases slot and sends setup-failure webhook on worktree error', async () => {
      const worktreeManager = {
        createWorktree: vi.fn().mockRejectedValue(new Error('mkdir failed')),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
      (harness.ctx as any).worktreeManager = worktreeManager;
      harness.runningCount.value = 1;
      const request = {
        taskId: 'setup-2',
        workerType: 'sonnet' as const,
        prompt: 'do thing',
        webhookUrl: 'http://wh',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
      };
      await al.executeTaskSetup(request, () => 'pbuchman/intexuraos');
      expect(harness.runningCount.value).toBe(0);
      // Worker startup should not have been attempted.
      expect(harness.ctx.startWorkerAttempt).not.toHaveBeenCalled();
    });
  });
});
