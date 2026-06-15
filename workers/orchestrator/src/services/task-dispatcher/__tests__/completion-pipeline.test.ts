import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CompletionPipeline,
  runVerification,
  adaptLegacyVerdictIfNeeded,
  computeTaskDurationMs,
  type LegacyVerdict,
} from '../completion-pipeline.js';
import type { CompletionVerifierVerdict } from '../../completion-verifier.js';
import { makeContextHarness, makeTask, type ContextHarness } from './fixtures.js';

describe('CompletionPipeline', () => {
  let harness: ContextHarness;
  let cp: CompletionPipeline;

  beforeEach(() => {
    harness = makeContextHarness([makeTask()]);
    cp = new CompletionPipeline(harness.ctx);
  });

  describe('runVerification', () => {
    it('runs the test override when supplied', async () => {
      const verify = vi.fn().mockResolvedValue({
        kind: 'parsed',
        data: {},
        missingRequired: [],
        telemetryMissing: [],
        warnings: [],
      } satisfies CompletionVerifierVerdict);
      const verdict = await runVerification({
        verifyOverride: verify,
        task: makeTask({ taskId: 'rv-1' }),
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: 'hello',
      });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verdict.kind).toBe('parsed');
    });

    it('runs verifyCompletion when no override is supplied', async () => {
      const verdict = await runVerification({
        verifyOverride: undefined,
        task: makeTask({ taskId: 'rv-2' }),
        attempt: 1,
        maxAttempts: 5,
        agentType: 'execution',
        rawLogs: '',
      });
      // verifyCompletion returns a hard-error on empty transcript (no AGENT_FINAL).
      expect(verdict.kind).toBe('hard-error');
    });
  });

  describe('adaptLegacyVerdictIfNeeded', () => {
    it('returns a modern verdict unchanged', () => {
      const modern: CompletionVerifierVerdict = {
        kind: 'parsed',
        data: { summary: 'ok' },
        missingRequired: [],
        telemetryMissing: [],
        warnings: [],
      };
      expect(adaptLegacyVerdictIfNeeded(modern)).toBe(modern);
    });

    it('rewrites a legacy passed=true verdict into a parsed verdict', () => {
      const legacy: LegacyVerdict = {
        passed: true,
        missingFields: [],
        telemetryMissingFields: [],
        agentData: { summary: 'done' },
      };
      const result = adaptLegacyVerdictIfNeeded(legacy);
      expect(result.kind).toBe('parsed');
      if (result.kind === 'parsed') {
        expect(result.missingRequired).toEqual([]);
        expect(result.data['summary']).toBe('done');
      }
    });

    it('rewrites a legacy verifierFailure into a hard-error', () => {
      const legacy: LegacyVerdict = {
        passed: false,
        missingFields: [],
        telemetryMissingFields: [],
        verifierFailure: true,
      };
      const result = adaptLegacyVerdictIfNeeded(legacy);
      expect(result.kind).toBe('hard-error');
      if (result.kind === 'hard-error') {
        expect(result.code).toBe('TASK_RUNTIME_HARD_ERROR');
      }
    });

    it('inserts a sentinel field when legacy passed=false with no fields and no agentData', () => {
      const legacy: LegacyVerdict = {
        passed: false,
        missingFields: [],
        telemetryMissingFields: [],
      };
      const result = adaptLegacyVerdictIfNeeded(legacy);
      expect(result.kind).toBe('parsed');
      if (result.kind === 'parsed') {
        expect(result.missingRequired).toEqual(['legacy_verifier_not_passed']);
      }
    });
  });

  describe('emitTerminalMetrics', () => {
    it('increments the COMPLETED counter and records duration on success', () => {
      const task = makeTask({
        startedAt: new Date(Date.now() - 5_000).toISOString(),
        completedAt: new Date().toISOString(),
      });
      cp.emitTerminalMetrics(task, 'completed');
      expect(harness.ctx.metrics.increment).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.stringContaining('code_tasks') as unknown }),
        expect.objectContaining({ status: 'success' })
      );
      expect(harness.ctx.metrics.record).toHaveBeenCalledTimes(1);
    });

    it('increments the FAILED counter on non-completed terminal status', () => {
      const task = makeTask({
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      cp.emitTerminalMetrics(task, 'failed');
      // Two increments: COMPLETED{status} + FAILED{reason}.
      expect(harness.ctx.metrics.increment).toHaveBeenCalledTimes(2);
    });
  });

  describe('computeTaskDurationMs', () => {
    it('returns positive ms for a normal start/complete', () => {
      const task = makeTask({
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:05Z',
      });
      expect(computeTaskDurationMs(task)).toBe(5_000);
    });

    it('returns 0 if completedAt is missing', () => {
      const task = makeTask({ startedAt: '2024-01-01T00:00:00Z' });
      delete task.completedAt;
      expect(computeTaskDurationMs(task)).toBe(0);
    });

    it('returns 0 on malformed timestamps', () => {
      const task = makeTask({
        startedAt: 'invalid',
        completedAt: 'invalid',
      });
      expect(computeTaskDurationMs(task)).toBe(0);
    });
  });

  describe('finalizeTask', () => {
    it('writes terminal status, releases slot, calls webhook', async () => {
      harness.runningCount.value = 1;
      const task = makeTask({ taskId: 'final-1' });
      harness.tasks.set(task.taskId, task);
      // Stub status update commit to succeed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
      (harness.ctx.statusUpdateClient as unknown as { commit: any }).commit = vi
        .fn()
        .mockResolvedValue({ ok: true, value: undefined });
      // Stub the webhook send to track calls.
      await cp.finalizeTask(task, 'completed', { result: { branch: 'b', commits: 1 } });
      expect(task.status).toBe('completed');
      expect(harness.runningCount.value).toBe(0);
      expect(harness.webhookSend).toHaveBeenCalled();
    });

    it('persists and sends terminal status even when Docker cleanup hangs', async () => {
      vi.useFakeTimers();
      harness.runningCount.value = 1;
      const task = makeTask({ taskId: 'final-cleanup-hangs' });
      harness.tasks.set(task.taskId, task);
      const commit = vi.fn().mockResolvedValue({ ok: true, value: undefined });
      (harness.ctx.statusUpdateClient as unknown as { commit: typeof commit }).commit = commit;
      harness.destroyWorker.mockImplementationOnce(() => new Promise<void>(() => undefined));

      const finalizePromise = cp.finalizeTask(task, 'completed', {
        result: { branch: 'b', commits: 1, summary: 'done' },
      });
      void finalizePromise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();

      expect(task.status).toBe('completed');
      expect(harness.saveTask).toHaveBeenCalledWith(task);
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }));
      await Promise.resolve();
      await Promise.resolve();
      const terminalWebhookCall = harness.webhookSend.mock.calls.find((call) => {
        const input = call[0] as { payload?: { status?: string; taskId?: string } } | undefined;
        return input?.payload?.taskId === task.taskId && input.payload.status === 'completed';
      });
      expect(terminalWebhookCall).toBeDefined();
      await vi.advanceTimersByTimeAsync(31_000);
      vi.useRealTimers();
    });
  });
});
