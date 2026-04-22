/**
 * Title + prev/next + regenerate button for the digest detail page.
 */

import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { PersistedDailySummary } from '@/types/notificationDigests';

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDate(date: string, deltaDays: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(t + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

interface DigestHeaderProps {
  readonly digest: PersistedDailySummary;
  readonly groupKey: string;
  readonly onRequestRegenerate: () => void;
  readonly regenerating: boolean;
}

export function DigestHeader({
  digest,
  groupKey,
  onRequestRegenerate,
  regenerating,
}: DigestHeaderProps): React.JSX.Element {
  const navigate = useNavigate();
  const { summary, generation } = digest;
  const isRegenerated = generation > 1;

  const go = (delta: number): void => {
    void navigate(`/notifications/digests/${encodeURIComponent(groupKey)}/${encodeURIComponent(shiftDate(summary.date, delta))}`);
  };

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {summary.date}
        </h2>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
          {groupKey}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
            isRegenerated
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
          }`}
        >
          generacja {String(generation)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {String(summary.messageCount)} wiadomości
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(): void => { go(-1); }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
          aria-label="Poprzedni dzień"
        >
          <ChevronLeft className="h-4 w-4" />
          Poprzedni
        </button>
        <button
          type="button"
          onClick={(): void => { go(1); }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
          aria-label="Następny dzień"
        >
          Następny
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRequestRegenerate}
          disabled={regenerating}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Generowanie…' : 'Wygeneruj ponownie'}
        </button>
      </div>
    </div>
  );
}
