/**
 * 30-day heatmap: each cell is a date, colored by message count (log scale).
 * Click a cell with data to navigate to that date's digest.
 */

import { Link } from 'react-router-dom';
import type { PersistedDailySummary } from '@/types/notificationDigests';

interface DigestHeatmapProps {
  readonly digests: readonly PersistedDailySummary[];
  readonly groupKey: string;
  readonly fromDate: string;
  readonly toDate: string;
}

function enumerateDates(from: string, to: string): readonly string[] {
  const out: string[] = [];
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return out;
  for (let t = fromMs; t <= toMs; t += 24 * 60 * 60 * 1000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function intensityClass(count: number | undefined, maxCount: number): string {
  if (count === undefined) {
    return 'bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-200 dark:border-slate-700';
  }
  if (count === 0) return 'bg-slate-200 dark:bg-slate-700';
  // Log scale, 5 buckets
  const ratio = Math.log(count + 1) / Math.log(Math.max(maxCount, 2) + 1);
  if (ratio < 0.2) return 'bg-blue-200 dark:bg-blue-900/60';
  if (ratio < 0.4) return 'bg-blue-300 dark:bg-blue-800/80';
  if (ratio < 0.6) return 'bg-blue-400 dark:bg-blue-700';
  if (ratio < 0.8) return 'bg-blue-500 dark:bg-blue-600';
  return 'bg-blue-600 dark:bg-blue-500';
}

export function DigestHeatmap({
  digests,
  groupKey,
  fromDate,
  toDate,
}: DigestHeatmapProps): React.JSX.Element {
  const dates = enumerateDates(fromDate, toDate);
  const byDate = new Map(digests.map((d) => [d.summary.date, d]));
  const maxCount = digests.reduce((max, d) => Math.max(max, d.summary.messageCount), 0);

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{fromDate} → {toDate}</span>
        <span>{String(digests.length)} / {String(dates.length)} dni</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dates.map((date) => {
          const entry = byDate.get(date);
          const count = entry?.summary.messageCount;
          const cellClass = `aspect-square rounded-sm transition-transform hover:scale-110 ${intensityClass(count, maxCount)}`;
          const title = count !== undefined
            ? `${date}: ${String(count)} wiadomości${entry !== undefined && entry.generation > 1 ? ` (v${String(entry.generation)})` : ''}`
            : `${date}: brak podsumowania`;
          if (entry === undefined) {
            return (
              <div key={date} className={cellClass} title={title} aria-label={title} />
            );
          }
          return (
            <Link
              key={date}
              to={`/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(date)}`}
              className={cellClass}
              title={title}
              aria-label={title}
            />
          );
        })}
      </div>
    </div>
  );
}
