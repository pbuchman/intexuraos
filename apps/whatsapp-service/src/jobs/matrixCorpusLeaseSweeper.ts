export const MATRIX_CORPUS_DRAIN_INTERVAL_MS = 5 * 60 * 1000;
export const MATRIX_CORPUS_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
export const MATRIX_CORPUS_RECOVERY_BATCH_SIZE = 32;

export interface MatrixCorpusTimerScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface MatrixCorpusRecoveryControllerDependencies {
  scheduler: MatrixCorpusTimerScheduler;
  drainBatch(): Promise<void>;
  sweepExpiredLeases(): Promise<void>;
  logger: {
    warn(value: Readonly<{ reason: string; component: string }>, message: string): void;
  };
}

export interface MatrixCorpusRecoveryWorkDependencies {
  scanner: {
    listOutboxCandidates(input: {
      now: string;
      limit: number;
      ownerDigest: string;
    }): Promise<
      Readonly<{
        ingest: readonly MatrixCorpusIngestDrainInput[];
        terminal: readonly MatrixCorpusTerminalDrainInput[];
      }>
    >;
    listExpiredLeaseCandidates(input: {
      now: string;
      limit: number;
    }): Promise<readonly AbandonExpiredRunInput[]>;
  };
  drainer: MatrixCorpusOutboxDrainer;
  controlPlane: Pick<MatrixCorpusControlPlane, 'abandonExpiredRun'>;
  now(): string;
  ownerDigest: string;
}

export interface MatrixCorpusRecoveryWork {
  drainBatch(): Promise<void>;
  sweepExpiredLeases(): Promise<void>;
}

const runtimeScheduler: MatrixCorpusTimerScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => { clearInterval(handle as ReturnType<typeof setInterval>); },
};

/**
 * Owns the bounded Matrix-corpus recovery lifecycle for one WhatsApp process.
 *
 * The controller deliberately knows nothing about Firestore document values. Work adapters
 * perform bounded scans and transactional revalidation; this owner only guarantees cadence,
 * per-loop single-flight behavior, error containment, and orderly shutdown.
 */
export class MatrixCorpusRecoveryController {
  private readonly dependencies: MatrixCorpusRecoveryControllerDependencies;
  private drainTimer: unknown;
  private sweepTimer: unknown;
  private drainInFlight: Promise<void> | null = null;
  private sweepInFlight: Promise<void> | null = null;
  private stopInFlight: Promise<void> | null = null;
  private started = false;
  private stopped = false;

  public constructor(dependencies: MatrixCorpusRecoveryControllerDependencies) {
    this.dependencies = dependencies;
  }

  public start(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.started) {
      this.started = true;
      this.drainTimer = this.dependencies.scheduler.setInterval(() => {
        void this.tickDrain();
      }, MATRIX_CORPUS_DRAIN_INTERVAL_MS);
      this.sweepTimer = this.dependencies.scheduler.setInterval(() => {
        void this.tickSweep();
      }, MATRIX_CORPUS_SWEEP_INTERVAL_MS);
    }
    return this.tickDrain();
  }

  public tickDrain(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.drainInFlight !== null) return this.drainInFlight;

    const work = Promise.resolve()
      .then(async () => { await this.dependencies.drainBatch(); })
      .catch(() => {
        this.safeLog('matrix-corpus-outbox-drainer');
      })
      .finally(() => {
        if (this.drainInFlight === work) this.drainInFlight = null;
      });
    this.drainInFlight = work;
    return work;
  }

  public tickSweep(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.sweepInFlight !== null) return this.sweepInFlight;

    const work = Promise.resolve()
      .then(async () => { await this.dependencies.sweepExpiredLeases(); })
      .catch(() => {
        this.safeLog('matrix-corpus-lease-sweeper');
      })
      .finally(() => {
        if (this.sweepInFlight === work) this.sweepInFlight = null;
      });
    this.sweepInFlight = work;
    return work;
  }

  public stop(): Promise<void> {
    if (this.stopInFlight !== null) return this.stopInFlight;
    this.stopped = true;

    if (this.drainTimer !== undefined) {
      this.dependencies.scheduler.clearInterval(this.drainTimer);
      this.drainTimer = undefined;
    }
    if (this.sweepTimer !== undefined) {
      this.dependencies.scheduler.clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }

    const boundedWork = [this.drainInFlight, this.sweepInFlight].filter(
      (work): work is Promise<void> => work !== null
    );
    this.stopInFlight = Promise.all(boundedWork).then(() => undefined);
    return this.stopInFlight;
  }

  private safeLog(component: string): void {
    try {
      this.dependencies.logger.warn(
        { reason: 'tick_failed', component },
        'Matrix corpus recovery tick failed'
      );
    } catch {
      // Logging must not turn contained recovery failures into unhandled rejections.
    }
  }
}

export function createRuntimeMatrixCorpusTimerScheduler(): MatrixCorpusTimerScheduler {
  return runtimeScheduler;
}

export function createMatrixCorpusRecoveryWork(
  dependencies: MatrixCorpusRecoveryWorkDependencies
): MatrixCorpusRecoveryWork {
  return {
    async drainBatch(): Promise<void> {
      const candidates = await dependencies.scanner.listOutboxCandidates({
        now: dependencies.now(),
        limit: MATRIX_CORPUS_RECOVERY_BATCH_SIZE,
        ownerDigest: dependencies.ownerDigest,
      });
      const attempts = await Promise.allSettled([
        ...candidates.ingest.map(async (candidate) => {
          const result = await dependencies.drainer.drainIngest(candidate);
          if (result.status === 'rejected') {
            throw new Error('Matrix corpus recovery candidate rejected');
          }
        }),
        ...candidates.terminal.map(async (candidate) => {
          const result = await dependencies.drainer.drainTerminalControl(candidate);
          if (result.status === 'rejected') {
            throw new Error('Matrix corpus recovery candidate rejected');
          }
        }),
      ]);
      if (attempts.some((attempt) => attempt.status === 'rejected')) {
        throw new Error('Matrix corpus recovery batch failed');
      }
    },

    async sweepExpiredLeases(): Promise<void> {
      const candidates = await dependencies.scanner.listExpiredLeaseCandidates({
        now: dependencies.now(),
        limit: MATRIX_CORPUS_RECOVERY_BATCH_SIZE,
      });
      const attempts = await Promise.allSettled(
        candidates.map(
          async (candidate) => await dependencies.controlPlane.abandonExpiredRun(candidate)
        )
      );
      if (attempts.some((attempt) => attempt.status === 'rejected')) {
        throw new Error('Matrix corpus recovery batch failed');
      }
    },
  };
}
import type { MatrixCorpusControlPlane } from '../domain/matrixCorpus/controlPlane.js';
import type { AbandonExpiredRunInput } from '../domain/matrixCorpus/types.js';
import type {
  MatrixCorpusIngestDrainInput,
  MatrixCorpusOutboxDrainer,
  MatrixCorpusTerminalDrainInput,
} from '../infra/pubsub/matrixCorpusOutboxDrainer.js';
