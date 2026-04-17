import type { Logger, Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { BackfillRunRepository } from '../repositories/digestRepositories.js';

export interface RunDigestBackfillDeps {
  readonly logger: Logger;
  readonly backfillRunRepository: BackfillRunRepository;
  readonly httpPost: (path: string, body: unknown) => Promise<Result<unknown, { message: string }>>;
}

export interface RunDigestBackfillInput {
  readonly userId: string;
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export function listDates(fromDate: string, toDate: string): readonly string[] {
  const out: string[] = [];
  let d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export async function startDigestBackfill(
  deps: RunDigestBackfillDeps,
  input: RunDigestBackfillInput,
): Promise<Result<{ runId: string; queuedDates: readonly string[] }, { message: string }>> {
  const dates = listDates(input.fromDate, input.toDate);
  const runId = `bf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const created = await deps.backfillRunRepository.create({
    runId,
    userId: input.userId,
    groupKey: input.groupKey,
    fromDate: input.fromDate,
    toDate: input.toDate,
    status: 'running',
    totalDates: dates.length,
    completedDates: [],
    failedDates: [],
    currentDate: dates[0] ?? null,
    startedAt: now,
    updatedAt: now,
  });
  if (!created.ok) return err({ message: created.error.message });

  const first = dates[0];
  if (first !== undefined) {
    const triggered = await deps.httpPost('/internal/notifications/digest/run', {
      userId: input.userId,
      groupKey: input.groupKey,
      date: first,
      chainNext: {
        runId,
        remainingDates: dates.slice(1),
        fromDate: input.fromDate,
        toDate: input.toDate,
      },
    });
    if (!triggered.ok) return err({ message: triggered.error.message });
  }

  return ok({ runId, queuedDates: dates });
}
