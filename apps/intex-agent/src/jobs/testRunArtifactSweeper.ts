import type { TestRunRepository } from '../domain/testRuns/ports/testRunRepository.js';

export const TEST_RUN_ARTIFACT_DEADLINE_MS = 10 * 60 * 1000;
export const TEST_RUN_ARTIFACT_SWEEP_LIMIT = 20 as const;
export const TEST_RUN_ARTIFACT_SWEEP_INTERVAL_MS = 30 * 1000;

type SweeperRepository = Pick<
  TestRunRepository,
  'listStagedArtifactsFinishedBefore' | 'applyArtifactDelivery'
>;

export interface TestRunArtifactSweeper {
  runOnce(): Promise<
    | Readonly<{ skipped: true }>
    | Readonly<{
        skipped: false;
        candidates: number;
        transitioned: number;
        conflicts: number;
      }>
  >;
}

export interface TestRunArtifactSweepScheduler {
  start(): void;
  stop(): Promise<void>;
}

export function createTestRunArtifactSweepScheduler(
  sweeper: Pick<TestRunArtifactSweeper, 'runOnce'>,
  onError: (error: unknown) => void = () => undefined
): TestRunArtifactSweepScheduler {
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;
  return {
    start(): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        if (inFlight !== undefined) return;
        inFlight = sweeper
          .runOnce()
          .then(() => undefined)
          .catch(onError)
          .finally(() => {
            inFlight = undefined;
          });
      }, TEST_RUN_ARTIFACT_SWEEP_INTERVAL_MS);
    },
    async stop(): Promise<void> {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}

export function createTestRunArtifactSweeper(deps: Readonly<{
  repository: SweeperRepository;
  now?: () => string;
}>): TestRunArtifactSweeper {
  let running = false;
  return {
    async runOnce(): ReturnType<TestRunArtifactSweeper['runOnce']> {
      if (running) return { skipped: true };
      running = true;
      try {
        const now = deps.now?.() ?? new Date().toISOString();
        const cutoff = new Date(Date.parse(now) - TEST_RUN_ARTIFACT_DEADLINE_MS).toISOString();
        const listed = await deps.repository.listStagedArtifactsFinishedBefore({
          cutoff,
          limit: TEST_RUN_ARTIFACT_SWEEP_LIMIT,
        });
        if (!listed.ok)
          return { skipped: false, candidates: 0, transitioned: 0, conflicts: 1 };

        let transitioned = 0;
        let conflicts = 0;
        for (const record of listed.records) {
          if (
            (record.lifecycle !== 'completed' && record.lifecycle !== 'stopped') ||
            record.artifactDelivery.status !== 'staged' ||
            record.finishedAt === null ||
            Date.parse(record.finishedAt) > Date.parse(cutoff)
          )
            continue;
          const result = await deps.repository.applyArtifactDelivery({
            identity: {
              runId: record.runId,
              userId: record.userId,
              leaseFence: record.leaseFence,
            },
            command: {
              expectedRevision: record.revision,
              updatedAt: now,
              next: {
                status: 'unknown',
                failureCode: 'REPORT_DELIVERY_STATUS_TIMEOUT',
              },
            },
          });
          if (result.ok && result.disposition === 'applied') transitioned += 1;
          else if (!result.ok) conflicts += 1;
        }
        return {
          skipped: false,
          candidates: listed.records.length,
          transitioned,
          conflicts,
        };
      } finally {
        running = false;
      }
    },
  };
}
