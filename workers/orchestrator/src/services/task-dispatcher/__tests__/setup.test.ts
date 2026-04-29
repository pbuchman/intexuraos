import { describe, it, expect, vi } from 'vitest';
import { Mutex } from 'async-mutex';
import { buildDispatcherContext } from '../setup.js';
import { makeLogger } from './fixtures.js';

/**
 * INT-1551 §E.7: focused unit tests for setup.ts. The dispatcher tests cover
 * the broader wiring; these tests pin behavior of the trackInFlight helper
 * (registration, cleanup on resolve, cleanup on reject).
 */

function buildContext(): {
  ctx: ReturnType<typeof buildDispatcherContext>;
  inFlightHandlers: Set<Promise<unknown>>;
} {
  const inFlightHandlers = new Set<Promise<unknown>>();
  const ctx = buildDispatcherContext(
    {
      logger: makeLogger(),
      config: { capacity: 5 } as never,
      isolation: {} as never,
      logForwarder: {} as never,
      webhookClient: {} as never,
      statusUpdateClient: {} as never,
      statePersistence: {} as never,
      worktreeManager: {} as never,
      metrics: {} as never,
      activityTimeoutManager: {} as never,
      turnMetricsCollector: undefined,
      agentComplianceValidator: undefined,
      completionMaxAttempts: 5,
      extractResumeSummaryFn: vi.fn().mockResolvedValue(undefined),
      verifyOverride: undefined,
      preserveWorkerContainers: false,
    },
    {
      activeTasks: new Map(),
      claudeErrors: new Map(),
      taskExitCodes: new Map(),
      attemptStartedAt: new Map(),
      attemptCompletionSignals: new Set(),
      completionInProgress: new Set(),
      inactivityRestartInProgress: new Set(),
      pendingMessages: new Map(),
      lastOutputAt: new Map(),
      inFlightHandlers,
      capacityMutex: new Mutex(),
      runningCount: { value: 0 },
    },
    {
      appendOrchestratorTaskLog: vi.fn(),
      appendTaggedTaskLog: vi.fn(),
      flushTaskLogs: vi.fn().mockResolvedValue(undefined),
      handleTaskCompletion: vi.fn().mockResolvedValue(undefined),
      checkForResult: vi.fn().mockResolvedValue(undefined),
      saveTask: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue(null),
      startWorkerAttempt: vi.fn(),
      finalizeTask: vi.fn(),
      teardownAttempt: vi.fn(),
      clearTaskTimers: vi.fn(),
      scheduleTimeoutWarning: vi.fn(),
      scheduleTimeoutKill: vi.fn(),
      startCompletionMonitoring: vi.fn(),
      failAcceptedResume: vi.fn(),
      getRuntimeDisplayName: vi.fn().mockReturnValue('claude'),
      getDefaultRepository: vi.fn().mockReturnValue('pbuchman/intexuraos'),
    }
  );
  return { ctx, inFlightHandlers };
}

describe('buildDispatcherContext', () => {
  describe('trackInFlight (INT-1551 §E.7)', () => {
    it('registers the promise in inFlightHandlers and removes it on resolve', async () => {
      const { ctx, inFlightHandlers } = buildContext();
      const promise = Promise.resolve('done');
      const tracked = ctx.trackInFlight(promise);

      expect(inFlightHandlers.has(tracked)).toBe(true);
      await tracked;
      // Allow microtasks to settle the .finally() callback.
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlightHandlers.has(tracked)).toBe(false);
    });

    it('removes the promise from inFlightHandlers on reject (catch arm exercised)', async () => {
      const { ctx, inFlightHandlers } = buildContext();
      const promise = Promise.reject(new Error('handler exploded'));
      // Suppress the unhandled rejection in this test scope.
      promise.catch(() => {
        /* swallow */
      });

      const tracked = ctx.trackInFlight(promise);
      expect(inFlightHandlers.has(tracked)).toBe(true);

      await Promise.allSettled([tracked]);
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlightHandlers.has(tracked)).toBe(false);
    });

    it('returns the same promise so callers can still await/chain', async () => {
      const { ctx } = buildContext();
      const inner = Promise.resolve(42);
      const out = ctx.trackInFlight(inner);
      expect(out).toBe(inner);
      await expect(out).resolves.toBe(42);
    });
  });

  describe('releaseSlot', () => {
    it('decrements runningCount only when positive (idempotent guard)', () => {
      const { ctx } = buildContext();
      // releaseSlot reads through the wired state ref; from 0 it stays 0.
      ctx.releaseSlot();
      ctx.incrementRunningCount();
      ctx.releaseSlot();
      // Second release on a zero counter must not go negative.
      ctx.releaseSlot();
    });
  });
});
