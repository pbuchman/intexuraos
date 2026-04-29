import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskRunner } from '../task-runner.js';
import type { RuntimeEvent } from '../../runtime/index.js';
import { makeContextHarness, makeTask, type ContextHarness } from './fixtures.js';

describe('TaskRunner', () => {
  let harness: ContextHarness;
  let runner: TaskRunner;

  beforeEach(() => {
    harness = makeContextHarness();
    runner = new TaskRunner(harness.ctx);
  });

  describe('startWorkerAttempt', () => {
    it('happy path: pulls image, creates container, registers state, returns success', async () => {
      const task = makeTask();

      const result = await runner.startWorkerAttempt(task, {
        prompt: 'do thing',
        continueSession: false,
      });

      expect(result).toEqual({ ok: true, containerId: 'cont-abc' });
      expect(harness.pullImage).toHaveBeenCalledTimes(1);
      expect(harness.createWorker).toHaveBeenCalledTimes(1);
      // Activity timer started for the new attempt.
      expect(harness.activityTimeoutManager.start).toHaveBeenCalledWith('task-1');
      // attemptStartedAt + lastOutputAt registered for monitor heuristics.
      expect(harness.ctx.attemptStartedAt.has('task-1')).toBe(true);
      expect(harness.ctx.lastOutputAt.has('task-1')).toBe(true);
    });

    it('error path: returns ok:false on createWorker failure and logs the failure', async () => {
      const task = makeTask();
      harness.createWorker.mockRejectedValueOnce(new Error('docker exploded'));

      const result = await runner.startWorkerAttempt(task, {
        prompt: 'do thing',
        continueSession: false,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
      }
      // The terminal "Worker start failed: ..." log line is appended.
      expect(harness.appendOrchestratorTaskLog).toHaveBeenCalledWith(
        'task-1',
        expect.stringContaining('Worker start failed')
      );
    });

    it('rejects continueSession when no runtimeSessionId is persisted', async () => {
      const task = makeTask();
      // exactOptionalPropertyTypes: assign rather than spread `undefined`.
      delete task.runtimeSessionId;

      const result = await runner.startWorkerAttempt(task, {
        prompt: 'resume',
        continueSession: true,
      });

      expect(result.ok).toBe(false);
      // Did NOT touch isolation when bailed out early.
      expect(harness.pullImage).not.toHaveBeenCalled();
      expect(harness.createWorker).not.toHaveBeenCalled();
    });

    it('bails out with ok:false when the shutdown signal is already aborted (INT-1551 §E.7)', async () => {
      const controller = new AbortController();
      controller.abort();
      harness.ctx.shutdownSignal = controller.signal;

      const task = makeTask();
      const result = await runner.startWorkerAttempt(task, {
        prompt: 'do thing',
        continueSession: false,
      });

      expect(result.ok).toBe(false);
      // Did NOT touch isolation: shutdown short-circuit fires BEFORE any
      // network/docker work begins.
      expect(harness.pullImage).not.toHaveBeenCalled();
      expect(harness.createWorker).not.toHaveBeenCalled();
    });
  });

  describe('handleRuntimeEvents', () => {
    it('routes claude log events through appendChunk', async () => {
      const task = makeTask();
      const events: RuntimeEvent[] = [{ type: 'log', text: 'claude line' }];

      await runner.handleRuntimeEvents(task, events);

      expect(harness.ctx.logForwarder.appendChunk).toHaveBeenCalledWith(
        'task-1',
        'claude line'
      );
    });

    it('persists runtimeSessionId on runtime_session_started', async () => {
      const task = makeTask({ runtime: 'codex' });
      const events: RuntimeEvent[] = [
        { type: 'runtime_session_started', sessionId: 'sess-xyz' },
      ];

      await runner.handleRuntimeEvents(task, events);

      expect(task.runtimeSessionId).toBe('sess-xyz');
      expect(harness.saveTask).toHaveBeenCalledTimes(1);
    });

    it('records exit code + completion-signal on attempt_completed', async () => {
      const task = makeTask();
      const events: RuntimeEvent[] = [{ type: 'attempt_completed', exitCode: 0 }];

      await runner.handleRuntimeEvents(task, events);

      expect(harness.ctx.taskExitCodes.get('task-1')).toBe(0);
      expect(harness.ctx.attemptCompletionSignals.has('task-1')).toBe(true);
    });

    it('records claudeError on a hard-error runtime event', async () => {
      const task = makeTask();
      const events: RuntimeEvent[] = [
        {
          type: 'hard_error',
          exitCode: 2,
          errorMessage: 'runtime exploded',
        } as unknown as RuntimeEvent,
      ];

      await runner.handleRuntimeEvents(task, events);

      expect(harness.ctx.claudeErrors.get('task-1')).toBe('runtime exploded');
      expect(harness.ctx.taskExitCodes.get('task-1')).toBe(2);
      expect(harness.ctx.attemptCompletionSignals.has('task-1')).toBe(true);
    });
  });

  describe('runtime helpers', () => {
    it('resolveTaskRuntime falls back to worker-type runtime when task does not pin one', () => {
      const task = makeTask({ workerType: 'sonnet' });
      expect(runner.resolveTaskRuntime(task)).toBe('claude');
    });

    it('getRuntimeDisplayName returns Codex/Claude label', () => {
      expect(runner.getRuntimeDisplayName(makeTask({ runtime: 'codex' }))).toBe('Codex');
      expect(runner.getRuntimeDisplayName(makeTask({ runtime: 'claude' }))).toBe('Claude');
    });
  });
});

// Silence the unused-import warning if `vi` ends up not directly referenced
// (kept for autocomplete and consistency with sibling test files).
void vi;
