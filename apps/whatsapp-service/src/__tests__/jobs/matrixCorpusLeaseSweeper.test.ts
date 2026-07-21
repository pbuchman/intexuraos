import { describe, expect, it, vi } from 'vitest';

import {
  MATRIX_CORPUS_DRAIN_INTERVAL_MS,
  MATRIX_CORPUS_SWEEP_INTERVAL_MS,
  MatrixCorpusRecoveryController,
  createMatrixCorpusRecoveryWork,
  createRuntimeMatrixCorpusTimerScheduler,
  type MatrixCorpusTimerScheduler,
} from '../../jobs/matrixCorpusLeaseSweeper.js';

describe('MatrixCorpusRecoveryController', () => {
  it('runs one immediate drain and schedules independent five/30-second loops', async () => {
    const scheduler = new FakeScheduler();
    const drainBatch = vi.fn(async () => undefined);
    const sweepExpiredLeases = vi.fn(async () => undefined);
    const controller = createController({ scheduler, drainBatch, sweepExpiredLeases });

    await controller.start();

    expect(drainBatch).toHaveBeenCalledTimes(1);
    expect(sweepExpiredLeases).not.toHaveBeenCalled();
    expect(scheduler.delays()).toEqual([
      MATRIX_CORPUS_DRAIN_INTERVAL_MS,
      MATRIX_CORPUS_SWEEP_INTERVAL_MS,
    ]);

    await scheduler.fire(MATRIX_CORPUS_DRAIN_INTERVAL_MS);
    await scheduler.fire(MATRIX_CORPUS_SWEEP_INTERVAL_MS);
    expect(drainBatch).toHaveBeenCalledTimes(2);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping drains while allowing the sweep to run independently', async () => {
    const scheduler = new FakeScheduler();
    const drain = deferred();
    const sweep = deferred();
    const drainBatch = vi.fn(() => drain.promise);
    const sweepExpiredLeases = vi.fn(() => sweep.promise);
    const controller = createController({ scheduler, drainBatch, sweepExpiredLeases });

    const immediate = controller.start();
    const overlappingDrain = controller.tickDrain();
    const overlappingDrainAgain = controller.tickDrain();
    const concurrentSweep = controller.tickSweep();
    await Promise.resolve();

    expect(drainBatch).toHaveBeenCalledTimes(1);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
    expect(overlappingDrain).toBe(overlappingDrainAgain);

    sweep.resolve();
    await concurrentSweep;
    expect(drainBatch).toHaveBeenCalledTimes(1);

    drain.resolve();
    await Promise.all([immediate, overlappingDrain]);
  });

  it('coalesces overlapping sweeps without starving later drain ticks', async () => {
    const scheduler = new FakeScheduler();
    const firstSweep = deferred();
    const drainBatch = vi.fn(async () => undefined);
    const sweepExpiredLeases = vi.fn(() => firstSweep.promise);
    const controller = createController({ scheduler, drainBatch, sweepExpiredLeases });
    await controller.start();

    const sweepA = controller.tickSweep();
    const sweepB = controller.tickSweep();
    await controller.tickDrain();

    expect(sweepA).toBe(sweepB);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(1);
    expect(drainBatch).toHaveBeenCalledTimes(2);
    firstSweep.resolve();
    await sweepA;
  });

  it('contains private failures with safe static logging and keeps future ticks alive', async () => {
    const scheduler = new FakeScheduler();
    const logger = { warn: vi.fn() };
    const drainBatch = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('private-drain-value'))
      .mockResolvedValue(undefined);
    const sweepExpiredLeases = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('private-sweep-value'))
      .mockResolvedValue(undefined);
    const controller = new MatrixCorpusRecoveryController({
      scheduler,
      drainBatch,
      sweepExpiredLeases,
      logger,
    });

    await expect(controller.start()).resolves.toBeUndefined();
    await expect(controller.tickSweep()).resolves.toBeUndefined();
    await expect(controller.tickDrain()).resolves.toBeUndefined();
    await expect(controller.tickSweep()).resolves.toBeUndefined();

    expect(drainBatch).toHaveBeenCalledTimes(2);
    expect(sweepExpiredLeases).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls).toEqual([
      [
        { reason: 'tick_failed', component: 'matrix-corpus-outbox-drainer' },
        'Matrix corpus recovery tick failed',
      ],
      [
        { reason: 'tick_failed', component: 'matrix-corpus-lease-sweeper' },
        'Matrix corpus recovery tick failed',
      ],
    ]);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-drain-value');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-sweep-value');
  });

  it('stop clears both timers, waits for bounded in-flight work, and is idempotent', async () => {
    const scheduler = new FakeScheduler();
    const drain = deferred();
    const sweep = deferred();
    const controller = createController({
      scheduler,
      drainBatch: () => drain.promise,
      sweepExpiredLeases: () => sweep.promise,
    });
    const start = controller.start();
    const sweepTick = controller.tickSweep();

    let stopped = false;
    const stop = controller.stop().then(() => {
      stopped = true;
    });
    expect(scheduler.activeCount()).toBe(0);
    await Promise.resolve();
    expect(stopped).toBe(false);

    drain.resolve();
    await start;
    expect(stopped).toBe(false);
    sweep.resolve();
    await sweepTick;
    await Promise.all([stop, controller.stop()]);
    expect(stopped).toBe(true);
    expect(scheduler.clearCount).toBe(2);
  });

  it('stop before start has no timer or work side effect', async () => {
    const scheduler = new FakeScheduler();
    const drainBatch = vi.fn(async () => undefined);
    const sweepExpiredLeases = vi.fn(async () => undefined);
    const controller = createController({ scheduler, drainBatch, sweepExpiredLeases });

    await controller.stop();

    expect(scheduler.activeCount()).toBe(0);
    expect(drainBatch).not.toHaveBeenCalled();
    expect(sweepExpiredLeases).not.toHaveBeenCalled();
  });

  it('does not duplicate schedules and makes every tick inert after stop', async () => {
    const scheduler = new FakeScheduler();
    const drainBatch = vi.fn(async () => undefined);
    const sweepExpiredLeases = vi.fn(async () => undefined);
    const controller = createController({ scheduler, drainBatch, sweepExpiredLeases });

    await controller.start();
    await controller.start();
    expect(scheduler.activeCount()).toBe(2);

    await controller.stop();
    await controller.start();
    await controller.tickDrain();
    await controller.tickSweep();
    expect(drainBatch).toHaveBeenCalledTimes(2);
    expect(sweepExpiredLeases).not.toHaveBeenCalled();
  });

  it('contains logging infrastructure failures as part of recovery error handling', async () => {
    const controller = new MatrixCorpusRecoveryController({
      scheduler: new FakeScheduler(),
      drainBatch: vi.fn().mockRejectedValue(new Error('private failure')),
      sweepExpiredLeases: vi.fn().mockRejectedValue(new Error('private failure')),
      logger: {
        warn: (): never => {
          throw new Error('logger unavailable');
        },
      },
    });

    await expect(controller.start()).resolves.toBeUndefined();
    await expect(controller.tickSweep()).resolves.toBeUndefined();
  });

  it('does not clear a newer in-flight ownership marker from an older completion', async () => {
    const drain = deferred();
    const sweep = deferred();
    const controller = createController({
      scheduler: new FakeScheduler(),
      drainBatch: () => drain.promise,
      sweepExpiredLeases: () => sweep.promise,
    });
    const drainTick = controller.tickDrain();
    const sweepTick = controller.tickSweep();
    await Promise.resolve();

    const internal = controller as unknown as {
      drainInFlight: Promise<void> | null;
      sweepInFlight: Promise<void> | null;
    };
    const newerDrain = Promise.resolve();
    const newerSweep = Promise.resolve();
    internal.drainInFlight = newerDrain;
    internal.sweepInFlight = newerSweep;
    drain.resolve();
    sweep.resolve();
    await Promise.all([drainTick, sweepTick]);

    expect(internal.drainInFlight).toBe(newerDrain);
    expect(internal.sweepInFlight).toBe(newerSweep);
  });

  it('exposes a scheduler backed by the runtime timer functions', () => {
    vi.useFakeTimers();
    try {
      const scheduler = createRuntimeMatrixCorpusTimerScheduler();
      const callback = vi.fn();
      const handle = scheduler.setInterval(callback, 25);

      vi.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledTimes(2);
      scheduler.clearInterval(handle);
      vi.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createMatrixCorpusRecoveryWork', () => {
  it('drains every bounded candidate and abandons only scanner-selected leases', async () => {
    const ingest = { ingestOutboxId: 'ingest_1' } as never;
    const terminal = { terminalControlId: 'terminal_1' } as never;
    const expired = { observedRunId: 'run_1' } as never;
    const scanner = {
      listOutboxCandidates: vi.fn(async () => ({ ingest: [ingest], terminal: [terminal] })),
      listExpiredLeaseCandidates: vi.fn(async () => [expired]),
    };
    const drainer = {
      drainIngest: vi.fn(async () => ({ status: 'delivered' as const })),
      drainTerminalControl: vi.fn(async () => ({ status: 'retryable' as const })),
    };
    const controlPlane = {
      abandonExpiredRun: vi.fn(async () => ({
        code: 'ABANDON_PENDING' as const,
        runId: 'run_1',
        phase: 'abandon_pending' as const,
        eventId: 'event_1',
        leaseFence: '1',
        reconciledAt: '2026-07-20T10:00:00.000Z',
        terminalControlId: 'terminal_1',
      })),
    };
    const work = createMatrixCorpusRecoveryWork({
      scanner,
      drainer,
      controlPlane,
      now: () => '2026-07-20T10:00:00.000Z',
      ownerDigest: 'a'.repeat(64),
    });

    await work.drainBatch();
    await work.sweepExpiredLeases();

    expect(scanner.listOutboxCandidates).toHaveBeenCalledWith({
      now: '2026-07-20T10:00:00.000Z',
      limit: 32,
      ownerDigest: 'a'.repeat(64),
    });
    expect(drainer.drainIngest).toHaveBeenCalledWith(ingest);
    expect(drainer.drainTerminalControl).toHaveBeenCalledWith(terminal);
    expect(controlPlane.abandonExpiredRun).toHaveBeenCalledWith(expired);
  });

  it('waits for all bounded candidates and exposes only a static failure to the controller', async () => {
    const second = vi.fn(async () => ({ status: 'delivered' as const }));
    const work = createMatrixCorpusRecoveryWork({
      scanner: {
        listOutboxCandidates: async () => ({
          ingest: [{ ingestOutboxId: 'first' } as never, { ingestOutboxId: 'second' } as never],
          terminal: [],
        }),
        listExpiredLeaseCandidates: async () => [],
      },
      drainer: {
        drainIngest: vi
          .fn()
          .mockRejectedValueOnce(new Error('private-candidate-failure'))
          .mockImplementationOnce(second),
        drainTerminalControl: vi.fn(),
      },
      controlPlane: { abandonExpiredRun: vi.fn() },
      now: () => '2026-07-20T10:00:00.000Z',
      ownerDigest: 'a'.repeat(64),
    });

    await expect(work.drainBatch()).rejects.toThrow('Matrix corpus recovery batch failed');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('fails the batch with a static error when a drainer rejects a corrupt candidate', async () => {
    const work = createMatrixCorpusRecoveryWork({
      scanner: {
        listOutboxCandidates: async () => ({
          ingest: [{ ingestOutboxId: 'corrupt' } as never],
          terminal: [{ terminalControlId: 'retryable' } as never],
        }),
        listExpiredLeaseCandidates: async () => [],
      },
      drainer: {
        drainIngest: async () => ({ status: 'rejected' as const }),
        drainTerminalControl: async () => ({ status: 'retryable' as const }),
      },
      controlPlane: { abandonExpiredRun: vi.fn() },
      now: () => '2026-07-20T10:00:00.000Z',
      ownerDigest: 'a'.repeat(64),
    });

    await expect(work.drainBatch()).rejects.toThrow('Matrix corpus recovery batch failed');
  });

  it('fails the batch when a terminal drainer rejects a corrupt candidate', async () => {
    const work = createMatrixCorpusRecoveryWork({
      scanner: {
        listOutboxCandidates: async () => ({
          ingest: [],
          terminal: [{ terminalControlId: 'corrupt' } as never],
        }),
        listExpiredLeaseCandidates: async () => [],
      },
      drainer: {
        drainIngest: vi.fn(),
        drainTerminalControl: async () => ({ status: 'rejected' as const }),
      },
      controlPlane: { abandonExpiredRun: vi.fn() },
      now: () => '2026-07-20T10:00:00.000Z',
      ownerDigest: 'a'.repeat(64),
    });

    await expect(work.drainBatch()).rejects.toThrow('Matrix corpus recovery batch failed');
  });

  it('waits for every expired-lease attempt and reports any rejected abandonment', async () => {
    const later = vi.fn().mockResolvedValue({ code: 'NOT_FOUND' });
    const abandonExpiredRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('private abandonment failure'))
      .mockImplementationOnce(later);
    const work = createMatrixCorpusRecoveryWork({
      scanner: {
        listOutboxCandidates: async () => ({ ingest: [], terminal: [] }),
        listExpiredLeaseCandidates: async () => [
          { observedRunId: 'run_1' } as never,
          { observedRunId: 'run_2' } as never,
        ],
      },
      drainer: { drainIngest: vi.fn(), drainTerminalControl: vi.fn() },
      controlPlane: { abandonExpiredRun },
      now: () => '2026-07-20T10:00:00.000Z',
      ownerDigest: 'a'.repeat(64),
    });

    await expect(work.sweepExpiredLeases()).rejects.toThrow(
      'Matrix corpus recovery batch failed'
    );
    expect(later).toHaveBeenCalledOnce();
  });
});

function createController(input: {
  scheduler: MatrixCorpusTimerScheduler;
  drainBatch: () => Promise<void>;
  sweepExpiredLeases: () => Promise<void>;
}): MatrixCorpusRecoveryController {
  return new MatrixCorpusRecoveryController({
    ...input,
    logger: { warn: () => undefined },
  });
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeScheduler implements MatrixCorpusTimerScheduler {
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();
  private nextId = 1;
  public clearCount = 0;

  public setInterval(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { callback, delayMs });
    return id;
  }

  public clearInterval(handle: unknown): void {
    if (this.timers.delete(handle as number)) this.clearCount += 1;
  }

  public delays(): number[] {
    return [...this.timers.values()].map(({ delayMs }) => delayMs);
  }

  public activeCount(): number {
    return this.timers.size;
  }

  public async fire(delayMs: number): Promise<void> {
    const timer = [...this.timers.values()].find((candidate) => candidate.delayMs === delayMs);
    if (timer === undefined) throw new Error(`Missing fake interval ${String(delayMs)}`);
    timer.callback();
    await Promise.resolve();
    await Promise.resolve();
  }
}
