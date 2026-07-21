import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTestRunArtifactSweepScheduler,
  createTestRunArtifactSweeper,
} from '../../jobs/testRunArtifactSweeper.js';
import { testRunRecord } from '../domain/testRuns/testRunFixtures.js';

const now = '2026-07-20T10:20:00.000Z';
const exactlyTenMinutesOld = '2026-07-20T10:10:00.000Z';

function stagedTerminal(
  overrides: Readonly<Record<string, unknown>> = {}
): ReturnType<typeof testRunRecord> {
  return testRunRecord({
    runId: 'run_staged',
    lifecycle: 'completed',
    verdict: 'passed',
    revision: 5,
    finishedAt: exactlyTenMinutesOld,
    updatedAt: exactlyTenMinutesOld,
    artifactDelivery: { status: 'staged', failureCode: null, updatedAt: exactlyTenMinutesOld },
    terminalWinner: {
      kind: 'release',
      eventId: 'terminal_event_1',
      payloadDigest: 'f'.repeat(64),
      outcome: 'completed_passed',
      acknowledgedAt: exactlyTenMinutesOld,
    },
    ...overrides,
  });
}

describe('Test Run artifact deadline sweeper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('moves only terminal staged artifacts at least ten minutes old to unknown by revision CAS', async () => {
    const repository = {
      listStagedArtifactsFinishedBefore: vi.fn(async () => ({
        ok: true as const,
        records: [
          stagedTerminal(),
          stagedTerminal({
            runId: 'run_preterminal',
            lifecycle: 'running',
            verdict: 'pending',
            finishedAt: null,
            terminalWinner: null,
          }),
        ],
      })),
      applyArtifactDelivery: vi.fn(async () => ({
        ok: true as const,
        disposition: 'applied' as const,
        record: stagedTerminal({
          revision: 6,
          artifactDelivery: {
            status: 'unknown',
            failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
            updatedAt: now,
          },
        }),
      })),
    };
    const sweeper = createTestRunArtifactSweeper({ repository, now: () => now });

    await expect(sweeper.runOnce()).resolves.toEqual({
      skipped: false,
      candidates: 2,
      transitioned: 1,
      conflicts: 0,
    });
    expect(repository.listStagedArtifactsFinishedBefore).toHaveBeenCalledWith({
      cutoff: exactlyTenMinutesOld,
      limit: 20,
    });
    expect(repository.applyArtifactDelivery).toHaveBeenCalledOnce();
    expect(repository.applyArtifactDelivery).toHaveBeenCalledWith({
      identity: { runId: 'run_staged', userId: 'auth0:user_1', leaseFence: '7' },
      command: {
        expectedRevision: 5,
        updatedAt: now,
        next: {
          status: 'unknown',
          failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
        },
      },
    });
  });

  it('is reentrancy-safe and treats a revision race as a bounded conflict', async () => {
    let resolveList: ((value: { ok: true; records: ReturnType<typeof stagedTerminal>[] }) => void) | undefined;
    const repository = {
      listStagedArtifactsFinishedBefore: vi.fn(
        async () => await new Promise<{ ok: true; records: ReturnType<typeof stagedTerminal>[] }>(
          (resolve) => { resolveList = resolve; }
        )
      ),
      applyArtifactDelivery: vi.fn(async () => ({
        ok: false as const,
        code: 'REVISION_CONFLICT' as const,
      })),
    };
    const sweeper = createTestRunArtifactSweeper({ repository, now: () => now });
    const first = sweeper.runOnce();
    await expect(sweeper.runOnce()).resolves.toEqual({ skipped: true });
    resolveList?.({ ok: true, records: [stagedTerminal()] });
    await expect(first).resolves.toEqual({
      skipped: false,
      candidates: 1,
      transitioned: 0,
      conflicts: 1,
    });
  });

  it('does not count an idempotent repository retry as another transition', async () => {
    const repository = {
      listStagedArtifactsFinishedBefore: vi.fn(async () => ({
        ok: true as const,
        records: [stagedTerminal()],
      })),
      applyArtifactDelivery: vi.fn(async () => ({
        ok: true as const,
        disposition: 'already_applied' as const,
        record: stagedTerminal({
          revision: 6,
          artifactDelivery: {
            status: 'unknown',
            failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
            updatedAt: now,
          },
        }),
      })),
    };
    const sweeper = createTestRunArtifactSweeper({ repository, now: () => now });

    await expect(sweeper.runOnce()).resolves.toEqual({
      skipped: false,
      candidates: 1,
      transitioned: 0,
      conflicts: 0,
    });
  });

  it('uses the real clock when none is injected and reports a bounded list failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const repository = {
      listStagedArtifactsFinishedBefore: vi.fn(async () => ({
        ok: false as const,
        code: 'CORRUPT_RECORD' as const,
      })),
      applyArtifactDelivery: vi.fn(),
    };

    await expect(createTestRunArtifactSweeper({ repository }).runOnce()).resolves.toEqual({
      skipped: false,
      candidates: 0,
      transitioned: 0,
      conflicts: 1,
    });
    expect(repository.listStagedArtifactsFinishedBefore).toHaveBeenCalledWith({
      cutoff: exactlyTenMinutesOld,
      limit: 20,
    });
    expect(repository.applyArtifactDelivery).not.toHaveBeenCalled();
  });

  it('schedules one reentrancy-safe tick every thirty seconds and stops gracefully', async () => {
    vi.useFakeTimers();
    const runOnce = vi.fn(async () => ({
      skipped: false as const,
      candidates: 0,
      transitioned: 0,
      conflicts: 0,
    }));
    const scheduler = createTestRunArtifactSweepScheduler({ runOnce });

    scheduler.start();
    scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runOnce).toHaveBeenCalledOnce();

    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runOnce).toHaveBeenCalledOnce();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('awaits an in-flight sweep during shutdown', async () => {
    vi.useFakeTimers();
    let resolveRun: (() => void) | undefined;
    const runOnce = vi.fn(
      async () =>
        await new Promise<Readonly<{ skipped: true }>>((resolve) => {
          resolveRun = (): void => resolve({ skipped: true });
        })
    );
    const scheduler = createTestRunArtifactSweepScheduler({ runOnce });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveRun?.();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('skips overlapping scheduler ticks, reports rejection, and permits stop before start', async () => {
    vi.useFakeTimers();
    let rejectRun: ((reason: unknown) => void) | undefined;
    const runOnce = vi.fn(
      async () =>
        await new Promise<Readonly<{ skipped: true }>>((_resolve, reject) => {
          rejectRun = reject;
        })
    );
    const onError = vi.fn();
    const scheduler = createTestRunArtifactSweepScheduler({ runOnce }, onError);

    await scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runOnce).toHaveBeenCalledOnce();
    rejectRun?.(new Error('sweep failed'));
    await scheduler.stop();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sweep failed' }));
  });

  it('absorbs a rejected sweep through the default scheduler error handler', async () => {
    vi.useFakeTimers();
    const scheduler = createTestRunArtifactSweepScheduler({
      runOnce: vi.fn(async () => {
        throw new Error('default handler');
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });
});
