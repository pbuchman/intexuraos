/**
 * One-line entry in the digest list page. Click navigates to detail.
 *
 * Mirrors the IssueGroupRow visual conventions (rounded-lg border,
 * hover shadow, left accent strip, dark-mode pair classes) in a compact
 * shape suitable for a day-by-day list.
 */

import { Link } from 'react-router-dom';
import { MessageSquare, RotateCcw } from 'lucide-react';
import type { PersistedDailySummary } from '@/types/notificationDigests';

interface DigestRowProps {
  readonly digest: PersistedDailySummary;
}

function formatDateLabel(isoDate: string): string {
  // `YYYY-MM-DD` is already human-friendly; we show it plus weekday.
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const weekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'long' }).format(d);
  return `${isoDate} · ${weekday}`;
}

export function DigestRow({ digest }: DigestRowProps): React.JSX.Element {
  const { summary, generation } = digest;
  const isRegenerated = generation > 1;
  const accent = isRegenerated
    ? 'shadow-[inset_3px_0_0_theme(colors.amber.500)]'
    : 'shadow-[inset_3px_0_0_theme(colors.blue.500)]';

  return (
    <Link
      to={`/notifications/digests/${encodeURIComponent(summary.groupKey)}/${encodeURIComponent(summary.date)}`}
      className={`group block rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-all duration-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${accent}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
            {formatDateLabel(summary.date)}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {summary.headline !== '' ? summary.headline : 'Brak wiadomości tego dnia'}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            <MessageSquare className="h-3 w-3" />
            {String(summary.messageCount)}
          </span>
          {isRegenerated ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              title={`Wygenerowano ponownie (generacja ${String(generation)})`}
            >
              <RotateCcw className="h-3 w-3" />
              v{String(generation)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
