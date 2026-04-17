/**
 * Cell-per-day grid for a backfill run. Each cell is color-coded by status:
 *   - gray: pending
 *   - blue (pulsing): currently running
 *   - green: completed
 *   - red: failed (tooltip shows the error)
 */

import type { BackfillFailure, BackfillRun } from '@/types/notificationDigests';

const DAY_MS = 24 * 60 * 60 * 1000;

function enumerateDates(from: string, to: string): readonly string[] {
  const out: string[] = [];
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return out;
  for (let t = fromMs; t <= toMs; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

type CellStatus = 'pending' | 'running' | 'completed' | 'failed';

function statusClass(status: CellStatus): string {
  if (status === 'completed') return 'bg-emerald-500 dark:bg-emerald-600';
  if (status === 'failed') return 'bg-red-500 dark:bg-red-600';
  if (status === 'running') return 'bg-blue-500 dark:bg-blue-400 animate-pulse';
  return 'bg-slate-200 dark:bg-slate-700';
}

interface BackfillProgressGridProps {
  readonly run: BackfillRun;
}

export function BackfillProgressGrid({ run }: BackfillProgressGridProps): React.JSX.Element {
  const dates = enumerateDates(run.fromDate, run.toDate);
  const completedSet = new Set(run.completedDates);
  const failuresByDate = new Map<string, BackfillFailure>(run.failedDates.map((f) => [f.date, f]));

  const classify = (date: string): CellStatus => {
    if (completedSet.has(date)) return 'completed';
    if (failuresByDate.has(date)) return 'failed';
    if (run.currentDate === date && run.status === 'running') return 'running';
    return 'pending';
  };

  const countByStatus = {
    completed: run.completedDates.length,
    failed: run.failedDates.length,
    running: run.status === 'running' && run.currentDate !== null ? 1 : 0,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Ukończone: {String(countByStatus.completed)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
          Błędy: {String(countByStatus.failed)}
        </span>
        {countByStatus.running > 0 ? (
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />
            Trwa: {run.currentDate ?? ''}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px]">{run.runId}</span>
      </div>
      <div className="grid grid-cols-10 gap-1.5">
        {dates.map((date) => {
          const s = classify(date);
          const failure = failuresByDate.get(date);
          const title = failure !== undefined
            ? `${date} (błąd): ${failure.error}`
            : `${date} · ${s}`;
          return (
            <div
              key={date}
              className={`aspect-square rounded-sm ${statusClass(s)}`}
              title={title}
              aria-label={title}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {String(dates.length)} dni · status: {run.status}
      </p>
    </div>
  );
}
